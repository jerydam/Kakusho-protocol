// extractors/face_worker.ts — browser-side liveness check via MediaPipe.
// Estimates yaw/pitch from landmark ratios (no OpenCV solvePnP).
// Requires @mediapipe/tasks-vision peer dependency.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const NOSE_TIP = 1;
const CHIN = 199;
const LEFT_EYE = 33;
const RIGHT_EYE = 263;
const FOREHEAD = 10;

const TURN_THRESHOLD = 0.06;
const TILT_THRESHOLD = 0.05;

export type PoseLabel = "left" | "right" | "up" | "down" | "center" | "none";

const REQUIRED_POSES: PoseLabel[] = ["left", "right", "up", "down"];

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

async function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      return FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "IMAGE",
        numFaces: 1,
      });
    })();
  }
  return landmarkerPromise;
}

interface Pose {
  yawProxy: number;
  pitchProxy: number;
}

async function estimateYawPitch(image: HTMLImageElement | HTMLCanvasElement): Promise<Pose | null> {
  const landmarker = await getLandmarker();
  const result = landmarker.detect(image as HTMLImageElement);
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;

  const lm = result.faceLandmarks[0];
  if (!lm) return null;

  const nose = lm[NOSE_TIP];
  const chin = lm[CHIN];
  const leftEye = lm[LEFT_EYE];
  const rightEye = lm[RIGHT_EYE];
  const forehead = lm[FOREHEAD];
  if (!nose || !chin || !leftEye || !rightEye || !forehead) return null;

  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeSpan = Math.abs(rightEye.x - leftEye.x) || 0.01;
  const yawProxy = (nose.x - eyeMidX) / eyeSpan;

  const vertMidY = (forehead.y + chin.y) / 2;
  const vertSpan = Math.abs(chin.y - forehead.y) || 0.01;
  const pitchProxy = (nose.y - vertMidY) / vertSpan;

  return { yawProxy, pitchProxy };
}

function classifyPose(pose: Pose): PoseLabel {
  if (pose.yawProxy > TURN_THRESHOLD) return "right";
  if (pose.yawProxy < -TURN_THRESHOLD) return "left";
  if (pose.pitchProxy > TILT_THRESHOLD) return "down";
  if (pose.pitchProxy < -TILT_THRESHOLD) return "up";
  return "center";
}

export interface LivenessResult {
  passed: boolean;
  score: number;
  detectedPoses: PoseLabel[];
}

export async function livenessCheckMulti(
  images: (HTMLImageElement | HTMLCanvasElement)[]
): Promise<LivenessResult> {
  const detected = new Set<PoseLabel>();
  for (const image of images) {
    const pose = await estimateYawPitch(image);
    if (!pose) continue;
    const label = classifyPose(pose);
    if (REQUIRED_POSES.includes(label)) detected.add(label);
  }
  const missing = REQUIRED_POSES.filter((p) => !detected.has(p));
  return {
    passed: missing.length === 0,
    score: Math.round((detected.size / REQUIRED_POSES.length) * 1000) / 1000,
    detectedPoses: Array.from(detected),
  };
}

export async function livenessCheckSingle(
  image: HTMLImageElement | HTMLCanvasElement
): Promise<{ centered: boolean; score: number }> {
  const pose = await estimateYawPitch(image);
  if (!pose) return { centered: false, score: 0 };
  const centered = Math.abs(pose.yawProxy) < 0.15 && Math.abs(pose.pitchProxy) < 0.15;
  const score = Math.max(0, 1 - (Math.abs(pose.yawProxy) + Math.abs(pose.pitchProxy)) / 0.6);
  return { centered, score: Math.round(score * 1000) / 1000 };
}