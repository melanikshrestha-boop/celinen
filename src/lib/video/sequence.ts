/** Premiere-shaped sequence: stacked tracks, playhead, razor, ripple. */

export type TimelineClip = {
  id: string;
  sourceId: string;
  start: number;
  inPoint: number;
  outPoint: number;
};

export type Sequence = {
  version: 1;
  name: string;
  fps: number;
  playhead: number;
  videoTracks: TimelineClip[][];
  audioTracks: TimelineClip[][];
};

export function emptySequence(name = "Sequence 1"): Sequence {
  return {
    version: 1,
    name,
    fps: 30,
    playhead: 0,
    videoTracks: [[], []],
    audioTracks: [[]],
  };
}

export function clipDuration(clip: TimelineClip) {
  return Math.max(0, clip.outPoint - clip.inPoint);
}

export function clipEnd(clip: TimelineClip) {
  return clip.start + clipDuration(clip);
}

export function sequenceDuration(sequence: Sequence) {
  let max = 0;
  for (const track of [...sequence.videoTracks, ...sequence.audioTracks]) {
    for (const clip of track) max = Math.max(max, clipEnd(clip));
  }
  return max;
}

function newClipId() {
  return `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortTrack(track: TimelineClip[]) {
  return [...track].sort((a, b) => a.start - b.start);
}

export function appendSource(
  sequence: Sequence,
  sourceId: string,
  duration: number,
  track = 0,
): Sequence {
  const length = Math.max(0, duration);
  if (length <= 0) return sequence;
  const videoTracks = sequence.videoTracks.map((row) => [...row]);
  while (videoTracks.length <= track) videoTracks.push([]);
  const row = videoTracks[track]!;
  const start = row.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
  row.push({
    id: newClipId(),
    sourceId,
    start,
    inPoint: 0,
    outPoint: length,
  });
  videoTracks[track] = sortTrack(row);
  return { ...sequence, videoTracks };
}

export function insertSourceAtPlayhead(
  sequence: Sequence,
  sourceId: string,
  duration: number,
  track = 0,
): Sequence {
  const length = Math.max(0, duration);
  if (length <= 0) return sequence;
  const razored = razorAt(sequence, sequence.playhead);
  const time = razored.playhead;
  const videoTracks = razored.videoTracks.map((row) => [...row]);
  while (videoTracks.length <= track) videoTracks.push([]);
  const shifted = videoTracks.map((row, index) => {
    const moved = row.map((clip) =>
      clip.start >= time - 1e-9 ? { ...clip, start: clip.start + length } : clip,
    );
    if (index === track) {
      moved.push({
        id: newClipId(),
        sourceId,
        start: time,
        inPoint: 0,
        outPoint: length,
      });
    }
    return sortTrack(moved);
  });
  return { ...razored, videoTracks: shifted };
}

export function razorAt(sequence: Sequence, time: number): Sequence {
  const splitTrack = (track: TimelineClip[]) => {
    const next: TimelineClip[] = [];
    for (const clip of track) {
      const end = clipEnd(clip);
      if (time <= clip.start + 1e-4 || time >= end - 1e-4) {
        next.push(clip);
        continue;
      }
      const offset = time - clip.start;
      next.push({
        ...clip,
        outPoint: clip.inPoint + offset,
      });
      next.push({
        id: newClipId(),
        sourceId: clip.sourceId,
        start: time,
        inPoint: clip.inPoint + offset,
        outPoint: clip.outPoint,
      });
    }
    return sortTrack(next);
  };
  return {
    ...sequence,
    videoTracks: sequence.videoTracks.map(splitTrack),
    audioTracks: sequence.audioTracks.map(splitTrack),
  };
}

export function rippleDelete(sequence: Sequence, clipId: string): Sequence {
  const dropFrom = (tracks: TimelineClip[][]) =>
    tracks.map((track) => {
      const target = track.find((clip) => clip.id === clipId);
      if (!target) return track;
      const gap = clipDuration(target);
      return sortTrack(
        track
          .filter((clip) => clip.id !== clipId)
          .map((clip) => (clip.start > target.start ? { ...clip, start: clip.start - gap } : clip)),
      );
    });
  return {
    ...sequence,
    videoTracks: dropFrom(sequence.videoTracks),
    audioTracks: dropFrom(sequence.audioTracks),
  };
}

export function clipUnderTime(sequence: Sequence, time: number): TimelineClip | null {
  for (const track of sequence.videoTracks) {
    for (const clip of track) {
      if (time >= clip.start && time < clipEnd(clip)) return clip;
    }
  }
  return null;
}

export function setPlayhead(sequence: Sequence, time: number): Sequence {
  const duration = sequenceDuration(sequence);
  const next = Number.isFinite(time) ? Math.max(0, time) : 0;
  return { ...sequence, playhead: duration > 0 ? Math.min(next, duration) : 0 };
}

export function pruneMissingSources(sequence: Sequence, sourceIds: ReadonlySet<string>): Sequence {
  const keep = (tracks: TimelineClip[][]) =>
    tracks.map((track) => track.filter((clip) => sourceIds.has(clip.sourceId)));
  return {
    ...sequence,
    videoTracks: keep(sequence.videoTracks),
    audioTracks: keep(sequence.audioTracks),
  };
}

export function parseSequence(value: unknown): Sequence | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Sequence>;
  if (raw.version !== 1 || typeof raw.name !== "string" || !Array.isArray(raw.videoTracks))
    return null;
  const fps = typeof raw.fps === "number" && Number.isFinite(raw.fps) && raw.fps > 0 ? raw.fps : 30;
  const playhead =
    typeof raw.playhead === "number" && Number.isFinite(raw.playhead) && raw.playhead >= 0
      ? raw.playhead
      : 0;
  const parseTrack = (track: unknown): TimelineClip[] | null => {
    if (!Array.isArray(track)) return null;
    const clips: TimelineClip[] = [];
    for (const item of track) {
      if (!item || typeof item !== "object") return null;
      const clip = item as Partial<TimelineClip>;
      if (
        typeof clip.id !== "string" ||
        typeof clip.sourceId !== "string" ||
        typeof clip.start !== "number" ||
        typeof clip.inPoint !== "number" ||
        typeof clip.outPoint !== "number" ||
        !Number.isFinite(clip.start) ||
        !Number.isFinite(clip.inPoint) ||
        !Number.isFinite(clip.outPoint) ||
        clip.start < 0 ||
        clip.inPoint < 0 ||
        clip.outPoint < clip.inPoint
      )
        return null;
      clips.push({
        id: clip.id,
        sourceId: clip.sourceId,
        start: clip.start,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
      });
    }
    return sortTrack(clips);
  };
  const videoTracks = raw.videoTracks.map(parseTrack);
  const audioTracks = Array.isArray(raw.audioTracks) ? raw.audioTracks.map(parseTrack) : [[]];
  if (videoTracks.some((track) => track === null) || audioTracks.some((track) => track === null))
    return null;
  const sequence: Sequence = {
    version: 1,
    name: raw.name || "Sequence 1",
    fps,
    playhead,
    videoTracks: videoTracks as TimelineClip[][],
    audioTracks: audioTracks as TimelineClip[][],
  };
  if (sequence.videoTracks.length === 0) sequence.videoTracks = [[], []];
  if (sequence.audioTracks.length === 0) sequence.audioTracks = [[]];
  return setPlayhead(sequence, sequence.playhead);
}
