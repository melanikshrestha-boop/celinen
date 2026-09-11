import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { BrandMark } from "@/components/marketing/BrandMark";
import { FOTO_MCP_URL } from "@/lib/foto-mcp";

type ClientId = "claude" | "chatgpt" | "cursor" | "grok" | "julius";
type SnippetId = "bash" | "python" | "openai" | "javascript" | "grok";

const CLIENTS: { id: ClientId; label: string; mark: string; href: string }[] = [
  { id: "claude", label: "Claude", mark: "claude", href: "https://claude.ai/customize/connectors?modal=add-custom-connector" },
  { id: "chatgpt", label: "ChatGPT", mark: "openai", href: "https://chatgpt.com" },
  { id: "cursor", label: "Cursor", mark: "cursor", href: "https://cursor.com" },
  { id: "grok", label: "Grok", mark: "grok", href: "https://grok.com/connectors" },
  { id: "julius", label: "Julius", mark: "julius", href: "https://julius.ai/data-connectors" },
];

const STEPS: Record<ClientId, { title: string; body: string; href?: string; hrefLabel?: string }[]> = {
  claude: [
    {
      title: "Open Claude settings",
      body: "Open the Claude app or claude.ai and go to Customize → Connectors.",
      href: "https://claude.ai/customize/connectors?modal=add-custom-connector",
      hrefLabel: "Customize → Connectors",
    },
    { title: "Add the foto connector", body: "Name it foto and paste the URL." },
    { title: "Connect", body: "Click Connect, then ask Claude to list FOTO plans or walk the pick → send path." },
  ],
  chatgpt: [
    { title: "Turn on developer mode", body: "In ChatGPT go to Settings → Apps → Advanced, and enable developer mode." },
    { title: "Create the connector", body: "Create an app, paste the foto MCP URL, and scan tools." },
    { title: "Use it in chat", body: "Ask ChatGPT to read FOTO plans or the public photography notes." },
  ],
  cursor: [
    { title: "Open MCP settings", body: "In Cursor, open MCP settings and add a new HTTP server." },
    { title: "Paste the URL", body: "Set the server URL to the foto connector and save." },
    { title: "Reload", body: "Reload Cursor, then ask it to describe the FOTO workflow." },
  ],
  grok: [
    {
      title: "Open Grok connectors",
      body: "On grok.com go to Connectors → New Connector → Custom.",
      href: "https://grok.com/connectors",
      hrefLabel: "grok.com/connectors",
    },
    { title: "Paste the URL", body: "Name it foto and paste the same MCP URL." },
    { title: "Or call it from the API", body: "Use the Grok snippet below with server_url pointed at foto." },
  ],
  julius: [
    {
      title: "Open Data Connectors",
      body: "In Julius go to Data Connectors and add an MCP connection.",
      href: "https://julius.ai/data-connectors",
      hrefLabel: "Julius Data Connectors",
    },
    { title: "Paste the URL", body: "Name it foto and paste the connector URL." },
    { title: "Ask in a notebook", body: "Ask Julius for FOTO plans or the same-night gallery path." },
  ],
};

const SNIPPETS: { id: SnippetId; label: string; code: string }[] = [
  {
    id: "bash",
    label: "Bash",
    code: `curl https://lenslab.dev/api/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "foto", "version": "1.0" }
    }
  }'`,
  },
  {
    id: "python",
    label: "Python",
    code: `import json, os, urllib.request

req = urllib.request.Request(
    "https://lenslab.dev/api/mcp",
    data=json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
    }).encode(),
    headers={"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())`,
  },
  {
    id: "openai",
    label: "Python (OpenAI)",
    code: `from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
)

response = client.responses.create(
    model="grok-4.6",
    input="Pick keepers from tonight's shoot and send a gallery copy.",
    tools=[{
        "type": "mcp",
        "server_url": "https://lenslab.dev/api/mcp",
        "server_label": "foto",
    }],
)

print(response.output_text)`,
  },
  {
    id: "javascript",
    label: "JavaScript",
    code: `const response = await fetch("https://lenslab.dev/api/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "foto_workflow", arguments: {} },
  }),
});
console.log(await response.json());`,
  },
  {
    id: "grok",
    label: "Grok",
    code: `grok mcp add --transport http foto https://lenslab.dev/api/mcp

from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
)

response = client.responses.create(
    model="grok-4.6",
    input="Pick keepers from tonight's shoot and send a gallery copy.",
    tools=[{
        "type": "mcp",
        "server_url": "https://lenslab.dev/api/mcp",
        "server_label": "foto",
    }],
)

print(response.output_text)`,
  },
];

const FAQ: [string, string][] = [
  [
    "What is the foto MCP server?",
    "A Model Context Protocol server. Your assistant can read the FOTO workflow, published USD plan amounts, and public photography notes from one URL.",
  ],
  [
    "Which AI apps can connect?",
    "Any MCP client that accepts a URL: Claude, ChatGPT, Cursor, Grok, Julius, Claude Code, and other Streamable HTTP clients.",
  ],
  [
    "Do I need an API key?",
    "Paste the URL to connect. Grok’s API snippet uses your XAI_API_KEY only because that call goes through api.x.ai. The foto connector itself is the URL.",
  ],
  [
    "Is it free?",
    "Connecting is free. Running FOTO on a shoot uses your FOTO plan. Hobby is USD 20 / month. Creator is USD 30 / month.",
  ],
];

function copy(value: string) {
  void navigator.clipboard.writeText(value);
}

function highlightSnippet(code: string) {
  const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const withStrings = escaped.replace(/("[^"\n]*"|'[^'\n]*')/g, "\u0000$1\u0001");
  return withStrings
    .replace(/\b(from|import|print|const|await|return)\b/g, '<span class="mcp-kw">$1</span>')
    .replace(/\u0000([^\u0001]*)\u0001/g, '<span class="mcp-str">$1</span>');
}

export function McpPage() {
  const [client, setClient] = useState<ClientId>("claude");
  const [snippet, setSnippet] = useState<SnippetId>("bash");
  const steps = STEPS[client];
  const active = useMemo(() => SNIPPETS.find((item) => item.id === snippet) ?? SNIPPETS[0], [snippet]);
  const clientLabel = CLIENTS.find((item) => item.id === client)?.label ?? "Claude";
  const snippetIndex = SNIPPETS.findIndex((item) => item.id === snippet);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const snippetRef = useRef(snippet);
  const liveRef = useRef(false);
  const slideRef = useRef(0);
  snippetRef.current = snippet;

  const paintThumb = (slide: number, live: boolean) => {
    slideRef.current = slide;
    liveRef.current = live;
    trackRef.current?.classList.toggle("is-live", live);
    if (thumbRef.current) thumbRef.current.style.transform = `translate3d(${slide * 100}%, 0, 0)`;
  };

  useLayoutEffect(() => {
    paintThumb(liveRef.current ? slideRef.current : Math.max(0, snippetIndex), liveRef.current);
  }, [snippetIndex]);

  const followSnippet = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const count = SNIPPETS.length;
    const pad = 4;
    const inner = Math.max(1, box.width - pad * 2);
    const u = (event.clientX - box.left - pad) / inner;
    const slide = Math.min(count - 1, Math.max(0, u * count - 0.5));
    paintThumb(slide, true);
    const t = (event.clientX - box.left) / box.width;
    const next = SNIPPETS[Math.min(count - 1, Math.max(0, Math.floor(t * count)))];
    if (next) setSnippet((current) => (current === next.id ? current : next.id));
  };

  const releaseSnippet = () => {
    paintThumb(Math.max(0, SNIPPETS.findIndex((item) => item.id === snippetRef.current)), false);
  };

  return (
    <div className="public-editorial public-editorial--wide mcp-page">
      <header className="mcp-page__intro">
        <p className="mcp-page__marks" aria-hidden="true">
          {CLIENTS.map((item) => (
            <BrandMark key={item.id} id={item.mark} />
          ))}
        </p>
        <h1>
          The <em>foto</em> MCP for {clientLabel}
        </h1>
        <p>
          Connect FOTO to your assistant. Pick keepers, send a gallery, and read published plans from
          the prompt.
        </p>
      </header>

      <h2>Get connected in 3 steps</h2>
      <div className="mcp-page__clients" role="tablist" aria-label="AI apps">
        {CLIENTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={client === item.id}
            onClick={() => {
              setClient(item.id);
              if (item.id === "grok") setSnippet("grok");
            }}
          >
            <BrandMark id={item.mark} />
            {item.label}
          </button>
        ))}
      </div>
      <ol className="mcp-page__steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span>{index + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {step.href ? (
                <a href={step.href} rel="noreferrer" target="_blank">
                  {step.hrefLabel}
                </a>
              ) : null}
              {index === 1 ? (
                <p className="mcp-page__url">
                  <code>{FOTO_MCP_URL}</code>
                  <button type="button" onClick={() => copy(FOTO_MCP_URL)}>
                    Copy
                  </button>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <section className="mcp-page__connector" aria-labelledby="mcp-url-heading">
        <h2 id="mcp-url-heading">URL connector</h2>
        <p>Same URL in Claude, ChatGPT, Cursor, Grok, and Julius. Grok can also take it as a remote MCP tool.</p>
        <a className="mcp-page__docs" href="/docs">
          Read docs
        </a>
        <div className="mcp-snippet">
          <div className="mcp-snippet__bar">
            <div
              ref={trackRef}
              className="mcp-snippet__tabs"
              role="tablist"
              aria-label="Connector snippets"
              onPointerMove={followSnippet}
              onPointerEnter={followSnippet}
              onPointerLeave={releaseSnippet}
              onPointerCancel={releaseSnippet}
            >
              <span className="mcp-snippet__thumb" ref={thumbRef} aria-hidden="true" />
              {SNIPPETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={snippet === item.id}
                  onClick={() => setSnippet(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="mcp-snippet__copy" onClick={() => copy(active.code)} aria-label="Copy snippet">
              Copy
            </button>
          </div>
          <pre>
            <code dangerouslySetInnerHTML={{ __html: highlightSnippet(active.code) }} />
          </pre>
        </div>
      </section>

      <section className="mcp-page__demo" aria-labelledby="mcp-demo-heading">
        <h2 id="mcp-demo-heading">See it in action</h2>
        <figure>
          <p className="mcp-page__bubble mcp-page__bubble--user">
            <BrandMark id={CLIENTS.find((item) => item.id === client)?.mark ?? "claude"} />
            {clientLabel}
            <span>Send a client gallery the same night. Keep the masters.</span>
          </p>
          <p className="mcp-page__bubble">
            <LogoMark size={24} />
            foto
            <span>
              Pick first. Publish a copy. Originals stay with you. I’ll walk the order of work, not a speed
              claim.
            </span>
          </p>
        </figure>
      </section>

      <section className="mcp-page__faq" aria-labelledby="mcp-faq-heading">
        <h2 id="mcp-faq-heading">Frequently asked</h2>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <section className="mcp-page__grid" aria-labelledby="mcp-grid-heading">
        <h2 id="mcp-grid-heading">
          Connect <em>foto</em> to any AI
        </h2>
        <ul>
          {CLIENTS.map((item) => (
            <li key={item.id}>
              <a href={item.href} rel="noreferrer" target="_blank">
                <BrandMark id={item.mark} />
                {item.label}
              </a>
            </li>
          ))}
          <li>
            <a href="/docs">Read the docs</a>
          </li>
        </ul>
      </section>
    </div>
  );
}
