/* gstack eval body; isolated local-lab Earnings only. Refuses financial data.
 * Screenshots contain synthetic QA data. Restore via customer-infrastructure-cleanup.browser.js. */
return await (async () => {
  if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== "/earnings")
    throw new Error("Use the isolated local Earnings browser.");
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode) throw new Error("Local lab only.");
  const financeKey = "lenslabs.local-finance.v1",
    clientKey = "lenslabs.client-workspace.v1";
  const qaKey = "foto:qa:customer-infrastructure";
  const existing = JSON.parse(sessionStorage.getItem(qaKey) ?? "null");
  if (
    existing
      ? existing.shootId !== "eeaf3000-1111-4222-8333-000000000071" ||
        localStorage.getItem(financeKey) !== existing.fixture ||
        localStorage.getItem(clientKey) !== existing.clients
      : localStorage.getItem(financeKey) !== null || localStorage.getItem(clientKey) !== null
  )
    throw new Error("Refusing to overwrite existing finance/client/QA records.");
  const shootId = "eeaf3000-1111-4222-8333-000000000071";
  const directory = await import("/src/lib/studio/shoot-directory.ts");
  const beforeShoots = await directory.listRecentShoots("device-local");
  if (
    beforeShoots.some(
      (s) =>
        !(existing && s.id === shootId && s.title === "QA Portrait Session") &&
        (!/^eeaf3000-1111-4222-8333-00000000005[123]$/.test(s.id) || s.count !== 0),
    )
  )
    throw new Error("Use an empty or reserved-fixture-only shoot directory.");
  const now = new Date(),
    stamp = now.toISOString();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const fixture =
    existing?.fixture ??
    JSON.stringify({
      version: 1,
      revision: 1,
      entries: [
        {
          id: "qa-customer-receipt-071",
          occurredOn: today,
          description: "QA Portrait Deposit",
          kind: "income",
          category: "Deposit",
          amountCents: 12500,
          currency: "USD",
          shootId,
          clientId: null,
          clientName: "QA Jordan Ellis",
          paymentMethod: "cash",
          source: "manual",
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
      invoices: [],
      updatedAt: stamp,
    });
  const meta = existing ?? {
    financeKey,
    clientKey,
    shootId,
    fixture,
    beforeShoots,
    clientIds: [],
    clients: null,
  };
  if (!existing) {
    sessionStorage.setItem(qaKey, JSON.stringify(meta));
    await directory.rememberShoot("device-local", shootId, 0, "QA Portrait Session");
    await directory.renameShoot("device-local", shootId, "QA Portrait Session");
    localStorage.setItem(financeKey, fixture);
    window.dispatchEvent(new Event("foto:earnings-changed"));
  }
  const checks = [];
  const check = (label, value) => {
    if (!value) throw new Error(label);
    checks.push(label);
  };
  const until = async (label, test) => {
    const end = performance.now() + 8000;
    while (performance.now() < end) {
      if (test()) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const click = (root, text) => {
    const node = [...root.querySelectorAll("button,summary")].find(
      (n) => n.textContent.trim() === text,
    );
    if (!node) throw new Error(`Missing ${text}`);
    node.click();
  };
  await until("paid ledger row", () =>
    document
      .querySelector('[aria-label="Open QA Portrait Deposit"]')
      ?.textContent.includes("QA Portrait Session"),
  );
  if (!document.querySelector(".customer-receipt"))
    document.querySelector('[aria-label="Open QA Portrait Deposit"]').click();
  await until("receipt disclosure", () => document.querySelector(".customer-receipt"));
  if (!document.querySelector(".customer-receipt").open)
    click(document.querySelector(".customer-receipt"), "Customer Receipt");
  await until("receipt ready", () => document.querySelector(".customer-receipt input"));
  const inputs = document.querySelectorAll(".customer-receipt input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(inputs[0], "QA Studio <&>");
  inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await until("business field", () => inputs[0].value === "QA Studio <&>");
  click(
    document.querySelector(".customer-receipt"),
    document.querySelector(".customer-receipt-paper") ? "Recreate Receipt" : "Create Receipt",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await until("native receipt", () => document.querySelector(".customer-receipt-paper"));
  const receipt = document.querySelector(".customer-receipt");
  check("C++ receipt is exact recorded amount", receipt.textContent.includes("$125.00"));
  check(
    "receipt has real linked fixture title",
    receipt.textContent.includes("QA Portrait Session"),
  );
  check(
    "manual cash provenance is explicit",
    receipt.textContent.toLowerCase().includes("cash") &&
      receipt.textContent.includes("Manually recorded") &&
      !receipt.textContent.includes("Provider verified"),
  );
  check("customer is retained", receipt.textContent.includes("QA Jordan Ellis"));
  check("receipt creation does not rewrite finance", localStorage.getItem(financeKey) === fixture);
  const originalCreate = URL.createObjectURL,
    originalClick = HTMLAnchorElement.prototype.click;
  const blobs = [];
  URL.createObjectURL = function (blob) {
    blobs.push(blob);
    return originalCreate.call(this, blob);
  };
  const downloads = [];
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) downloads.push(this.download);
    else originalClick.call(this);
  };
  try {
    click(receipt, "Download Receipt");
    await until("download", () => blobs.length === 1);
  } finally {
    URL.createObjectURL = originalCreate;
    HTMLAnchorElement.prototype.click = originalClick;
  }
  const html = await blobs[0].text();
  check(
    "download is native standalone HTML",
    html.startsWith("<!doctype html>") && downloads[0].endsWith(".html"),
  );
  check(
    "download escapes business identity",
    html.includes("QA Studio &lt;&amp;&gt;") && !html.includes("QA Studio <&>"),
  );
  check("download preserves money", html.includes("125.00") && html.includes("USD"));
  check("no remote scripts in receipt", !/<script|https?:\/\//i.test(html));
  check("download does not change finance", localStorage.getItem(financeKey) === fixture);
  check(
    "pitch-black Earnings canvas",
    getComputedStyle(document.querySelector(".earnings-workspace")).backgroundColor ===
      "rgb(0, 0, 0)",
  );
  check(
    "text/email handoff offered, nothing sent",
    receipt.textContent.includes("Text or Email a Customer"),
  );
  window.__qaReceiptHtml = html;
  return {
    count: checks.length,
    checks,
    externalMessagesSent: 0,
    fixture: "Synthetic QA only; cleanup required after CRM checks.",
  };
})();
