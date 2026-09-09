import { useState, type FormEvent } from "react";
import {
  BOOKING_STATUSES,
  CLIENT_STAGES,
  buildClientBooking,
  buildWorkspaceClient,
  clientToInput,
  emptyClientInput,
  upsertClientBooking,
  type BookingStatus,
  type ClientBooking,
  type ClientInput,
  type WorkspaceClient,
} from "@/lib/client-workspace";
import { CLIENT_STAGE_LABELS } from "@/lib/clients/crm";

export type ClientEdit =
  | { kind: "client"; client?: WorkspaceClient; revision: number; followUp?: boolean }
  | { kind: "booking"; client: WorkspaceClient; booking?: ClientBooking; revision: number };

export function ClientEditor({
  edit,
  saving,
  onSave,
  onCancel,
}: {
  edit: ClientEdit;
  saving: boolean;
  onSave: (client: WorkspaceClient, revision: number) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ClientInput>(() =>
    edit.client ? clientToInput(edit.client) : emptyClientInput(),
  );
  const [booking, setBooking] = useState(() => ({
    title: edit.kind === "booking" ? (edit.booking?.title ?? "") : "",
    date: edit.kind === "booking" ? (edit.booking?.date ?? "") : "",
    location: edit.kind === "booking" ? (edit.booking?.location ?? "") : "",
    status: (edit.kind === "booking"
      ? (edit.booking?.status ?? "requested")
      : "requested") as BookingStatus,
  }));
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const result =
      edit.kind === "client"
        ? buildWorkspaceClient(draft, edit.client)
        : buildClientBooking(booking, edit.booking);
    if (!result.ok) return setError(result.error);
    const next =
      edit.kind === "client"
        ? (result.value as WorkspaceClient)
        : upsertClientBooking(edit.client, result.value as ClientBooking);
    if (await onSave(next, edit.revision)) onCancel();
  }
  function field(key: keyof ClientInput, title: string, type = "text", required = false) {
    return (
      <label>
        {title}
        <input
          type={type}
          value={draft[key]}
          required={required}
          autoFocus={key === (edit.kind === "client" && edit.followUp ? "followUpOn" : "name")}
          onChange={(event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }))}
        />
      </label>
    );
  }
  return (
    <form
      className="clients-editor"
      onSubmit={(event) => {
        void submit(event);
      }}
      aria-label={edit.kind === "booking" ? "Booking details" : "Client details"}
    >
      <div className="clients-section-heading">
        <h2>
          {edit.kind === "booking"
            ? edit.booking
              ? "Edit booking"
              : "Add booking"
            : edit.client
              ? "Edit contact"
              : "New client"}
        </h2>
      </div>
      <fieldset disabled={saving}>
        {edit.kind === "client" ? (
          <>
            {field("name", "Name", "text", true)}
            {field("org", "Organization")}
            {field("email", "Email", "email")}
            {field("phone", "Phone", "tel")}
            <label>
              Stage
              <select
                value={draft.stage}
                onChange={(event) =>
                  setDraft({ ...draft, stage: event.target.value as ClientInput["stage"] })
                }
              >
                {CLIENT_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {CLIENT_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </label>
            {field("followUpOn", "Next follow-up", "date")}
            {field("source", "Source / photography specialty")}
            {field("budget", "Planning budget (USD)", "text")}
            <label className="clients-form-wide">
              Brief / notes
              <textarea
                rows={4}
                value={draft.brief}
                onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Booking name
              <input
                autoFocus
                required
                value={booking.title}
                onChange={(event) => setBooking({ ...booking, title: event.target.value })}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={booking.date}
                onChange={(event) => setBooking({ ...booking, date: event.target.value })}
              />
            </label>
            <label>
              Location
              <input
                value={booking.location}
                onChange={(event) => setBooking({ ...booking, location: event.target.value })}
              />
            </label>
            <label>
              Status
              <select
                value={booking.status}
                onChange={(event) =>
                  setBooking({ ...booking, status: event.target.value as BookingStatus })
                }
              >
                {BOOKING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status[0]!.toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </fieldset>
      {error && (
        <p className="clients-alert" role="alert">
          {error}
        </p>
      )}
      <div className="clients-form-actions">
        <button type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button className="clients-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
