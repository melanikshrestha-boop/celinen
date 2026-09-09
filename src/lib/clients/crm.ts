import {
  CLIENT_STAGES,
  isClientDate,
  type ClientStage,
  type WorkspaceClient,
} from "../client-workspace";
import type { LocalDeliveryGallerySummary } from "../delivery/local";
import type { LocalInvoiceDraft } from "../local-finance-store";

export const CLIENT_STAGE_LABELS: Record<ClientStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  booked: "Booked",
  delivered: "Delivered",
  archived: "Archived",
};
export type FollowUpState = "overdue" | "today" | "upcoming" | "unscheduled" | "archived";

export function clientFollowUp(client: WorkspaceClient, today: string): FollowUpState {
  if (!isClientDate(today)) throw new Error("A valid local date is required.");
  if (client.stage === "archived") return "archived";
  if (!client.followUpOn) return "unscheduled";
  return client.followUpOn < today ? "overdue" : client.followUpOn === today ? "today" : "upcoming";
}

/** Contacts are searchable, including formatted phone numbers. Never search stored access secrets. */
export function matchesClient(client: WorkspaceClient, query: string, extra = ""): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    client.name,
    client.org,
    client.email,
    client.phone,
    client.source,
    client.brief,
    extra,
  ]
    .join(" ")
    .toLocaleLowerCase();
  const phone = client.phone.replace(/\D/g, "");
  return words.every(
    (word) =>
      haystack.includes(word) ||
      (/^[+()\d.-]+$/.test(word) &&
        word.replace(/\D/g, "").length >= 3 &&
        phone.includes(word.replace(/\D/g, ""))),
  );
}

export function filterClients<T extends WorkspaceClient>(
  clients: readonly T[],
  options: {
    query: string;
    stage: ClientStage | "all";
    followUps: boolean;
    today: string;
    extra?: (client: T) => string;
  },
): T[] {
  const result = clients.filter(
    (client) =>
      (options.stage === "all" || client.stage === options.stage) &&
      matchesClient(client, options.query, options.extra?.(client)) &&
      (!options.followUps || (client.stage !== "archived" && client.followUpOn !== null)),
  );
  if (options.followUps)
    result.sort(
      (a, b) => a.followUpOn!.localeCompare(b.followUpOn!) || a.name.localeCompare(b.name),
    );
  return result;
}

/** Include every canonical stage, so an unclassified/new client cannot disappear from the board. */
export function clientBoard<T extends WorkspaceClient>(clients: readonly T[]) {
  return CLIENT_STAGES.map((stage) => ({
    stage,
    label: CLIENT_STAGE_LABELS[stage],
    clients: clients.filter((client) => client.stage === stage),
  }));
}

export function clientContactHref(kind: "email" | "phone", value: string): string | null {
  const trimmed = value.trim();
  if ([...trimmed].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    return null;
  if (kind === "email")
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
      ? `mailto:${encodeURIComponent(trimmed)}`
      : null;
  const number = trimmed.replace(/[\s().-]/g, "");
  return /^\+?\d{3,20}$/.test(number) ? `tel:${number}` : null;
}

/** Existing explicit IDs only. Identical names/emails never establish a client relationship. */
export function clientRelationships(
  client: WorkspaceClient,
  galleries: readonly LocalDeliveryGallerySummary[],
  invoices: readonly LocalInvoiceDraft[],
) {
  const linkedInvoiceIds = new Set([
    ...client.invoiceIds,
    ...invoices.filter((invoice) => invoice.clientId === client.id).map((invoice) => invoice.id),
  ]);
  return {
    galleries: client.galleryIds.map((id) => ({
      id,
      record: galleries.find((gallery) => gallery.id === id) ?? null,
    })),
    invoices: [...linkedInvoiceIds].map((id) => {
      const record = invoices.find((invoice) => invoice.id === id) ?? null;
      // Conflicting explicit IDs must not silently attach another person's financial details.
      const conflict = Boolean(record?.clientId && record.clientId !== client.id);
      return { id, record: conflict ? null : record, conflict };
    }),
  };
}
