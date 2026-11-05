import type * as FaceApi from "@vladmandic/face-api";

let faceApiPromise: Promise<typeof FaceApi> | null = null;
// Loaded lazily: face-api crashes when evaluated during server rendering.
export function getFaceApi() {
  if (!faceApiPromise) faceApiPromise = import("@vladmandic/face-api");
  return faceApiPromise;
}

const modelPath = "/models/face";
let modelsPromise: Promise<void> | null = null;

export type FaceMatchResult = {
  distance: number;
  score: number;
  isMatch: boolean;
};

export async function loadFaceApiModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const faceapi = await getFaceApi();
      const tfRuntime = faceapi.tf as unknown as {
        setBackend: (backend: "wasm" | "webgl" | "cpu") => Promise<boolean>;
        ready: () => Promise<void>;
      };
      const wasmReady = await tfRuntime.setBackend("wasm").catch(() => false);
      if (!wasmReady) {
        const webglReady = await tfRuntime.setBackend("webgl").catch(() => false);
        if (!webglReady) await tfRuntime.setBackend("cpu");
      }
      await tfRuntime.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
      ]);
    })().catch((error) => {
      modelsPromise = null;
      throw error;
    });
  }
  await modelsPromise;
}

export function calculateFaceMatch(
  liveDescriptor: ArrayLike<number>,
  storedDescriptor: ArrayLike<number>,
): FaceMatchResult {
  if (liveDescriptor.length !== 128 || storedDescriptor.length !== 128) {
    return { distance: Number.POSITIVE_INFINITY, score: 0, isMatch: false };
  }
  let sum = 0;
  for (let i = 0; i < 128; i++) sum += (liveDescriptor[i] - storedDescriptor[i]) ** 2;
  const distance = Math.sqrt(sum);
  // A distance of 0.5 maps to 80%; 0.625 maps to the 75% acceptance floor.
  const score = Math.max(0, Math.min(100, 100 - distance * 40));
  return { distance, score, isMatch: score >= 75 };
}

export function eyeAspectRatio(points: Array<{ x: number; y: number }>) {
  if (points.length !== 6) return 1;
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  const horizontal = distance(0, 3);
  if (!horizontal) return 1;
  return (distance(1, 5) + distance(2, 4)) / (2 * horizontal);
}

export function detectEyeBlink(landmarks: FaceApi.FaceLandmarks68) {
  const left = eyeAspectRatio(landmarks.getLeftEye());
  const right = eyeAspectRatio(landmarks.getRightEye());
  return (left + right) / 2 < 0.2;
}
