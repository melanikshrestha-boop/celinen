/// <reference lib="webworker" />
/** One lane of the ingest pool. It holds its own copy of the C++ engine and
 * reads whole files: the page never decodes a photo on the main thread, so a
 * card of ten thousand frames leaves the interface responsive the entire time.
 *
 * Which decoder reads which file is decided in readPhoto(): the engine for
 * JPEGs and RAW previews, the browser's own decoder for everything else.
 *
 * The face models load once per lane, from this origin, and stay for the card.
 * A lane that cannot load them still reads photos: it falls back to the skin
 * finder for a face box, and says the eyes were not checked.
 */
import { cullEngine } from "./client";
import { instantiateIngestWasm, type IngestEngine } from "./ingest-engine";
import type { IngestReply, IngestRequest } from "./ingest-messages";
import { browserPixels, readPhoto } from "./ingest-read";
import {
  cullFaceFromBox,
  findPortraitFaceOriented,
  uprightPixels,
} from "./portrait-face";

const scope = self as unknown as DedicatedWorkerGlobalScope;

const MODEL_URLS = {
  detector: new URL("./models/face_detection_yunet_2023mar.onnx", import.meta.url),
  landmarks: new URL("./models/face_landmarks_detector.tflite", import.meta.url),
  blendshapes: new URL("./models/face_blendshapes.tflite", import.meta.url),
};

let engine: Promise<{ engine: IngestEngine; eyes: boolean }> | null = null;

async function download(url: URL): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Face model download failed (${response.status}).`);
  return response.arrayBuffer();
}

function load() {
  engine ??= (async () => {
    const response = await fetch(new URL("./celinen-ingest.wasm", import.meta.url));
    if (!response.ok) throw new Error(`Cull engine download failed (${response.status}).`);
    const ready = await instantiateIngestWasm(await response.arrayBuffer());
    try {
      const [detector, landmarks, blendshapes] = await Promise.all([
        download(MODEL_URLS.detector),
        download(MODEL_URLS.landmarks),
        download(MODEL_URLS.blendshapes),
      ]);
      ready.loadFaceModels({ detector: detector!, landmarks: landmarks!, blendshapes: blendshapes! });
      return { engine: ready, eyes: ready.facesReady().eyes };
    } catch {
      // Reading photos matters more than reading eyes: the card still imports.
      return { engine: ready, eyes: false };
    }
  })();
  return engine;
}

scope.onmessage = async ({ data }: MessageEvent<IngestRequest>) => {
  const { id, file, options } = data;
  try {
    const { engine: wasm, eyes } = await load();
    const result = await readPhoto(file, options ?? {}, {
      engine: wasm,
      decodePixels: browserPixels,
    });
    if (result.afPoint) result.reading.afBox = result.afPoint;
    // The engine's own detector runs on the same pixels it measured. The skin
    // finder below is the fallback for a lane without models, and for frames
    // too soft for the engine to spend a detector pass on.
    const primary = (result.faces ?? []).find((face) => face.primary);
    if (primary && !result.reading.faceBox)
      result.reading.faceBox = {
        x: primary.x,
        y: primary.y,
        width: primary.width,
        height: primary.height,
      };
    if (!result.reading.hasFace) {
      const found = findPortraitFaceOriented(
        result.frame.rgba,
        result.frame.width,
        result.frame.height,
        result.afPoint,
      );
      if (found) {
        const pixels = uprightPixels(
          result.frame.rgba,
          result.frame.width,
          result.frame.height,
          found.turned,
        );
        const box = found.uprightBox;
        const engine = await cullEngine();
        if (engine) {
          result.reading = engine.measure(pixels.rgba, pixels.width, pixels.height, [
            cullFaceFromBox(box),
          ]);
        } else {
          result.reading = {
            ...result.reading,
            hasFace: true,
            subjectX: box.x + box.width / 2,
            subjectY: box.y + box.height * 0.42,
          };
        }
        result.reading.hasFace = true;
        result.reading.faceBox = box;
        if (result.afPoint) result.reading.afBox = result.afPoint;
        if (found.turned) {
          const rotated = await rotateThumbnail(result.thumbnail, found.turned);
          if (rotated) result.thumbnail = rotated;
        }
      }
    }
    const reply: IngestReply = {
      id,
      kind: "read",
      reading: result.reading,
      width: result.width,
      height: result.height,
      captureTimeMs: result.captureTimeMs,
      captureTimeBasis: result.captureTimeBasis,
      cameraKey: result.cameraKey,
      thumbnail: result.thumbnail,
      ...(result.faces ? { faces: result.faces } : {}),
      eyesRead: eyes,
      ...(result.damaged ? { damaged: result.damaged } : {}),
      ...(result.afPoint
        ? { afPoint: result.afPoint, afConfirmed: result.afConfirmed, focusHit: result.focusHit }
        : {}),
    };
    scope.postMessage(reply);
  } catch (error) {
    scope.postMessage({
      id,
      kind: "failed",
      error: error instanceof Error ? error.message : "This photo could not be read.",
    } satisfies IngestReply);
  }
};

async function rotateThumbnail(blob: Blob, turned: 90 | 270): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined")
    return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.height;
    const height = bitmap.width;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    if (turned === 90) {
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
  } catch {
    return null;
  }
}
