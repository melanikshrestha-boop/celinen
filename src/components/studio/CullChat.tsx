import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Folder, Image, Plus, X } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { useChatHistory, ChatSaveStatus } from "@/components/workbench/ChatHistory";
import { transcriptContext, type ChatMessage } from "@/lib/chat-history";
import { DEFAULT_PREFERENCES, shouldSendMessage } from "@/lib/account-preferences";
import { assistantPersonalization } from "@/lib/settings-transfer";
import { ReadReply } from "@/components/account/ReadReply";
import { notifyResponseReady } from "@/lib/workspace-notifications";
import { ShootOverview } from "@/components/workbench/ShootOverview";
import type { ShootBrief } from "@/lib/studio/shoot-brief";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { workbenchNavigation } from "@/lib/workbench";
import { workspaceStorageKey } from "@/lib/workspace-storage";
import { parseWorkspaceRequest } from "@/lib/workbench-projects";
import {
  LOCAL_COMMAND_HELP,
  STUDIO_TOOL_DEFINITIONS,
  isToolName,
  parseLocalCommand,
  type ToolCall,
} from "@/lib/studio/commands";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { parseCreativeEdit, type CreativeEditPlan } from "@/lib/studio/creative-edits";
import { studioCommandRefusal, studioToolBoundary } from "@/lib/studio/command-safety";
import type { EditTarget, StudioProposal } from "@/lib/studio/proposals";
import { ProposalReview } from "./ProposalReview";
import { parseAdobeSettingsPaste, type AdobeSettingsPastePlan } from "@/lib/studio/adobe-paste";
import {
  parseStudioWorkflowIntent,
  type StudioWorkflowIntent,
} from "@/lib/studio/workflow-intents";

export type { ToolCall, ToolName } from "@/lib/studio/commands";

type Msg = ChatMessage;

type ApiMsg = Record<string, unknown>;
/** Ephemeral receipt for a real selection, not a second upload queue or saved shoot. */
export type ImportAttachment = {
  name: string;
  count: number | null;
  kind: "folder" | "files";
  preview?: File;
};

const STUDIO_PENDING_COMMAND_KEY = "lenslabs.pending-command.v1:studio";
const LEGACY_PENDING_COMMAND_KEY = "lenslabs.pending-command.v1";
const noPreview = () =>
  "No preview is waiting here. Open Studio for plain-English editing with before/after review.";
const noAction = () => {};

export function CullChat(props: Parameters<typeof CullChatSession>[0]) {
  const history = useChatHistory();
  if (history && !history.ready)
    return (
      <div className="workbench-chat">
        <ChatSaveStatus />
        {!history.error && <p className="workbench-loading">Opening your conversations…</p>}
      </div>
    );
  return <CullChatSession key={history?.active?.id ?? "session-chat"} {...props} />;
}
function CullChatSession({
  workspace = false,
  storageScope = "device-local",
  onConversationChange,
  onWorkspaceRequest,
  onNavigate,
  context,
  execute,
  stageEdit = noPreview,
  proposal = null,
  before = false,
  onCompare = noAction,
  onApply = noPreview,
  onDiscard = noPreview,
  onTarget = noAction,
  suggestedPrompt = null,
  stageAdobeSettings = noPreview,
  frameCount = 0,
  status = null,
  importProgress = null,
  importing = false,
  importAttachment = null,
  dragActive = false,
  onImportFolder,
  onImportFiles,
  onCancelImport,
  onWorkflow,
  shoot,
  onReviewShoot = noAction,
  onOpenPhoto = noAction,
  recovery,
  deliveryReference,
  paused = false,
}: {
  workspace?: boolean;
  shoot?: ShootBrief | undefined;
  onReviewShoot?: () => void;
  onOpenPhoto?: (id: string) => void;
  recovery?: ReactNode;
  deliveryReference?: ReactNode;
  paused?: boolean;
  storageScope?: string;
  onConversationChange?: (hasContent: boolean) => void;
  onWorkspaceRequest?:
    ((request: { path: "/research" | "/mail"; query: string }) => Promise<boolean>) | undefined;
  onNavigate?: ((href: string) => Promise<boolean>) | undefined;
  context: string;
  execute: (call: ToolCall) => Promise<string>;
  stageEdit?: (plan: CreativeEditPlan) => string;
  proposal?: StudioProposal | null;
  before?: boolean;
  onCompare?: () => void;
  onApply?: () => string;
  onDiscard?: () => string;
  onTarget?: (target: EditTarget) => void;
  suggestedPrompt?: { text: string; at: number } | null;
  stageAdobeSettings?: (plan: AdobeSettingsPastePlan) => string;
  frameCount?: number;
  status?: string | null;
  importProgress?: { done: number; total: number } | null;
  importing?: boolean;
  importAttachment?: ImportAttachment | null;
  dragActive?: boolean;
  onImportFolder?: () => void;
  onImportFiles?: () => void;
  onCancelImport?: () => void;
  onWorkflow?: (intent: Exclude<StudioWorkflowIntent, { kind: "refusal" }>) => string;
}) {
  const history = useChatHistory();
  const account = useAccount();
  const notificationPreferences = useRef(account?.preferences ?? DEFAULT_PREFERENCES);
  notificationPreferences.current = account?.preferences ?? DEFAULT_PREFERENCES;
  const snapshot = history?.snapshot;
  const lockChat = history?.setLocked;
  const [msgs, setMsgs] = useState<Msg[]>(() => history?.active?.messages ?? []);
  const [input, setInput] = useState(() => history?.active?.draft ?? "");
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const historyRef = useRef<ApiMsg[]>(transcriptContext(history?.active?.messages ?? []));
  const lifecycle = useRef({ active: true, controller: new AbortController() });
  useEffect(() => {
    const run = { active: true, controller: new AbortController() };
    lifecycle.current = run;
    return () => {
      run.active = false;
      run.controller.abort();
    };
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [dismissedImport, setDismissedImport] = useState<ImportAttachment | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!importAttachment?.preview) {
      setAttachmentPreview(null);
      return;
    }
    const url = URL.createObjectURL(importAttachment.preview);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [importAttachment]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [expandedInput, setExpandedInput] = useState(false);
  useEffect(() => {
    if (!workspace || !inputRef.current) return;
    const input = inputRef.current;
    const resize = () => {
      input.style.height = "24px";
      const height = Math.min(192, Math.max(24, input.scrollHeight));
      input.style.height = `${height}px`;
      setExpandedInput(height > 24);
    };
    resize();
    // Observe width changes on the owning row, not the textarea's own height.
    let width = input.parentElement?.clientWidth;
    const widthObserver = new ResizeObserver(() => {
      const next = input.parentElement?.clientWidth;
      if (next !== width) {
        width = next;
        resize();
      }
    });
    if (input.parentElement) widthObserver.observe(input.parentElement);
    return () => widthObserver.disconnect();
  }, [input, workspace]);
  const sendingRef = useRef(false);
  useEffect(() => {
    onConversationChange?.(
      Boolean(input.trim()) ||
        thinking ||
        running !== null ||
        Boolean(history?.pending) ||
        Boolean(history?.error),
    );
  }, [input, thinking, running, history?.pending, history?.error, onConversationChange]);
  useEffect(() => {
    snapshot?.(msgs, input);
  }, [msgs, input, snapshot]);
  useEffect(() => {
    lockChat?.(thinking || running !== null || !!proposal || paused);
    return () => lockChat?.(false);
  }, [thinking, running, proposal, paused, lockChat]);

  const proposalAction = useCallback((action: () => string) => {
    let text: string;
    try {
      text = action();
    } catch (error) {
      text = error instanceof Error ? error.message : "That change could not be applied.";
    }
    historyRef.current.push({ role: "assistant", content: text });
    setMsgs((messages) => [...messages, { role: "assistant", text }]);
  }, []);

  useEffect(() => {
    if (suggestedPrompt) {
      setInput(suggestedPrompt.text);
      inputRef.current?.focus();
    }
  }, [suggestedPrompt]);

  useEffect(() => {
    if (!followsLatest.current) {
      setShowLatest(true);
      return;
    }
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior:
        account?.preferences.reduceMotion ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
    });
  }, [msgs, thinking, running, account?.preferences.reduceMotion]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      if (followsLatest.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      const key = workspaceStorageKey(STUDIO_PENDING_COMMAND_KEY, storageScope);
      const pending = sessionStorage.getItem(key)?.trim();
      if (pending) setInput(pending);
      sessionStorage.removeItem(key);
      if (storageScope === "device-local") sessionStorage.removeItem(LEGACY_PENDING_COMMAND_KEY);
    } catch {
      // Storage can be blocked in a private or embedded browser. The command
      // panel still works normally in that case.
    }
    // Do not summon the software keyboard when a phone opens an empty workspace.
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, [storageScope]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (
        !trimmed ||
        sendingRef.current ||
        importing ||
        paused ||
        history?.error ||
        history?.switching
      )
        return;
      const run = lifecycle.current;
      const checkActive = () => {
        if (!run.active) throw new DOMException("Conversation closed", "AbortError");
      };
      const safeExecute = async (call: ToolCall) => {
        checkActive();
        const result = await execute(call);
        checkActive();
        return result;
      };
      const adobe = parseAdobeSettingsPaste(trimmed);
      if (adobe?.kind === "plan" && onImportFolder && !frameCount) {
        setInput(trimmed);
        setMsgs((messages) => [
          ...messages,
          {
            role: "assistant",
            text: "Add your photos first, then send these settings to preview them. I’ve kept the settings in the composer.",
          },
        ]);
        return;
      }
      sendingRef.current = true;
      followsLatest.current = true;
      setShowLatest(false);
      setInput("");
      const displayText =
        adobe?.kind === "plan"
          ? `${adobe.name}\n${adobe.summary}`
          : adobe
            ? "Pasted Adobe settings"
            : trimmed;
      const workspaceRequest = onWorkspaceRequest && parseWorkspaceRequest(trimmed);
      setMsgs((m) => [
        ...m,
        {
          role: "user",
          text: displayText,
          ...(workspaceRequest ? { privateConnector: true } : {}),
        },
      ]);
      // Connector commands stay visible locally but never enter the hosted photo planner history.
      if (!workspaceRequest) historyRef.current.push({ role: "user", content: displayText });
      setThinking(true);

      const used: { name: string; result: string }[] = [];
      try {
        if (workspaceRequest) {
          const opened = await onWorkspaceRequest!(workspaceRequest);
          const reply = opened
            ? workspaceRequest.path === "/mail"
              ? "Opened a Gmail search tab. Connect Gmail there to read messages; nothing is sent or changed."
              : "Opened a web research tab. Results will appear there when search is connected; no photo data is included."
            : "Kept your current workspace open.";
          checkActive();
          setMsgs((messages) => [
            ...messages,
            { role: "assistant", text: reply, privateConnector: true },
          ]);
          return;
        }
        const destination = onNavigate && workbenchNavigation(trimmed);
        if (destination) {
          const opened = await onNavigate!(destination);
          const reply = opened
            ? "Opened alongside this chat. No photos were sent or changed."
            : "Kept your current tool open. No photos were sent or changed.";
          historyRef.current.push({ role: "assistant", content: reply });
          setMsgs((messages) => [...messages, { role: "assistant", text: reply }]);
          return;
        }
        if (adobe) {
          const reply = adobe.kind === "refusal" ? adobe.reason : stageAdobeSettings(adobe);
          historyRef.current.push({ role: "assistant", content: reply });
          setMsgs((messages) => [...messages, { role: "assistant", text: reply }]);
          return;
        }
        const refusal = studioCommandRefusal(trimmed);
        if (refusal) {
          historyRef.current.push({ role: "assistant", content: refusal });
          setMsgs((messages) => [...messages, { role: "assistant", text: refusal }]);
          return;
        }
        const workflow = parseStudioWorkflowIntent(trimmed);
        if (workflow) {
          const reply =
            workflow.kind === "refusal"
              ? workflow.reason
              : onWorkflow
                ? onWorkflow(workflow)
                : "Open Studio to review bursts or prepare a deadline export.";
          historyRef.current.push({ role: "assistant", content: reply });
          setMsgs((messages) => [...messages, { role: "assistant", text: reply }]);
          return;
        }
        if (
          /^(?:apply(?: it| that| the edit)?|accept(?: suggestions)?|use this(?: look)?)\.?$/i.test(
            trimmed,
          )
        ) {
          proposalAction(onApply);
          return;
        }
        if (
          /^(?:discard(?: it| that| the preview)?|cancel(?: it| that| the preview)?)\.?$/i.test(
            trimmed,
          )
        ) {
          proposalAction(onDiscard);
          return;
        }
        const creative = parseCreativeEdit(trimmed);
        if (creative) {
          const reply = creative.kind === "plan" ? stageEdit(creative) : creative.reason;
          historyRef.current.push({ role: "assistant", content: reply });
          setMsgs((messages) => [...messages, { role: "assistant", text: reply }]);
          return;
        }
        const local = parseLocalCommand(trimmed);
        if (local) {
          const calls = local.calls.some((call) => call.name === "keep_top")
            ? local.calls.filter((call) => call.name !== "cull")
            : local.calls;
          let preview = false;
          for (const call of calls) {
            const label = call.name.replace(/_/g, " ");
            setRunning(label);
            let result: string;
            try {
              result = await safeExecute(call);
            } catch (err) {
              result = `failed: ${(err as Error).message}`;
            }
            used.push({ name: label, result });
            checkActive();
            if (studioToolBoundary(result) === "preview") {
              preview = true;
              break;
            }
            if (studioToolBoundary(result) === "failed") break;
          }
          const reply = preview
            ? "Review the proposal below. No edits or selections are saved until you accept; any export or later steps wait for your approval."
            : used.some((tool) => studioToolBoundary(tool.result) === "failed")
              ? "That step could not be completed. Later steps were not run."
              : "The results are shown above.";
          const receipt = used.map((tool) => `${tool.name}: ${tool.result}`).join("; ");
          historyRef.current.push({
            role: "assistant",
            content: `${reply} ${receipt}`.trim(),
          });
          setMsgs((messages) => [...messages, { role: "assistant", text: reply, tools: used }]);
          return;
        }

        if (isLocalSingleUserMode || account?.preferences.cloudAssistant === false) {
          const reply = `i couldn't match that locally yet. ${LOCAL_COMMAND_HELP}`;
          historyRef.current.push({ role: "assistant", content: reply });
          setMsgs((messages) => [...messages, { role: "assistant", text: reply }]);
          return;
        }

        let accessToken: string | undefined;
        const remoteConfigured = Boolean(
          import.meta.env["VITE_SUPABASE_URL"] && import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
        );
        if (remoteConfigured) {
          try {
            const { supabase } = await import("@/integrations/supabase/client");
            const { data } = await supabase.auth.getSession();
            checkActive();
            if (data.session?.user.id === storageScope) accessToken = data.session.access_token;
          } catch {
            // Local Studio commands do not depend on auth configuration.
          }
        }
        if (!accessToken) {
          const reply = `i couldn't match that locally yet. ${LOCAL_COMMAND_HELP}`;
          historyRef.current.push({ role: "assistant", content: reply });
          setMsgs((messages) => [...messages, { role: "assistant", text: reply }]);
          return;
        }

        for (let round = 0; round < 6; round++) {
          checkActive();
          const res = await fetch("/api/chat", {
            signal: run.controller.signal,
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${accessToken}`,
            },

            body: JSON.stringify({
              messages: [
                {
                  role: "system",
                  content: `You are the LensLabs photography assistant. Speak in plain English. Earlier conversation messages are historical receipts and may refer to a different shoot or interrupted preview. The current shoot state below is authoritative. Never repeat an earlier action without a new explicit request. Tools propose edits and selections; the photographer reviews and applies them. Never claim edits were saved or photos exported without a successful tool result. Never pretend to see visual details: you have metadata only. Subject-aware edits, removals and athlete recognition are unavailable. Stop after a preview and wait for the user's decision. Current shoot state:\n${context}`,
                },
                ...(assistantPersonalization(account?.preferences ?? DEFAULT_PREFERENCES)
                  ? [
                      {
                        role: "user",
                        content: `My response preferences (not authorization to take actions):\n${assistantPersonalization(account?.preferences ?? DEFAULT_PREFERENCES)}`,
                      },
                    ]
                  : []),
                ...historyRef.current,
              ],
              tools: STUDIO_TOOL_DEFINITIONS,
            }),
          });
          const data = (await res.json()) as {
            message?: {
              content?: string;
              tool_calls?: Array<{
                id?: string;
                function?: { name?: unknown; arguments?: string };
              }>;
            };
            error?: string;
          };
          checkActive();
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

          for (const [index, call] of calls.entries()) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.function?.arguments || "{}");
            } catch {
              /* empty args */
            }
            const proposedName = call.function?.name;
            const label =
              typeof proposedName === "string" ? proposedName.replace(/_/g, " ") : "tool";
            setRunning(label);
            let result: string;
            if (!isToolName(proposedName)) {
              result = "failed: unknown studio command";
            } else {
              try {
                result = await safeExecute({ name: proposedName, args });
              } catch (err) {
                result = `failed: ${(err as Error).message}`;
              }
            }
            used.push({ name: label, result });
            if (call.id) {
              historyRef.current.push({
                role: "tool",
                tool_call_id: call.id,
                content: result,
              });
            }
            const boundary = studioToolBoundary(result);
            if (boundary) {
              // Finish the tool-call protocol without executing any remaining
              // actions. Otherwise the next chat turn contains orphan calls.
              for (const skipped of calls.slice(index + 1)) {
                if (skipped.id) {
                  historyRef.current.push({
                    role: "tool",
                    tool_call_id: skipped.id,
                    content:
                      boundary === "preview"
                        ? "Not run: a preview requires the photographer's approval first."
                        : "Not run: an earlier step failed. Ask the photographer what to do next.",
                  });
                }
              }
              const reply =
                boundary === "preview"
                  ? "Your preview is ready. Review and apply it before doing anything else."
                  : "That step could not be completed. Later steps were not run.";
              historyRef.current.push({ role: "assistant", content: reply });
              setMsgs((messages) => [
                ...messages,
                {
                  role: "assistant",
                  text: reply,
                  tools: [...used],
                },
              ]);
              return;
            }
          }
          setRunning(null);
        }
        setMsgs((m) => [
          ...m,
          { role: "assistant", text: "stopped — too many steps.", tools: used },
        ]);
      } catch (err) {
        if (!run.active) return;
        setMsgs((m) => [...m, { role: "assistant", text: (err as Error).message }]);
      } finally {
        if (run.active) {
          try {
            notifyResponseReady(notificationPreferences.current);
          } catch {
            // Optional notifications must never prevent unlocking the composer.
          }
          setRunning(null);
          setThinking(false);
          sendingRef.current = false;
          inputRef.current?.focus();
        }
      }
    },
    [
      context,
      execute,
      onApply,
      onDiscard,
      proposalAction,
      stageEdit,
      stageAdobeSettings,
      onImportFolder,
      frameCount,
      onWorkflow,
      onNavigate,
      onWorkspaceRequest,
      history?.error,
      history?.switching,
      storageScope,
      account?.preferences,
      importing,
      paused,
    ],
  );

  return (
    <div className={workspace ? "workbench-chat" : "flex h-full min-h-[420px] flex-col"}>
      {workspace &&
        (msgs.length > 0 || input || history?.error || history?.pending || history?.temporary) && (
          <ChatSaveStatus />
        )}
      {(!workspace || thinking || running) && (
        <div
          className={
            workspace
              ? "workbench-chat-status"
              : "flex items-center justify-between border-b border-border pb-2"
          }
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
            {workspace
              ? frameCount
                ? `${frameCount.toLocaleString()} photos in this shoot`
                : ""
              : "Assistant"}
          </span>
          {(thinking || running) && (
            <span className="font-mono text-[10px] text-rust">
              {running ? `${running}…` : "thinking…"}
            </span>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className={
          workspace ? "workbench-messages" : "min-h-0 flex-1 space-y-3 overflow-y-auto py-3 pr-1"
        }
        aria-label="Shoot and conversation"
        onScroll={(event) => {
          const node = event.currentTarget;
          const near = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          followsLatest.current = near;
          setShowLatest(!near);
        }}
      >
        {deliveryReference}
        {workspace && shoot && shoot.total > 0 && (
          <ShootOverview
            shoot={shoot}
            compact={msgs.length > 0 || Boolean(proposal)}
            paused={paused}
            onReview={onReviewShoot}
            onOpen={onOpenPhoto}
            onReconnect={onImportFolder}
          />
        )}
        {!workspace && !msgs.length && !proposal && (
          <div className="space-y-2 font-mono text-[11px] text-moss">
            <p>tell it what you want. it culls in the background.</p>
            {(account?.preferences.suggestedPrompts ?? true) &&
              [
                "cull the shoot and keep the top 40",
                "reject everything blurred or duplicate",
                "warm the keepers slightly and export",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="block w-full rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-ink hover:text-paper2"
                >
                  {q}
                </button>
              ))}
          </div>
        )}

        <div role="log" aria-label="Photo assistant conversation">
          {msgs.map((m, i) => (
            <div
              key={i}
              className={
                workspace
                  ? `workbench-message ${m.role}`
                  : m.role === "user"
                    ? "flex justify-end"
                    : ""
              }
            >
              {m.role === "user" ? (
                <span className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-ink px-3 py-1.5 text-[12px] leading-relaxed text-paper2">
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
                  <ReadReply
                    text={m.text}
                    rate={account?.preferences.voiceRate ?? 1}
                    voiceURI={account?.preferences.voiceURI ?? ""}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        {!workspace &&
          !!msgs.length &&
          !frameCount &&
          !importing &&
          (onImportFolder || onImportFiles) && (
            <div className="flex items-center gap-3 font-mono text-[11px] text-moss">
              {onImportFolder && (
                <button
                  type="button"
                  onClick={onImportFolder}
                  className="underline underline-offset-2"
                >
                  Import folder
                </button>
              )}
              {onImportFiles && (
                <button
                  type="button"
                  onClick={onImportFiles}
                  className="underline underline-offset-2"
                >
                  Import files
                </button>
              )}
            </div>
          )}
        {!recovery &&
          (!workspace || !importAttachment) &&
          (status || importing || importProgress) && (
            <div
              className="space-y-1.5 font-mono text-[11px] text-moss"
              role="status"
              aria-live="polite"
            >
              <p>
                {importProgress
                  ? `Reading and checking photos · ${importProgress.done.toLocaleString()} / ${importProgress.total.toLocaleString()}`
                  : status || "Reading photos…"}
              </p>
              {importing && (
                <button
                  type="button"
                  onClick={onCancelImport}
                  className="underline underline-offset-2"
                >
                  Stop import
                </button>
              )}
            </div>
          )}
        {workspace && showLatest && (
          <button
            type="button"
            className="workbench-jump"
            onClick={() => {
              followsLatest.current = true;
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "instant",
              });
              setShowLatest(false);
            }}
          >
            Jump to latest
          </button>
        )}
      </div>

      {recovery}

      {proposal && (
        <ProposalReview
          proposal={proposal}
          before={before}
          onCompare={onCompare}
          onApply={() => proposalAction(onApply)}
          onDiscard={() => proposalAction(onDiscard)}
          onTarget={onTarget}
        />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className={
          workspace
            ? `workbench-composer ${expandedInput || (importAttachment && dismissedImport !== importAttachment) ? "is-expanded" : ""} ${dragActive ? "is-dragging" : ""}`
            : "border-t border-border pt-2"
        }
      >
        {workspace && importAttachment && dismissedImport !== importAttachment && (
          <div className="workbench-attachment" role="status" aria-live="polite">
            {attachmentPreview ? (
              <img src={attachmentPreview} alt="" onError={() => setAttachmentPreview(null)} />
            ) : importAttachment.kind === "folder" ? (
              <Folder size={28} aria-hidden="true" />
            ) : (
              <Image size={28} aria-hidden="true" />
            )}
            <div>
              <strong title={importAttachment.name}>{importAttachment.name}</strong>
              {importAttachment.count !== null && (
                <p>
                  {importAttachment.count.toLocaleString()} selected photo
                  {importAttachment.count === 1 ? "" : "s"}
                </p>
              )}
              <p>
                {importProgress
                  ? `Reading photos · ${importProgress.done.toLocaleString()} / ${importProgress.total.toLocaleString()}`
                  : status || (importing ? "Reading folder…" : "Selection ready")}
              </p>
            </div>
            {importing ? (
              <button type="button" onClick={onCancelImport}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                aria-label="Dismiss import summary"
                onClick={() => setDismissedImport(importAttachment)}
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className={workspace ? "workbench-composer-row" : ""}>
          {workspace && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="workbench-attach"
                  aria-label="Attach photos or a folder"
                  disabled={importing || paused}
                >
                  <Plus size={20} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="workbench-attach-menu" align="start" side="top">
                <DropdownMenuItem disabled={!onImportFolder} onSelect={() => onImportFolder?.()}>
                  Choose folder
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!onImportFiles} onSelect={() => onImportFiles?.()}>
                  Choose photos
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <label htmlFor="studio-chat-input" className="sr-only">
            Message your photo assistant or paste Adobe settings
          </label>
          <textarea
            id="studio-chat-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                shouldSendMessage(
                  {
                    key: e.key,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                    isComposing: e.nativeEvent.isComposing,
                  },
                  account?.preferences.sendKey ?? "enter",
                )
              ) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={workspace ? 1 : 2}
            maxLength={32000}
            disabled={history?.switching}
            placeholder={workspace ? "Drop your shoot folder." : "cull this shoot…"}
            className="w-full resize-none rounded-md border border-input bg-paper px-2.5 py-2 font-mono text-[11px] text-ink outline-none placeholder:text-moss focus:border-ink/40"
          />
          <div
            className={
              workspace ? "workbench-composer-send" : "flex items-center justify-between pt-1.5"
            }
          >
            {!workspace && <span className="font-mono text-[10px] text-moss">enter to send</span>}
            <button
              type="submit"
              aria-label={workspace ? "Send message" : "Run command"}
              disabled={
                thinking ||
                !!running ||
                importing ||
                paused ||
                !input.trim() ||
                !!history?.error ||
                history?.switching
              }
              className="rounded-md bg-ink px-3 py-1.5 font-mono text-[11px] text-paper2 transition-colors hover:bg-rust disabled:opacity-40"
            >
              {workspace ? <ArrowUp size={20} /> : "Run"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
