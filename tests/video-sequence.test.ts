import { describe, expect, test } from "bun:test";
import { parseVideoCommand } from "../src/lib/video/commands";
import { isVideoFile } from "../src/lib/video/media";
import {
  appendSource,
  clipEnd,
  clipUnderTime,
  emptySequence,
  insertSourceAtPlayhead,
  parseSequence,
  pruneMissingSources,
  razorAt,
  rippleDelete,
  sequenceDuration,
  setPlayhead,
} from "../src/lib/video/sequence";

describe("video media", () => {
  test("accepts common camera and browser formats", () => {
    expect(isVideoFile({ name: "a.mov", type: "" })).toBe(true);
    expect(isVideoFile({ name: "a.MP4", type: "video/mp4" })).toBe(true);
    expect(isVideoFile({ name: "a.jpg", type: "image/jpeg" })).toBe(false);
  });
});

describe("sequence editing", () => {
  test("appends clips end to end on V1", () => {
    let sequence = emptySequence();
    sequence = appendSource(sequence, "a", 10);
    sequence = appendSource(sequence, "b", 4);
    expect(sequence.videoTracks[0]).toHaveLength(2);
    expect(sequence.videoTracks[0]![0]!.start).toBe(0);
    expect(sequence.videoTracks[0]![1]!.start).toBe(10);
    expect(sequenceDuration(sequence)).toBe(14);
  });

  test("razor splits the clip under the playhead without dropping either side", () => {
    let sequence = appendSource(emptySequence(), "a", 10);
    sequence = razorAt(sequence, 4);
    const track = sequence.videoTracks[0]!;
    expect(track).toHaveLength(2);
    expect(track[0]!.outPoint).toBe(4);
    expect(track[1]!.start).toBe(4);
    expect(track[1]!.inPoint).toBe(4);
    expect(clipEnd(track[1]!)).toBe(10);
  });

  test("ripple delete closes the hole on that track", () => {
    let sequence = emptySequence();
    sequence = appendSource(sequence, "a", 4);
    sequence = appendSource(sequence, "b", 6);
    const first = sequence.videoTracks[0]![0]!.id;
    sequence = rippleDelete(sequence, first);
    expect(sequence.videoTracks[0]).toHaveLength(1);
    expect(sequence.videoTracks[0]![0]!.sourceId).toBe("b");
    expect(sequence.videoTracks[0]![0]!.start).toBe(0);
    expect(sequenceDuration(sequence)).toBe(6);
  });

  test("insert at playhead splits the covering clip and pushes the right side", () => {
    let sequence = appendSource(emptySequence(), "a", 10);
    sequence = setPlayhead(sequence, 4);
    sequence = insertSourceAtPlayhead(sequence, "b", 2);
    const track = sequence.videoTracks[0]!;
    expect(track.map((clip) => [clip.sourceId, clip.start, clipEnd(clip)])).toEqual([
      ["a", 0, 4],
      ["b", 4, 6],
      ["a", 6, 12],
    ]);
  });

  test("clip under playhead is the covering V1/V2 clip", () => {
    let sequence = appendSource(emptySequence(), "a", 5);
    expect(clipUnderTime(sequence, 0)?.sourceId).toBe("a");
    expect(clipUnderTime(sequence, 4.9)?.sourceId).toBe("a");
    expect(clipUnderTime(sequence, 5)).toBeNull();
  });

  test("prunes timeline clips whose sources were cleared", () => {
    let sequence = appendSource(emptySequence(), "a", 5);
    sequence = appendSource(sequence, "b", 5);
    sequence = pruneMissingSources(sequence, new Set(["b"]));
    expect(sequence.videoTracks[0]!.map((clip) => clip.sourceId)).toEqual(["b"]);
  });

  test("rejects invalid snapshots instead of inventing a timeline", () => {
    expect(parseSequence({ version: 2, name: "x", videoTracks: [] })).toBeNull();
    expect(parseSequence({ version: 1, name: "x", videoTracks: "nope" })).toBeNull();
  });
});

describe("video commands", () => {
  test("maps editor language onto timeline actions", () => {
    expect(parseVideoCommand("razor at playhead")).toEqual({ kind: "razor" });
    expect(parseVideoCommand("split the clip")).toEqual({ kind: "razor" });
    expect(parseVideoCommand("ripple delete")).toEqual({ kind: "ripple-delete" });
    expect(parseVideoCommand("insert this on the timeline")).toEqual({ kind: "insert-selected" });
    expect(parseVideoCommand("play sequence")).toEqual({ kind: "play" });
    expect(parseVideoCommand("pause")).toEqual({ kind: "pause" });
  });

  test("keeps the local review vocabulary", () => {
    expect(parseVideoCommand("keep clips longer than 10 seconds")).toEqual({
      kind: "verdict-duration",
      verdict: "keep",
      compare: "over",
      seconds: 10,
    });
    expect(parseVideoCommand("show undecided clips")).toEqual({ kind: "filter", filter: "todo" });
    expect(parseVideoCommand("export selects manifest")).toEqual({ kind: "export" });
  });
});
