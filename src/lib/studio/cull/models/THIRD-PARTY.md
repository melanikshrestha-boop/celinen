# Face models used by the cull engine

These files are served same-origin to the ingest workers and executed by the
engine's own runtime (`native/src/nn.cpp`). They are unmodified upstream bytes.
Every model below is licensed for commercial use; licenses were checked on
2026-09-17 against the upstream license file or model card, not a summary.

Excluded on purpose: InsightFace SCRFD / buffalo weights (non-commercial research
licence) and Ultralytics YOLO face models (AGPL-3.0). No face or eye dataset is
stored in this repository.

## face_detection_yunet_2023mar.onnx — stage 1, face detection

- Model: YuNet (Shiqi Yu et al.), from OpenCV Zoo.
- Source: https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
- Upstream training repository: https://github.com/ShiqiYu/libfacedetection.train
- Size: 232,589 bytes
- SHA-256: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
- License: MIT. OpenCV Zoo states "All files in this directory are licensed under
  MIT License"; the directory's LICENSE (Copyright (c) 2020 Shiqi Yu) is copied
  verbatim to `LICENSE-YUNET-MIT.txt`.
- Note: the weights were trained on WIDER FACE, whose images are distributed for
  research. The weights themselves are published under MIT by their authors.

## face_landmarks_detector.tflite and face_blendshapes.tflite — stage 2, eye state

- Models: MediaPipe Face Mesh V2 (478 landmarks) and Blendshape V2 (52
  coefficients, including `eyeBlinkLeft` / `eyeBlinkRight`), Google.
- Source bundle: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
  (identical bytes to `float16/latest`)
  - Bundle size: 3,758,596 bytes
  - Bundle SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
  - The bundle is a stored (uncompressed) zip; the two files below were extracted
    unchanged. The bundle's short-range face detector is not used: YuNet finds
    small faces that detector cannot.
- `face_landmarks_detector.tflite`: 2,553,590 bytes, SHA-256
  `c7d54204ce0448474c7f3fa9af494787c0965cbdd6f20fc72867e43046bd43d5`
- `face_blendshapes.tflite`: 955,312 bytes, SHA-256
  `4f36dded049db18d76048567439b2a7f58f1daabc00d78bfe8f3ad396a2d2082`
- License: Apache License 2.0, as stated under "LICENSED UNDER" in both model cards:
  - https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
  - https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf
  The license text is in `LICENSE-APACHE-2.0.txt`. The input conventions the
  engine reproduces (RGB scaled to 0..1, the 146-landmark blendshape subset, the
  1.5x square region rotated to the eye line) follow MediaPipe's Apache-2.0
  sources in `mediapipe/tasks/cc/vision/face_landmarker/`.

## Verifying

```sh
shasum -a 256 src/lib/studio/cull/models/*.onnx src/lib/studio/cull/models/*.tflite
```
