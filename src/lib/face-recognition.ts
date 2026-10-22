import * as faceapi from "@vladmandic/face-api";

const modelPath = "/models/face";
let modelsPromise: Promise<void> | null = null;
const tfRuntime = faceapi.tf as unknown as {
  setBackend: (backend: "wasm" | "webgl" | "cpu") => Promise<boolean>;
  ready: () => Promise<void>;
};

export type FaceMatchResult = {
  distance: number;
  score: number;
  isMatch: boolean;
};

export async function loadFaceApiModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
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
  const distance = faceapi.euclideanDistance(Array.from(liveDescriptor), Array.from(storedDescriptor));
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

export function detectEyeBlink(landmarks: faceapi.FaceLandmarks68) {
  const left = eyeAspectRatio(landmarks.getLeftEye());
  const right = eyeAspectRatio(landmarks.getRightEye());
  return (left + right) / 2 < 0.2;
}
