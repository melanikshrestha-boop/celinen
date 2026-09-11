# InsightFace in FOTO

FOTO uses the open-source [InsightFace](https://github.com/deepinsight/insightface) **matching
step**: L2-normalized 512-d ArcFace embeddings compared with cosine similarity, clustered
event-locally in C++ (`native/src/people.cpp`).

That is the recognition math. It is not a shipped buffalo model, and it does not name anyone.

## License split (do not collapse these)

| Piece | License | What FOTO does |
| --- | --- | --- |
| InsightFace **source** (Python package, alignment, matching) | MIT | Matching math is in our C++ engine. |
| `buffalo_*` / `antelopev2` **pretrained weights** | Non-commercial research unless you obtain a separate license from InsightFace | **Never auto-downloaded. Never vendored.** |
| OpenCV YuNet + SFace | Apache-2.0 | Candidate commercial-safe detector/embedder; not required for this slice. |

InsightFace's own README states that provided training data and associated pretrained models are
for non-commercial research unless separately licensed. A permissive code license does not resolve
the model-license question. Commercial pack inquiries: `recognition-oss-pack@insightface.ai`.

## Optional user-supplied ONNX

If you have a **commercially licensed** buffalo_l (or equivalent) pack, place it at
`$FOTO_INSIGHTFACE_DIR` or `~/.foto/insightface/`:

```
det_10g.onnx
w600k_r50.onnx
```

`inspect_insightface_pack` only checks that those files exist. It does not fetch, unpack, or run
them. Until ONNX inference is wired, Studio still embeds faces with a local descriptor and the
C++ engine clusters the 512-d vectors. The JSON receipt records `source: insightface` only when
the embeddings actually came from an InsightFace recognizer.

## Product rules

- Matching is **event-local**. Person 12 on wedding A is not Person 12 on wedding B.
- The photographer labels a cluster. The software does not infer "parent" from age or seating.
- Low-confidence matches stay unresolved. A failed match is not "this person was never photographed."
- No emotion scores. A visible smile or embrace is evidence; an internal feeling is not.
- Originals are never deleted. Gallery proposal recommends frames; alternatives stay reviewable.
