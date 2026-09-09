import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import {
  normalizeConnectedPayments,
  normalizeConnectedInvoices,
  stripeAmountToMinor,
} from "../src/lib/earnings/stripe-receipts";
import {
  readConnectedEarnings,
  type EarningsStripeReader,
} from "../src/lib/earnings/connected-earnings.server";
import {
  handleConnectedInvoiceEvent,
  verifyConnectedEvent,
  type InvoiceWebhookDependencies,
} from "../src/lib/earnings/stripe-webhook.server";
import {
  invoiceDraftInputSchema,
  invoiceSendInputSchema,
  pendingInvoiceReservation,
  performInvoiceSend,
  verifiedInvoicePaymentUrl,
  type InvoiceSendInput,
  type InvoiceStripeSender,
} from "../src/lib/earnings/invoice-send.server";

const ownerId = "owner-a",
  shootId = "shoot-a",
  accountId = "acct_owner";
const binding = {
  id: "local-invoice",
  user_id: ownerId,
  stripe_invoice_id: "in_one",
  shoot_id: shootId,
  client_id: "client-a",
};
const charge = (patch: Record<string, unknown> = {}) => ({
  object: "charge",
  id: "ch_one",
  created: 1704067200,
  currency: "usd",
  amount: 10000,
  amount_captured: 10000,
  amount_refunded: 0,
  status: "succeeded",
  paid: true,
  captured: true,
  livemode: true,
  disputed: false,
  metadata: { lenslabs_shoot_id: shootId, lenslabs_user_id: ownerId },
  payment_intent: "pi_one",
  balance_transaction: { id: "txn_one", created: 1704153600 },
  ...patch,
});
const refund = (patch: Record<string, unknown> = {}) => ({
  object: "refund",
  id: "re_one",
  charge: "ch_one",
  amount: 2500,
  currency: "usd",
  created: 1706745600,
  status: "succeeded",
  ...patch,
});
const payment = {
  id: "inpay_one",
  object: "invoice_payment",
  invoice: "in_one",
  payment: { type: "payment_intent", payment_intent: "pi_one" },
  status: "paid",
  status_transitions: { paid_at: 1704153600 },
};
const input = (patch: Record<string, unknown> = {}) => ({
  accountId,
  ownerId,
  charges: [charge()],
  refunds: [],
  invoicePayments: [payment],
  ownedInvoices: [binding],
  ownedShootIds: [shootId],
  refundsComplete: true,
  ...patch,
});

describe("authoritative connected receipts", () => {
  test("invoice and charge yield one canonical payment, with source aliases", () => {
    const result = normalizeConnectedPayments(
      input({
        charges: [charge(), charge(), { object: "invoice", id: "in_one", amount_paid: 10000 }],
      }),
    );
    expect(result.receipts).toHaveLength(1);
    const row = result.receipts[0]!;
    expect(row.id).toBe("acct_owner:ch_one");
    expect(row.collectedMinor).toBe(10000);
    expect(row.paidAt).toBe("2024-01-02T00:00:00.000Z");
    expect(row.legacyObjectIds).toEqual(["ch_one", "in_one", "pi_one"]);
    expect(row.shootId).toBe(shootId);
  });
  test("partial capture is not the full authorization, refunds remain separately dated", () => {
    const row = normalizeConnectedPayments(
      input({
        charges: [charge({ amount_captured: 6000, amount_refunded: 2500 })],
        refunds: [refund(), refund()],
      }),
    ).receipts[0]!;
    expect(row.amountMinor).toBe(10000);
    expect(row.collectedMinor).toBe(6000);
    expect(row.netMinor).toBe(3500);
    expect(row.status).toBe("paid");
    expect(row.refunds).toHaveLength(1);
    expect(row.refunds[0]!.createdAt).toBe("2024-02-01T00:00:00.000Z");
    expect(row.refundHistoryComplete).toBe(true);
  });
  test("full refund retains original gross with no remaining net", () => {
    const row = normalizeConnectedPayments(
      input({
        charges: [charge({ amount_refunded: 10000 })],
        refunds: [refund({ amount: 10000 })],
      }),
    ).receipts[0]!;
    expect(row.status).toBe("refunded");
    expect(row.collectedMinor).toBe(10000);
    expect(row.netMinor).toBe(0);
  });
  test("pending, failed and uncaptured authorizations never become paid income", () => {
    for (const patch of [
      { status: "pending", paid: false, captured: false },
      { status: "failed", paid: false, captured: false },
      { status: "succeeded", paid: true, captured: false },
    ]) {
      const row = normalizeConnectedPayments(input({ charges: [charge(patch)] })).receipts[0]!;
      expect(row.collectedMinor).toBe(0);
      expect(row.netMinor).toBe(0);
      expect(row.paidAt).toBeNull();
      expect(row.status).not.toBe("paid");
    }
  });
  test("incomplete or pending refund history does not masquerade as dated settled refunds", () => {
    for (const patch of [
      { refunds: [] },
      { refunds: [refund({ status: "pending" })] },
      { refunds: [refund()], refundsComplete: false },
    ]) {
      const row = normalizeConnectedPayments(
        input({ charges: [charge({ amount_refunded: 2500 })], ...patch }),
      ).receipts[0]!;
      expect(row.refundHistoryComplete).toBe(false);
      expect(row.warnings.join(" ")).toContain("incomplete");
    }
  });
  test("platform subscriptions, payouts and conflicting owner metadata are excluded", () => {
    for (const object of [
      charge({ metadata: { managed_payments: "true" } }),
      charge({ metadata: { plan: "pro" } }),
      charge({ metadata: { lenslabs_user_id: "another-owner" } }),
      { object: "payout", id: "po_one", amount: 9999 },
    ]) {
      expect(normalizeConnectedPayments(input({ charges: [object] })).receipts).toHaveLength(0);
    }
  });
  test("unowned, ambiguous and conflicting shoot references are not silently linked", () => {
    for (const patch of [
      { ownedShootIds: [] },
      { charges: [charge({ metadata: { lenslabs_shoot_id: "wrong" } })] },
      { ownedInvoices: [binding, { ...binding, id: "second", shoot_id: "other" }] },
    ]) {
      const row = normalizeConnectedPayments(input(patch)).receipts[0]!;
      expect(row.shootId).toBeNull();
      expect(row.linkStatus).toBe("unlinked");
    }
  });
  test("missing posting date stays unknown, not charge-created paid time", () => {
    const row = normalizeConnectedPayments(
      input({ charges: [charge({ balance_transaction: "txn_one" })], invoicePayments: [] }),
    ).receipts[0]!;
    expect(row.paidAt).toBeNull();
    expect(row.dateBasis).toBe("unknown");
    expect(row.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });
  test("metadata cannot override a conflicting actual invoice-payment link", () => {
    const row = normalizeConnectedPayments(
      input({
        charges: [
          charge({ metadata: { lenslabs_invoice_id: binding.id, lenslabs_shoot_id: shootId } }),
        ],
        invoicePayments: [
          { id: "inpay_conflict", invoice: "in_other", payment: { payment_intent: "pi_one" } },
        ],
      }),
    ).receipts[0]!;
    expect(row.shootId).toBeNull();
    expect(row.linkStatus).toBe("unlinked");
    expect(row.warnings.join(" ")).toContain("Conflicting");
  });
  test("invalid amounts are excluded rather than coerced or rounded", () => {
    for (const patch of [
      { amount: "10000" },
      { amount: 1.5 },
      { amount_refunded: 10001 },
      { amount_captured: 10001 },
      { amount: NaN },
      { currency: "US dollars" },
    ])
      expect(normalizeConnectedPayments(input({ charges: [charge(patch)] })).receipts).toHaveLength(
        0,
      );
  });
  test("test mode and disputes remain explicit, never inferred live", () => {
    const row = normalizeConnectedPayments(
      input({ charges: [charge({ livemode: false, disputed: true })] }),
    ).receipts[0]!;
    expect(row.livemode).toBe(false);
    expect(row.disputed).toBe(true);
    expect(row.warnings.join(" ")).toContain("disputed");
  });
  test("ISK and UGX normalize exact provider units, JPY and three-decimal currencies retain precision", () => {
    expect(stripeAmountToMinor(500, "isk")).toBe(5);
    expect(stripeAmountToMinor(12300, "ugx")).toBe(123);
    expect(stripeAmountToMinor(500, "jpy")).toBe(500);
    expect(stripeAmountToMinor(1234, "kwd")).toBe(1234);
    expect(() => stripeAmountToMinor(501, "isk")).toThrow();
    const row = normalizeConnectedPayments(
      input({
        charges: [charge({ currency: "ugx", amount_refunded: 2500 })],
        refunds: [refund({ currency: "ugx" })],
      }),
    ).receipts[0]!;
    expect(row.amountMinor).toBe(100);
    expect(row.refundedMinor).toBe(25);
    expect(row.refunds[0]!.amountMinor).toBe(25);
  });
  test("outstanding uses provider amount_remaining, never full old sent amount", () => {
    const rows = normalizeConnectedInvoices(
      [
        {
          id: "in_one",
          status: "open",
          created: 1704067200,
          status_transitions: { finalized_at: 1704153600 },
          due_date: 1706745600,
          total: 10000,
          amount_remaining: 2500,
          currency: "usd",
          livemode: true,
          hosted_invoice_url: "https://invoice.stripe.com/i/test",
        },
      ],
      [binding],
      ownerId,
      [shootId],
      { "client-a": "Client" },
    );
    expect(rows[0]!.outstandingMinor).toBe(2500);
    expect(rows[0]!.clientName).toBe("Client");
    expect(rows[0]!.dueDate).toBe("2024-02-01");
  });
  test("1000 varied replay cases preserve cents, source bytes, unique sale and refund totals", () => {
    for (let i = 1; i <= 1000; i++) {
      const amount = i * 101,
        returned = i % 5 === 0 ? amount : i % 3 === 0 ? i : 0;
      const source = input({
        charges: [
          charge({ amount, amount_captured: amount, amount_refunded: returned }),
          charge({ amount, amount_captured: amount, amount_refunded: returned }),
        ],
        refunds: returned ? [refund({ amount: returned }), refund({ amount: returned })] : [],
      });
      const before = JSON.stringify(source),
        rows = normalizeConnectedPayments(source).receipts;
      expect(rows.length).toBe(1);
      expect(rows[0]!.netMinor).toBe(amount - returned);
      expect(rows[0]!.refundHistoryComplete).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
    }
  });
});

describe("read-only connected pagination", () => {
  function reader(
    page?: (kind: string, cursor?: string) => { data: Array<{ id: string }>; has_more: boolean },
  ) {
    const calls: Array<{
      kind: string;
      params: Record<string, unknown>;
      opts: Record<string, unknown>;
    }> = [];
    const client = Object.fromEntries(
      ["charges", "refunds", "invoicePayments", "invoices"].map((kind) => [
        kind,
        {
          list: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
            calls.push({ kind, params, opts });
            return (
              page?.(kind, params["starting_after"] as string | undefined) ?? {
                data: kind === "charges" ? [charge()] : kind === "invoicePayments" ? [payment] : [],
                has_more: false,
              }
            );
          },
        },
      ]),
    ) as unknown as EarningsStripeReader;
    return { client, calls };
  }
  const owned = {
    accountId,
    ownerId,
    ownedInvoices: [binding],
    ownedShootIds: [shootId],
    clientNames: {},
    bindingsComplete: true,
  };
  test("every request carries the photographer account and never calls payouts or writes", async () => {
    const { client, calls } = reader(),
      snapshot = await readConnectedEarnings(owned, client);
    expect(snapshot.connection).toBe("connected");
    expect(snapshot.complete).toBe(true);
    expect(calls.length).toBe(4);
    expect(calls.every((c) => c.opts["stripeAccount"] === accountId)).toBe(true);
    expect(snapshot.receipts).toHaveLength(1);
  });
  test("more than100 records paginates, bounded truncation stays incomplete", async () => {
    const { client, calls } = reader((kind, cursor) =>
      kind === "charges"
        ? { data: [charge({ id: cursor ? "ch_two" : "ch_one" })], has_more: !cursor }
        : { data: [], has_more: false },
    );
    const snapshot = await readConnectedEarnings(owned, client);
    expect(snapshot.receipts).toHaveLength(2);
    expect(calls.filter((c) => c.kind === "charges")).toHaveLength(2);
    const limited = await readConnectedEarnings(owned, client, { maxPages: 1 });
    expect(limited.complete).toBe(false);
    expect(limited.warnings.join(" ")).toContain("limited");
  });
  test("provider charge failure is not an empty successful ledger", async () => {
    const { client } = reader((kind) => {
      if (kind === "charges") throw new Error("provider down");
      return { data: [], has_more: false };
    });
    await expect(readConnectedEarnings(owned, client)).rejects.toThrow("could not be read");
  });
});

describe("signed account-owned invoice mirror", () => {
  const event = {
    type: "invoice.paid",
    account: accountId,
    data: { object: { id: "in_one", metadata: { lenslabs_user_id: "attacker" } } },
  };
  function deps(status = "paid") {
    const writes: Array<unknown> = [],
      accounts: string[] = [];
    const dependencies: InvoiceWebhookDependencies = {
      resolveOwner: async (account) => {
        accounts.push(account);
        return ownerId;
      },
      retrieveInvoice: async (id, account) => {
        accounts.push(account);
        return {
          id,
          status,
          metadata: { lenslabs_user_id: ownerId },
          hosted_invoice_url: "https://invoice.stripe.com/i/verified",
        };
      },
      saveInvoice: async (owner, invoice) => {
        writes.push({ owner, ...invoice });
      },
    };
    return { writes, accounts, dependencies };
  }
  test("valid signatures accepted, tampering and old timestamps rejected", async () => {
    const body = JSON.stringify({ ...event, id: "evt_test", object: "event" }),
      secret = "whsec_test_fixture_only";
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
    });
    expect((await verifyConnectedEvent(body, signature, secret)).id).toBe("evt_test");
    await expect(verifyConnectedEvent(`${body} `, signature, secret)).rejects.toThrow();
    await expect(
      verifyConnectedEvent(
        body,
        await Stripe.webhooks.generateTestHeaderStringAsync({
          payload: body,
          secret,
          timestamp: 1,
        }),
        secret,
      ),
    ).rejects.toThrow();
  });
  test("metadata cannot choose owner; duplicate events re-read current invoice", async () => {
    const { dependencies, writes, accounts } = deps();
    await handleConnectedInvoiceEvent(event, dependencies);
    await handleConnectedInvoiceEvent({ ...event, type: "invoice.payment_failed" }, dependencies);
    expect(accounts.every((a) => a === accountId)).toBe(true);
    expect(writes).toEqual([
      {
        owner: ownerId,
        id: "in_one",
        status: "paid",
        hostedInvoiceUrl: "https://invoice.stripe.com/i/verified",
      },
      {
        owner: ownerId,
        id: "in_one",
        status: "paid",
        hostedInvoiceUrl: "https://invoice.stripe.com/i/verified",
      },
    ]);
  });
  test("platform/charge/payout events never create client income", async () => {
    for (const altered of [
      { ...event, account: undefined },
      { ...event, type: "charge.succeeded" },
      { ...event, type: "payout.paid" },
    ]) {
      const { dependencies, writes } = deps();
      expect(await handleConnectedInvoiceEvent(altered, dependencies)).toBe("ignored");
      expect(writes).toHaveLength(0);
    }
  });
  test("finalized does not mean emailed and provider owner conflicts are rejected", async () => {
    const { dependencies, writes } = deps("open");
    expect(
      await handleConnectedInvoiceEvent({ ...event, type: "invoice.finalized" }, dependencies),
    ).toBe("ignored");
    expect(writes).toHaveLength(0);
    dependencies.retrieveInvoice = async () => ({
      id: "in_one",
      status: "paid",
      metadata: { lenslabs_user_id: "other" },
    });
    expect(await handleConnectedInvoiceEvent(event, dependencies)).toBe("ignored");
  });
  test("storage error propagates for webhook retry", async () => {
    const { dependencies } = deps();
    dependencies.saveInvoice = async () => {
      throw new Error("DB down");
    };
    await expect(handleConnectedInvoiceEvent(event, dependencies)).rejects.toThrow("DB down");
  });
});

describe("existing draft send safety with mocked Stripe, no real sends", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  const base: InvoiceSendInput = {
    id: "invoice-a",
    ownerId,
    shootId,
    accountId,
    amount: 123.45,
    currency: "usd",
    description: "Session",
    dueDate: null,
    email: "client@example.test",
    clientName: "Client",
    stripeInvoiceId: pendingInvoiceReservation("invoice-a", now),
  };
  function sender(live = true, recipientChangeAfter?: "line" | "finalize" | "send") {
    const calls: Array<{ name: string; opts: Record<string, unknown> }> = [];
    let invoice = {
      id: "in_send",
      status: "draft",
      metadata: {
        lenslabs_invoice_id: base.id,
        lenslabs_user_id: ownerId,
        lenslabs_shoot_id: shootId,
        lenslabs_send_started: String(now),
        lenslabs_client_email: base.email,
      },
      customer: "cus_one",
      customer_email: base.email,
      total: 0,
      currency: "usd",
      livemode: live,
      hosted_invoice_url: "https://invoice.stripe.com/i/sent",
    };
    const step = (name: string, opts: Record<string, unknown>) => {
      calls.push({ name, opts });
      if (name === recipientChangeAfter) invoice.customer_email = "changed-in-stripe@example.test";
    };
    const client = {
      customers: {
        create: async (_: unknown, opts: Record<string, unknown>) => {
          step("customer", opts);
          return { id: "cus_one" };
        },
      },
      invoiceItems: {
        create: async (data: { amount: number }, opts: Record<string, unknown>) => {
          step("line", opts);
          invoice.total = data.amount;
          return { id: "ii_one" };
        },
      },
      invoices: {
        create: async (_: unknown, opts: Record<string, unknown>) => {
          step("create", opts);
          return { ...invoice };
        },
        retrieve: async () => ({ ...invoice }),
        finalizeInvoice: async (_: unknown, __: unknown, opts: Record<string, unknown>) => {
          step("finalize", opts);
          invoice.status = "open";
          return { ...invoice };
        },
        sendInvoice: async (_: unknown, __: unknown, opts: Record<string, unknown>) => {
          step("send", opts);
          return { ...invoice };
        },
      },
    } as unknown as InvoiceStripeSender;
    return {
      client,
      calls,
      setInvoice: (patch: Partial<typeof invoice>) => {
        invoice = { ...invoice, ...patch };
      },
    };
  }
  test("draft inputs enforce explicit shoot, dates and cents; send requires current revision", () => {
    const data = {
      client_id: "123e4567-e89b-42d3-a456-426614174001",
      shoot_id: "123e4567-e89b-42d3-a456-426614174002",
      amount: 123.45,
    };
    expect(invoiceDraftInputSchema.parse(data).amount).toBe(123.45);
    for (const patch of [
      { shoot_id: null },
      { amount: 1.001 },
      { due_date: "2026-02-30" },
      { extra: true },
    ])
      expect(() => invoiceDraftInputSchema.parse({ ...data, ...patch })).toThrow();
    expect(() => invoiceSendInputSchema.parse({ id: data.client_id })).toThrow();
  });
  test("reserves real ID before line/finalize/send and uses stable account-scoped operation keys", async () => {
    const { client, calls } = sender();
    let remembered = false;
    const result = await performInvoiceSend(
      base,
      client,
      async (id) => {
        expect(id).toBe("in_send");
        expect(calls.map((c) => c.name)).toEqual(["customer", "create"]);
        remembered = true;
      },
      now,
    );
    expect(remembered).toBe(true);
    expect(result.delivery).toBe("stripe-accepted");
    expect(result.invoice.total).toBe(12345);
    expect(calls.map((c) => c.name)).toEqual(["customer", "create", "line", "finalize", "send"]);
    expect(
      calls.every(
        (c) =>
          c.opts["stripeAccount"] === accountId &&
          String(c.opts["idempotencyKey"]).startsWith("foto:invoice:invoice-a:"),
      ),
    ).toBe(true);
  });
  test("test-mode acknowledgment explicitly says no email", async () => {
    const { client } = sender(false);
    expect((await performInvoiceSend(base, client, async () => {}, now)).delivery).toBe(
      "test-no-email",
    );
  });
  test("failed local provider-ID persistence cannot proceed to send", async () => {
    const { client, calls } = sender();
    await expect(
      performInvoiceSend(
        base,
        client,
        async () => {
          throw new Error("DB failed");
        },
        now,
      ),
    ).rejects.toThrow("DB failed");
    expect(calls.map((c) => c.name)).toEqual(["customer", "create"]);
  });
  test("old uncertain attempts and invalid inputs fail before provider mutations", async () => {
    for (const patch of [
      { stripeInvoiceId: pendingInvoiceReservation(base.id, now - 24 * 60 * 60_000) },
      { amount: 1.001 },
      { shootId: "" },
      { email: "not-email" },
      { dueDate: "2020-01-01" },
    ]) {
      const { client, calls } = sender();
      await expect(
        performInvoiceSend({ ...base, ...patch }, client, async () => {}, now),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }
  });
  test("already paid never sends again; foreign binding is rejected", async () => {
    const { client, calls, setInvoice } = sender();
    setInvoice({ status: "paid" });
    expect(
      (
        await performInvoiceSend(
          { ...base, stripeInvoiceId: "in_send" },
          client,
          async () => {},
          now,
        )
      ).delivery,
    ).toBe("already-paid");
    expect(calls).toHaveLength(0);
    setInvoice({
      metadata: {
        lenslabs_invoice_id: "foreign",
        lenslabs_user_id: ownerId,
        lenslabs_shoot_id: shootId,
        lenslabs_send_started: String(now),
        lenslabs_client_email: base.email,
      },
    });
    await expect(
      performInvoiceSend({ ...base, stripeInvoiceId: "in_send" }, client, async () => {}, now),
    ).rejects.toThrow("binding");
  });
  test("resumed send cannot use stale recipient after client email edit", async () => {
    const { client, calls } = sender();
    await expect(
      performInvoiceSend(
        { ...base, stripeInvoiceId: "in_send", email: "updated@example.test" },
        client,
        async () => {},
        now,
      ),
    ).rejects.toThrow("recipient");
    expect(calls).toHaveLength(0);
  });
  test("matching metadata cannot hide a changed actual Stripe invoice recipient", async () => {
    const { client, calls, setInvoice } = sender();
    setInvoice({ customer_email: "changed-in-stripe@example.test" });
    await expect(
      performInvoiceSend({ ...base, stripeInvoiceId: "in_send" }, client, async () => {}, now),
    ).rejects.toThrow("actual Stripe invoice recipient");
    expect(calls).toHaveLength(0);
  });
  test("recipient checked again before finalization and before send", async () => {
    for (const stage of ["line", "finalize"] as const) {
      const { client, calls } = sender(true, stage);
      await expect(
        performInvoiceSend({ ...base, stripeInvoiceId: "in_send" }, client, async () => {}, now),
      ).rejects.toThrow("recipient");
      expect(calls.some((call) => call.name === "send")).toBe(false);
      if (stage === "line") expect(calls.some((call) => call.name === "finalize")).toBe(false);
    }
  });
  test("send response with changed recipient is not reported as successful delivery", async () => {
    const { client, calls } = sender(true, "send");
    await expect(
      performInvoiceSend({ ...base, stripeInvoiceId: "in_send" }, client, async () => {}, now),
    ).rejects.toThrow("delivery is not assumed");
    expect(calls.filter((call) => call.name === "send")).toHaveLength(1);
  });
  test("payment link requires exact provider/local/owner binding and a payable Stripe URL", () => {
    const expected = { stripeId: "in_one", localId: "local", ownerId };
    const invoice = {
      id: "in_one",
      status: "open" as const,
      metadata: { lenslabs_invoice_id: "local", lenslabs_user_id: ownerId },
      hosted_invoice_url: "https://invoice.stripe.com/i/verified",
    };
    expect(verifiedInvoicePaymentUrl(invoice, expected)).toBe(invoice.hosted_invoice_url);
    for (const patch of [
      { id: "in_other" },
      { metadata: { lenslabs_invoice_id: "other", lenslabs_user_id: ownerId } },
      { metadata: null },
      { status: "paid" as const },
      { status: "draft" as const },
      { hosted_invoice_url: "https://evil.example/invoice" },
      { hosted_invoice_url: "https://invoice.stripe.com.evil.example/i/" },
      { hosted_invoice_url: "javascript:alert(1)" },
      { hosted_invoice_url: "https://user@invoice.stripe.com/i/" },
    ])
      expect(() => verifiedInvoicePaymentUrl({ ...invoice, ...patch }, expected)).toThrow();
  });
});
