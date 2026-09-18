import {
  Check,
  Film,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { type DragEvent, type FormEvent, type RefObject } from "react";
import { formatDuration, formatTimecode } from "@/lib/video/media";
import {
  clipDuration,
  sequenceDuration,
  type Sequence,
  type TimelineClip,
} from "@/lib/video/sequence";
import type { VideoFilter, VideoVerdict } from "@/lib/video/session";
import "./video-editor.css";

export type EditorClip = {
  id: string;
  name: string;
  url: string | null;
  duration: number;
  width: number;
  height: number;
  size: number;
  verdict: VideoVerdict;
};

type Filter = { key: VideoFilter; label: string };

type Props = {
  clips: EditorClip[];
  visible: EditorClip[];
  selected: EditorClip | null;
  filter: VideoFilter;
  filters: Filter[];
  counts: Record<VideoFilter, number>;
  sequence: Sequence;
  tool: "select" | "razor";
  playing: boolean;
  probing: { done: number; total: number; failed: number } | null;
  dragging: boolean;
  note: string;
  command: string;
  commandRef: RefObject<HTMLInputElement | null>;
  fileRef: RefObject<HTMLInputElement | null>;
  programRef: RefObject<HTMLVideoElement | null>;
  onFilter: (filter: VideoFilter) => void;
  onSelect: (id: string) => void;
  onKeep: () => void;
  onReject: () => void;
  onUndo: () => void;
  onImport: () => void;
  onFiles: (files: File[]) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragState: (on: boolean) => void;
  onTool: (tool: "select" | "razor") => void;
  onPlayToggle: () => void;
  onRazor: () => void;
  onTimelineClick: (time: number) => void;
  onSelectTimelineClip: (clip: TimelineClip) => void;
  onCommandChange: (value: string) => void;
  onCommand: (value: string) => void;
  quickCommands: string[];
};

const PIXELS_PER_SECOND = 48;

function sourceName(clips: EditorClip[], sourceId: string) {
  return clips.find((clip) => clip.id === sourceId)?.name ?? sourceId;
}

export function VideoEditor({
  clips,
  visible,
  selected,
  filter,
  filters,
  counts,
  sequence,
  tool,
  playing,
  probing,
  dragging,
  note,
  command,
  commandRef,
  fileRef,
  programRef,
  onFilter,
  onSelect,
  onKeep,
  onReject,
  onUndo,
  onImport,
  onFiles,
  onDrop,
  onDragState,
  onTool,
  onPlayToggle,
  onRazor,
  onTimelineClick,
  onSelectTimelineClip,
  onCommandChange,
  onCommand,
  quickCommands,
}: Props) {
  const duration = Math.max(sequenceDuration(sequence), 8);
  const width = Math.max(duration * PIXELS_PER_SECOND, 640);
  const playheadLeft = 44 + sequence.playhead * PIXELS_PER_SECOND;
  const ticks: number[] = [];
  for (let second = 0; second <= Math.ceil(duration); second += 2) ticks.push(second);

  function timeFromEvent(event: { currentTarget: HTMLElement; clientX: number }) {
    const row = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - row.left;
    return Math.max(0, x / PIXELS_PER_SECOND);
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCommand(command);
  };

  return (
    <div className="celinen-video">
      <div className="celinen-video__bar">
        <button type="button" onClick={onImport} disabled={probing !== null}>
          <FolderOpen size={14} /> Import
        </button>
        <button
          type="button"
          aria-pressed={tool === "select"}
          onClick={() => onTool("select")}
        >
          V
        </button>
        <button type="button" aria-pressed={tool === "razor"} onClick={() => onTool("razor")}>
          <Scissors size={14} /> C
        </button>
        <button type="button" onClick={onPlayToggle} disabled={!selected?.url && clips.every((clip) => !clip.url)}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" onClick={onRazor} disabled={sequenceDuration(sequence) === 0}>
          Split
        </button>
        <button type="button" onClick={onUndo} disabled={false} data-app-key="undo">
          <RotateCcw size={14} />
        </button>
        <span className="celinen-video__tc">{formatTimecode(sequence.playhead, sequence.fps)}</span>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mov,.mp4,.m4v,.webm,.ogv,.ogg"
          multiple
          className="hidden"
          onChange={(event) => {
            onFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      <aside className="celinen-video__bin">
        <div className="celinen-video__filters" role="group" aria-label="Bin">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilter(item.key)}
              aria-pressed={filter === item.key}
            >
              {item.label} {counts[item.key]}
            </button>
          ))}
        </div>
        <div className="celinen-video__clips">
          {visible.length === 0 ? (
            <p className="celinen-video__note">No clips</p>
          ) : (
            visible.map((clip, index) => (
              <button
                key={clip.id}
                type="button"
                className="celinen-video__clip"
                onClick={() => onSelect(clip.id)}
                aria-current={selected?.id === clip.id ? "true" : undefined}
              >
                <span>
                  {clip.verdict === "keep" ? (
                    <Check size={14} />
                  ) : clip.verdict === "reject" ? (
                    <X size={14} />
                  ) : (
                    <Film size={14} />
                  )}
                </span>
                <span>
                  <b>
                    {index + 1}. {clip.name}
                  </b>
                  <small>
                    {formatDuration(clip.duration)}
                    {!clip.url ? " · reconnect" : ""}
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <main
        className="celinen-video__program"
        onDragEnter={(event) => {
          event.preventDefault();
          onDragState(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) onDragState(false);
        }}
        onDrop={onDrop}
        data-dragging={dragging ? "1" : "0"}
      >
        {probing ? (
          <p className="celinen-video__status" role="status">
            Reading metadata · {probing.done}/{probing.total}
            {probing.failed > 0 ? ` · ${probing.failed} unavailable` : ""}
          </p>
        ) : null}
        <div className="celinen-video__stage">
          {selected?.url ? (
            <video
              ref={programRef}
              key={selected.id}
              src={selected.url}
              playsInline
              preload="metadata"
              aria-label={selected.name}
            />
          ) : selected ? (
            <button type="button" className="celinen-video__reconnect" onClick={onImport}>
              <FolderOpen size={24} />
              <strong>Reconnect {selected.name}</strong>
            </button>
          ) : (
            <button type="button" className="celinen-video__empty" onClick={onImport} disabled={probing !== null}>
              <VideoIcon size={28} strokeWidth={1.4} />
              <h1>Drop footage here.</h1>
              <span>Choose video files</span>
            </button>
          )}
        </div>
        {selected ? (
          <div className="celinen-video__status">
            {selected.name} · {formatDuration(selected.duration)} · {selected.width || "?"}×
            {selected.height || "?"}
            <button type="button" onClick={onKeep} aria-pressed={selected.verdict === "keep"}>
              Keep · K
            </button>
            <button type="button" onClick={onReject} aria-pressed={selected.verdict === "reject"}>
              Reject · X
            </button>
          </div>
        ) : null}
      </main>

      <aside className="celinen-video__chat">
        <h2>Edit</h2>
        <div className="celinen-video__quick">
          {quickCommands.map((item) => (
            <button key={item} type="button" onClick={() => onCommand(item)}>
              › {item}
            </button>
          ))}
        </div>
        <p className="celinen-video__note" role="status">
          {note}
        </p>
        <form onSubmit={submit}>
          <input
            ref={commandRef}
            value={command}
            onChange={(event) => onCommandChange(event.target.value)}
            placeholder="Split at playhead…"
            aria-label="Video command"
          />
          <button type="submit">Run</button>
        </form>
      </aside>

      <section className="celinen-video__timeline" aria-label="Timeline">
        <div className="celinen-video__ruler">
          <div className="celinen-video__lane">TC</div>
          <div
            className="celinen-video__ticks"
            style={{ width }}
            onClick={(event) => onTimelineClick(timeFromEvent(event))}
          >
            {ticks.map((second) => (
              <span
                key={second}
                className="celinen-video__tick"
                style={{ left: second * PIXELS_PER_SECOND }}
              >
                {formatDuration(second)}
              </span>
            ))}
          </div>
        </div>
        {(["V2", "V1"] as const).map((label, index) => {
          const track = sequence.videoTracks[label === "V1" ? 0 : 1] ?? [];
          return (
            <div key={label} className="celinen-video__track">
              <div className="celinen-video__lane">{label}</div>
              <div
                className="celinen-video__row"
                style={{ width }}
                onClick={(event) => {
                  const time = timeFromEvent(event);
                  if (tool === "razor") onTimelineClick(time);
                  else onTimelineClick(time);
                }}
              >
                {track.map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    className={`celinen-video__block${label === "V2" ? " is-v2" : ""}${
                      selected?.id === clip.sourceId ? " is-on" : ""
                    }`}
                    style={{
                      left: clip.start * PIXELS_PER_SECOND,
                      width: Math.max(8, clipDuration(clip) * PIXELS_PER_SECOND),
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectTimelineClip(clip);
                    }}
                  >
                    {sourceName(clips, clip.sourceId)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="celinen-video__track">
          <div className="celinen-video__lane">A1</div>
          <div className="celinen-video__row" style={{ width }} />
        </div>
        <div className="celinen-video__playhead" style={{ left: playheadLeft }} />
      </section>
    </div>
  );
}
