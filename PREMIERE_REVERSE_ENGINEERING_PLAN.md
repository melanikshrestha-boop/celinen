# Premiere reverse engineering plan (Celinen Video)

Celinen is one product. Video lives at `/video` inside the same sign-in and dashboard as Pick/Develop. This is the Lightroom plan’s counterpart: copy Premiere Pro’s *editor*, not Latch’s clipping SaaS.

## What shipped in this slice

- Program monitor + project bin + V1/V2/A1 timeline + playhead
- Tools: selection (V), razor (C), play/pause (Space), ripple delete via chat
- Chat commands: split, insert on timeline, play, keep/reject language from the old local review
- Originals stay on-device; review marks and sequence JSON persist locally

## Premiere Classic vs Celinen Video

| Surface | Premiere Pro | Celinen now | Next |
|---|---|---|---|
| Project bin | Full media browser | Imported local clips + keep/reject | Folders, sequences, search |
| Source monitor | Separate from Program | Selected clip in Program | Dual monitors |
| Program monitor | Sequence output | Selected clip / playhead mapping | True sequence playback across cuts |
| Timeline | N video + N audio, nested | V1, V2, A1 | More tracks, linked A/V, nesting |
| Razor / ripple / roll / slip / slide | Full | Razor + ripple delete | Roll, slip, slide, trim |
| JKL shuttle | Yes | Space play/pause | JKL |
| Lumetri | Color | None | Lift/gamma/gain, curves, HSL |
| Essential Graphics / captions | Yes | None | Word-timed captions from transcript |
| Effects / transitions | Huge catalog | None | Cut, dissolve, then a short list |
| Audio | Mixer, ducking, loudness | Empty A1 | Waveforms, levels, fade |
| Export | Media Encoder | JSON selects manifest | MP4 via ffmpeg/native C++ |
| XML | Premiere XML / FCPXML | None | Round-trip XML |

## Cursor for video (how Celinen already works for photos)

Studio chat proposes culls/edits; the photographer accepts. Video chat must do the same to the **timeline**:

1. Parse local commands without a model (split, insert, ripple, keep longer than N).
2. Hosted assistant may emit the same tool calls later (`razor`, `insert_clip`, `ripple_delete`, `set_playhead`).
3. Never silently rewrite media bytes. Decisions are reversible.

## Native engine (C++, not Python)

Latchcut’s Python pipeline stays archived. New decode/transcode/export work belongs in `native/` next to the photo engine. Browser NLE is the UX; ffmpeg/C++ is the export path.

## Do not do

- Do not re-open Latch as a second product on the landing page
- Do not send footage to a clipping-only SaaS
- Do not default new video engine code to Python
