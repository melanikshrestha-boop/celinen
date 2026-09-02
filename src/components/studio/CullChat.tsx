import { useCallback, useEffect, useRef, useState } from "react";

export type ToolName =
  | "cull"
  | "keep_top"
  | "reject_flagged"
  | "set_filter"
  | "select_photo"
  | "apply_edits"
  | "export_keepers"
  | "write_xmp"
  | "import_photos";

export type ToolCall = { name: ToolName; args: Record<string, unknown> };

type Msg = {
  role: "user" | "assistant";
  text: string;
  tools?: { name: string; result: string }[];
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "cull",
      description:
        "Run the culling pass over the whole shoot in the background: rejects blurred, duplicate, eyes-closed and low-scoring frames, keeps strong ones.",
      parameters: {
        type: "object",
        properties: {
          min_score: {
            type: "number",
            description: "Frames scoring below this are rejected. Default 45.",
          },
          keep_score: {
            type: "number",
            description: "Frames scoring at or above this are kept. Default 70.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "keep_top",
      description: "Keep only the N highest-scoring frames and reject everything else.",
      parameters: {
        type: "object",
        properties: { n: { type: "number", description: "How many frames to keep." } },
        required: ["n"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_flagged",
      description: "Reject every frame carrying any of the given flags.",
      parameters: {
        type: "object",
        properties: {
          flags: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "soft",
                "blur",
                "underexposed",
                "overexposed",
                "duplicate",
                "face-soft",
                "eyes-closed",
              ],
            },
          },
        },
        required: ["flags"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_filter",
      description: "Change which frames the filmstrip shows.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["all", "todo", "keepers", "flagged", "rejected"] },
        },
        required: ["filter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_photo",
      description:
        "Open a frame on the light table. Use 'best', 'worst', a filename, or a 1-based position.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_edits",
      description:
        "Apply develop settings. Values are -100..100 except crop. Target 'selected' or 'keepers'.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["selected", "keepers"] },
          exposure: { type: "number" },
          contrast: { type: "number" },
          temperature: { type: "number" },
          saturation: { type: "number" },
          highlights: { type: "number" },
          shadows: { type: "number" },
          crop: { type: "string", enum: ["orig", "1:1", "4:5", "3:2", "16:9"] },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_keepers",
      description: "Export every keeper as an edited JPEG.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "write_xmp",
      description: "Write XMP sidecars so Lightroom picks up the ratings and develop settings.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "import_photos",
      description: "Open the file picker so the photographer can load a shoot.",
      parameters: { type: "object", properties: {} },
    },
  },
];

type ApiMsg = Record<string, unknown>;

export function CullChat({
  context,
  execute,
}: {
  context: string;
  execute: (call: ToolCall) => Promise<string>;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const historyRef = useRef<ApiMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking, running]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || thinking) return;
      setInput("");
      setMsgs((m) => [...m, { role: "user", text }]);
      historyRef.current.push({ role: "user", content: text });
      setThinking(true);

      const used: { name: string; result: string }[] = [];
      try {
        for (let round = 0; round < 6; round++) {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [
                {
                  role: "system",
                  content: `You are the LensLabs culling assistant, embedded in the studio next to the photographer's shoot. You do the work — call tools instead of explaining steps. Be extremely brief: one short line, lowercase, no lists unless asked. Never ask permission for reversible actions; just run them and report the count. Current shoot state:\n${context}`,
                },
                ...historyRef.current,
              ],
              tools: TOOLS,
            }),
          });
          const data = (await res.json()) as {
            message?: { content?: string; tool_calls?: any[] };
            error?: string;
          };
          if (!res.ok || data.error) throw new Error(data.error ?? "Assistant unavailable.");
          const message = data.message ?? {};
          historyRef.current.push(message as ApiMsg);

          const calls = message.tool_calls ?? [];
          if (!calls.length) {
            setMsgs((m) => [
              ...m,
              {
                role: "assistant",
                text: message.content?.trim() || "done.",
                ...(used.length ? { tools: [...used] } : {}),
              },
            ]);
            return;
          }

          for (const call of calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.function?.arguments || "{}");
            } catch {
              /* empty args */
            }
            const name = call.function?.name as ToolName;
            setRunning(name.replace(/_/g, " "));
            let result: string;
            try {
              result = await execute({ name, args });
            } catch (err) {
              result = `failed: ${(err as Error).message}`;
            }
            used.push({ name: name.replace(/_/g, " "), result });
            historyRef.current.push({
              role: "tool",
              tool_call_id: call.id,
              content: result,
            });
          }
          setRunning(null);
        }
        setMsgs((m) => [...m, { role: "assistant", text: "stopped — too many steps.", tools: used }]);
      } catch (err) {
        setMsgs((m) => [...m, { role: "assistant", text: (err as Error).message }]);
      } finally {
        setRunning(null);
        setThinking(false);
        inputRef.current?.focus();
      }
    },
    [context, execute, thinking],
  );

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-moss">Assistant</span>
        {(thinking || running) && (
          <span className="font-mono text-[10px] text-rust">
            {running ? `${running}…` : "thinking…"}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-3 pr-1">
        {!msgs.length && (
          <div className="space-y-2 font-mono text-[11px] text-moss">
            <p>tell it what you want. it culls in the background.</p>
            {[
              "cull the shoot and keep the top 40",
              "reject everything blurred or duplicate",
              "warm the keepers slightly and export",
            ].map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                className="block w-full rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-ink hover:text-paper2"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <span className="max-w-[85%] rounded-lg bg-ink px-3 py-1.5 text-[12px] leading-relaxed text-paper2">
                {m.text}
              </span>
            ) : (
              <div className="max-w-[95%] space-y-1.5">
                {m.tools?.map((t, j) => (
                  <div key={j} className="font-mono text-[10px] text-moss">
                    <span className="text-rust">▸</span> {t.name} — {t.result}
                  </div>
                ))}
                <p className="text-[12px] leading-relaxed text-ink">{m.text}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-border pt-2"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="cull this shoot…"
          className="w-full resize-none rounded-md border border-input bg-paper px-2.5 py-2 font-mono text-[11px] text-ink outline-none placeholder:text-moss focus:border-ink/40"
        />
        <div className="flex items-center justify-between pt-1.5">
          <span className="font-mono text-[10px] text-moss">enter to send</span>
          <button
            type="submit"
            disabled={thinking || !input.trim()}
            className="rounded-md bg-ink px-3 py-1.5 font-mono text-[11px] text-paper2 transition-colors hover:bg-rust disabled:opacity-40"
          >
            Run
          </button>
        </div>
      </form>
    </div>
  );
}
