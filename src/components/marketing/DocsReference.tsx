import { FOTO_MCP_URL } from "@/lib/foto-mcp";
import { PRODUCT_NAME } from "@/lib/product";

const TOC = [
  ["introduction", "Introduction"],
  ["quickstart", "Quickstart"],
  ["authentication", "Authentication"],
  ["plans", "Rate limits & plans"],
  ["errors", "Errors"],
  ["clipping", "Clipping"],
  ["captions", "Captions"],
  ["automations", "Automations"],
  ["scheduling", "Scheduling"],
  ["credits", "Credits"],
  ["mcp", "MCP server"],
  ["changelog", "Changelog"],
] as const;

function Table({
  headers,
  rows,
}: {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <div className="docs-ref__table">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row[0]}-${i}`}>
              {row.map((cell, j) => (
                <td key={j}>{j < 2 ? <code>{cell}</code> : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocsReference() {
  return (
    <div className="public-editorial public-editorial--wide docs-ref">
      <aside className="docs-ref__toc">
        <p>Documentation</p>
        <nav aria-label="Docs sections">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="docs-ref__toc-foot">
          <a href="/dashboard">Get an API key →</a>
          <a href="https://github.com/melanikshrestha-boop/LensOSS" target="_blank" rel="noreferrer">
            MCP on GitHub →
          </a>
        </div>
      </aside>
      <article className="docs-ref__body">
        <header>
          <p className="docs-ref__eyebrow">API Reference</p>
          <h1>
            {PRODUCT_NAME} <em>API</em>
          </h1>
          <p>
            Import a shoot, pick keepers, finish in Lightroom Classic or Photoshop, and send a
            gallery. Connect socials and post selected photographs to the accounts you linked,
            including Stories and highlights. REST over HTTPS is not required for agents: the
            official connector is MCP.
          </p>
          <div className="docs-ref__actions">
            <a className="marketing-action marketing-action--primary" href="/dashboard">
              Get an API key
            </a>
            <a className="marketing-action marketing-action--primary" href="/mcp">
              Install the MCP server
            </a>
          </div>
        </header>

        <section id="introduction">
          <h2>Introduction</h2>
          <p>
            The {PRODUCT_NAME} API lets assistants and apps work a photography job: pick keepers
            from a shoot, read published plans, and send a gallery copy. Originals stay on the
            machine unless you publish. There is no clip-farm endpoint and no bulk YouTube
            clipping.
          </p>
          <p>
            <strong>Base URL:</strong>
          </p>
          <pre>
            <code>{FOTO_MCP_URL}</code>
          </pre>
          <p>
            <strong>Agent-friendly from day one.</strong> Workflow, plans, and public notes are MCP
            tools at <code>{FOTO_MCP_URL}</code>. See <a href="#mcp">MCP server</a>.
          </p>
        </section>

        <section id="quickstart">
          <h2>Quickstart</h2>
          <p>Three steps: connect, list tools, ask about a shoot.</p>
          <h3>1. Get an API key</h3>
          <p>
            Sign in and open the <a href="/dashboard">dashboard</a>. Paid plans unlock workspace
            tools. Public MCP list/call for workflow, plans, and articles does not need a key.
          </p>
          <h3>2. Check your credits</h3>
          <pre>
            <code>{`curl ${FOTO_MCP_URL} \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": { "name": "foto_plans", "arguments": {} }
  }'`}</code>
          </pre>
          <p>Returns published plan names and monthly amounts in USD. Not a quote.</p>
          <h3>3. Walk the shoot</h3>
          <pre>
            <code>{`curl ${FOTO_MCP_URL} \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": { "name": "foto_workflow", "arguments": {} }
  }'`}</code>
          </pre>
        </section>

        <section id="authentication">
          <h2>Authentication</h2>
          <p>
            Public MCP tools (workflow, plans, articles) do not need a key. Your {PRODUCT_NAME}{" "}
            account still owns shoots, galleries, and invoices. Do not paste workspace secrets into
            a prompt.
          </p>
          <pre>
            <code>Authorization: Bearer your_key_here</code>
          </pre>
          <p>
            Keys are tied to a single account. Rotate from the dashboard. Accounts without an
            active paid plan receive <code>403 subscription_required</code> on billed workspace
            tools, with <code>upgrade_url</code> pointing at <code>/pricing</code>.
          </p>
        </section>

        <section id="plans">
          <h2>Rate limits &amp; plans</h2>
          <p>
            Per-account limits are enforced at the connector. Hitting them returns{" "}
            <code>429 Too Many Requests</code>.
          </p>
          <Table
            headers={["Field", "Type", "Required", "Description"]}
            rows={[
              [
                "MCP list/call",
                "60 / minute",
                "optional",
                "tools/list and tools/call share this cap per account.",
              ],
              [
                "Concurrent Lightroom jobs",
                "3",
                "optional",
                "At most three Lightroom Classic handoffs can run at once per account.",
              ],
              [
                "Failed billed calls",
                "20 / hour",
                "optional",
                "Twenty failing billed calls in an hour pause further billed calls until the window resets. Read tools stay up.",
              ],
              [
                "Auth failures",
                "10 / minute",
                "optional",
                "Repeated invalid-key attempts on the same prefix are rate-limited.",
              ],
            ]}
          />
          <p>
            Photo credits are not a rate limit. They reset with the billing cycle. Hobby is USD 20
            / month (1,000 credits). Creator is USD 30 / month (5,000 credits, Adobe). Enterprise
            is custom.
          </p>
        </section>

        <section id="errors">
          <h2>Errors</h2>
          <p>
            Errors are returned as JSON with <code>error</code> (a stable code you can branch on)
            and <code>message</code> (a human-readable string).
          </p>
          <Table
            headers={["Field", "Type", "Required", "Description"]}
            rows={[
              [
                "400",
                "bad_request",
                "optional",
                "Invalid request body. Common codes: invalid_json, unknown_tool, missing_arguments, shoot_unavailable.",
              ],
              [
                "401",
                "invalid_api_key / api_key_revoked / account_not_found",
                "optional",
                "Missing or malformed Authorization header, revoked key, or the account associated with the key has been deleted.",
              ],
              [
                "402",
                "insufficient_credits",
                "optional",
                "Not enough photo credits to start the job. Body includes credits_remaining, credits_needed, and upgrade_url.",
              ],
              [
                "403",
                "subscription_required",
                "optional",
                `Your ${PRODUCT_NAME} account has no active paid plan. Response includes upgrade_url pointing to /pricing.`,
              ],
              [
                "404",
                "not_found",
                "optional",
                "Shoot, gallery, or job does not exist, or is not owned by the authenticated account.",
              ],
              [
                "409",
                "cannot_cancel",
                "optional",
                "Attempting to cancel a send that is no longer scheduled (already processing or delivered).",
              ],
              [
                "429",
                "rate_limit",
                "optional",
                "Per-account rate limit hit. Honor the Retry-After header if present.",
              ],
              [
                "500",
                "server_error",
                "optional",
                "Temporary server error. Safe to retry idempotent reads. Do not retry billed writes without idempotency.",
              ],
              [
                "503",
                "usage_unavailable",
                "optional",
                "Credit usage could not be read temporarily. Safe to retry foto_plans.",
              ],
            ]}
          />
        </section>

        <section id="clipping">
          <h2>Clipping</h2>
          <p>
            Clipping here is picking: take a huge card and keep the frames that are actually the
            night. {PRODUCT_NAME} flags blur, blinks, and near-duplicates. You still mark the
            keepers. Rejects are flags, not deletes.
          </p>
          <p>Call the workflow tool when an assistant needs the order of work:</p>
          <pre>
            <code>{`{
  "method": "tools/call",
  "params": { "name": "foto_workflow", "arguments": {} }
}`}</code>
          </pre>
        </section>

        <section id="captions">
          <h2>Captions</h2>
          <p>
            Gallery captions are titles and notes you attach to a delivered photograph. They do
            not reframe the file and they do not burn social-video styles onto a clip.
          </p>
          <p>
            Write captions in the gallery before you send. Assistants can list public notes with{" "}
            <code>foto_articles</code>.
          </p>
        </section>

        <section id="automations">
          <h2>Automations</h2>
          <p>
            Connect social accounts in Connectors. One send can go to the feed, Stories, and
            specific highlights on the accounts you linked. {PRODUCT_NAME} does not post to
            accounts you have not connected, and it does not watch a YouTube channel for new
            uploads.
          </p>
        </section>

        <section id="scheduling">
          <h2>Scheduling</h2>
          <p>
            Schedule a gallery send or a social post of photographs you already picked. Live
            destinations are the accounts you connected. Instagram, Facebook, and Threads post
            only when that account is linked.
          </p>
        </section>

        <section id="credits">
          <h2>Credits</h2>
          <p>Photo credits come with the published plan. Confirm the amount at checkout.</p>
          <pre>
            <code>{`{
  "method": "tools/call",
  "params": { "name": "foto_plans", "arguments": {} }
}`}</code>
          </pre>
          <p>Hobby 1,000 / month. Creator 5,000 / month. Unused credits do not roll into cash.</p>
        </section>

        <section id="mcp">
          <h2>MCP server</h2>
          <p>
            Streamable HTTP at <code>{FOTO_MCP_URL}</code>. Tools: <code>foto_workflow</code>,{" "}
            <code>foto_plans</code>, <code>foto_articles</code>.
          </p>
          <p>
            Install from the <a href="/mcp">MCP page</a> for Claude, ChatGPT, Cursor, Grok, or
            Julius. Source lives on{" "}
            <a href="https://github.com/melanikshrestha-boop/LensOSS" target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
          <pre>
            <code>{`from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
)

response = client.responses.create(
    model="grok-4.6",
    input="Pick keepers from tonight's shoot and send a gallery copy.",
    tools=[{
        "type": "mcp",
        "server_url": "${FOTO_MCP_URL}",
        "server_label": "celinen",
    }],
)
print(response.output_text)`}</code>
          </pre>
        </section>

        <section id="changelog">
          <h2>Changelog</h2>
          <h3>2026-09-10 · Public connector</h3>
          <ul>
            <li>MCP tools for workflow, plans, and public articles.</li>
            <li>Lightroom Classic and Photoshop on the connectors arc.</li>
            <li>Errors documented as stable JSON codes.</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
