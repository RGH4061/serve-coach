// detectors.js
// Loads the two AI models and runs them on one video frame at a time.
//   MediaPipe Pose  -> 33 body joints
//   YOLO11n (COCO)  -> "sports ball" and "tennis racket" boxes
// Both run inside the browser; the video is never uploaded anywhere.

import { decodeYolo } from './yolo-decode.js';
import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs';

const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
const YOLO_MODEL = 'models/yolo11n.onnx';
const YOLO_SIZE = 640;

let pose = null;
let yolo = null;
const yoloCanvas = document.createElement('canvas');
yoloCanvas.width = yoloCanvas.height = YOLO_SIZE;
const yoloCtx = yoloCanvas.getContext('2d', { willReadFrequently: true });

export async function loadModels(onStatus = () => {}) {
  if (!pose) {
    onStatus('Loading body tracking model (MediaPipe Pose)…');
    const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
    const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    try { pose = await make('GPU'); } catch (e) { console.warn('GPU pose failed, using CPU', e); pose = await make('CPU'); }
  }
  if (!yolo) {
    onStatus('Loading ball & racquet model (YOLO)…');
    const ort = window.ort;
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
    yolo = await ort.InferenceSession.create(YOLO_MODEL, { executionProviders: ['wasm'] });
  }
}

// Body joints for one frame. Returns 33 points in pixels, or null if no-one is found.
export function detectPose(canvas, timestampMs) {
  const res = pose.detectForVideo(canvas, timestampMs);
  if (!res.landmarks || !res.landmarks.length) return null;
  return res.landmarks[0].map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height, v: p.visibility ?? 1 }));
}

export { chooseBall } from './yolo-decode.js';

// Ball and racquet candidates for one frame.
export async function detectObjects(canvas) {
  const ort = window.ort;
  // "Letterbox": shrink the frame to fit 640x640 without stretching it.
  const scale = Math.min(YOLO_SIZE / canvas.width, YOLO_SIZE / canvas.height);
  const w = Math.round(canvas.width * scale), h = Math.round(canvas.height * scale);
  const padX = (YOLO_SIZE - w) / 2, padY = (YOLO_SIZE - h) / 2;
  yoloCtx.fillStyle = 'rgb(114,114,114)';
  yoloCtx.fillRect(0, 0, YOLO_SIZE, YOLO_SIZE);
  yoloCtx.drawImage(canvas, padX, padY, w, h);
  const { data } = yoloCtx.getImageData(0, 0, YOLO_SIZE, YOLO_SIZE);

  // Convert pixels to the number layout YOLO expects: [1, 3 colours, 640, 640], values 0-1.
  const area = YOLO_SIZE * YOLO_SIZE;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = data[i * 4] / 255;
    input[i + area] = data[i * 4 + 1] / 255;
    input[i + 2 * area] = data[i * 4 + 2] / 255;
  }
  const out = await yolo.run({ images: new ort.Tensor('float32', input, [1, 3, YOLO_SIZE, YOLO_SIZE]) });
  return decodeYolo(out.output0.data, { scale, padX, padY });
}
