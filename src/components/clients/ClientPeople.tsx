import { CLIENT_STAGES, type ClientStage, type WorkspaceClient } from "@/lib/client-workspace";
import {
  CLIENT_STAGE_LABELS,
  clientBoard,
  clientContactHref,
  clientFollowUp,
} from "@/lib/clients/crm";
import { formatDate, initials } from "@/lib/clients/sheet";

export function ClientContact({ client }: { client: Pick<WorkspaceClient, "email" | "phone"> }) {
  return (
    <div className="clients-contact">
      {(["email", "phone"] as const).map((kind) => {
        const value = client[kind];
        const href = clientContactHref(kind, value);
        return value ? (
          href ? (
            <a key={kind} href={href}>
              {value}
            </a>
          ) : (
            <span key={kind}>{value}</span>
          )
        ) : null;
      })}
      {!client.email && !client.phone && <span className="clients-muted">No contact details</span>}
    </div>
  );
}

export function ClientFollowUp({ client, today }: { client: WorkspaceClient; today: string }) {
  const status = clientFollowUp(client, today);
  return (
    <span className={`clients-followup is-${status}`}>
      {client.followUpOn ? (
        <>
          {formatDate(client.followUpOn)}
          {status === "overdue"
            ? " · Overdue"
            : status === "today"
              ? " · Today"
              : status === "archived"
                ? " · Archived"
                : ""}
        </>
      ) : (
        "Not scheduled"
      )}
    </span>
  );
}

export function ClientPeople({
  clients,
  today,
  board,
  busy,
  onOpen,
  onFollowUp,
  onStage,
}: {
  clients: readonly WorkspaceClient[];
  today: string;
  board: boolean;
  busy: boolean;
  onOpen: (client: WorkspaceClient) => void;
  onFollowUp: (client: WorkspaceClient) => void;
  onStage: (client: WorkspaceClient, stage: ClientStage) => void;
}) {
  if (board)
    return (
      <div className="clients-board">
        {clientBoard(clients).map((group) => (
          <section
            className="clients-board-col"
            key={group.stage}
            aria-label={`${group.label} clients`}
          >
            <h2>
              {group.label} <span>{group.clients.length}</span>
            </h2>
            {group.clients.length ? (
              group.clients.map((client) => (
                <article className="clients-card" key={client.id}>
                  <button
                    className="clients-name-button"
                    type="button"
                    onClick={() => onOpen(client)}
                  >
                    {client.name}
                  </button>
                  {client.org && <p className="clients-muted">{client.org}</p>}
                  <ClientContact client={client} />
                  <button
                    className="clients-date-button"
                    type="button"
                    disabled={busy}
                    onClick={() => onFollowUp(client)}
                    aria-label={`Schedule follow-up with ${client.name}`}
                  >
                    <ClientFollowUp client={client} today={today} />
                  </button>
                  <select
                    aria-label={`Stage for ${client.name}`}
                    value={client.stage}
                    disabled={busy}
                    onChange={(event) => onStage(client, event.target.value as ClientStage)}
                  >
                    {CLIENT_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {CLIENT_STAGE_LABELS[stage]}
                      </option>
                    ))}
                  </select>
                </article>
              ))
            ) : (
              <p className="clients-board-empty">No clients</p>
            )}
          </section>
        ))}
      </div>
    );
  return (
    <table className="clients-people">
      <caption className="clients-sr-only">
        Client contacts, stages, and scheduled follow-ups
      </caption>
      <thead>
        <tr>
          <th scope="col">Client</th>
          <th scope="col">Contact</th>
          <th scope="col">Stage</th>
          <th scope="col">Next follow-up</th>
        </tr>
      </thead>
      <tbody>
        {clients.map((client) => (
          <tr key={client.id}>
            <td>
              <button className="clients-person" type="button" onClick={() => onOpen(client)}>
                <span className="clients-avatar" aria-hidden="true">
                  {initials(client.name)}
                </span>
                <span>
                  <strong>{client.name}</strong>
                  {client.org && <small>{client.org}</small>}
                </span>
              </button>
            </td>
            <td>
              <ClientContact client={client} />
            </td>
            <td>
              <span className="clients-stage">{CLIENT_STAGE_LABELS[client.stage]}</span>
            </td>
            <td>
              <button
                className="clients-date-button"
                type="button"
                disabled={busy}
                onClick={() => onFollowUp(client)}
                aria-label={`Schedule follow-up with ${client.name}`}
              >
                <ClientFollowUp client={client} today={today} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
