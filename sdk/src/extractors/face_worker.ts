// face_worker.ts — browser-side liveness check, ported from
// backend/app/kyc/face.py's MediaPipe FaceLandmarker pose-estimation
// logic. This port is much more direct than ocr_worker.ts's, since
// MediaPipe's Tasks Vision API runs natively in the browser via WASM —
// it's the SAME underlying MediaPipe model, just the JS bindings
// instead of the Python ones, with solvePnP-equivalent head-pose math
// reimplemented (no OpenCV in-browser, so cv2.solvePnP is replaced with
// a direct closed-form estimate from a few landmark ratios — see
// estimateYawPitch below for the simplification).
//
// WHAT CHANGED: the Python version used cv2.solvePnP with a generic 3D
// face model + camera intrinsics for full 3D pose recovery. Re-deriving
// that without OpenCV would mean shipping a WASM build of solvePnP
// (possible, but heavy). Instead this estimates yaw/pitch from
// normalized landmark geometry directly (eye-to-nose horizontal offset
// for yaw, nose-to-chin vertical offset for pitch) — less precise than
// full PnP but sufficient for the same coarse "is the user looking
// left/right/up/down" classification the original used. If false
// negatives on liveness become a problem in testing, revisit with a
// proper PnP-in-WASM implementation.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const NOSE_TIP = 1;
const CHIN = 199;
const LEFT_EYE = 33;
const RIGHT_EYE = 263;
const FOREHEAD = 10;

const TURN_THRESHOLD = 0.06; // normalized units, tuned empirically — adjust during QA
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
  yawProxy: number; // signed, positive = looking right
  pitchProxy: number; // signed, positive = looking down
}

async function estimateYawPitch(image: HTMLImageElement | HTMLCanvasElement): Promise<Pose | null> {
  const landmarker = await getLandmarker();
  const result = landmarker.detect(image as HTMLImageElement);

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  const lm = result.faceLandmarks[0];

  const nose = lm[NOSE_TIP];
  const chin = lm[CHIN];
  const leftEye = lm[LEFT_EYE];
  const rightEye = lm[RIGHT_EYE];
  const forehead = lm[FOREHEAD];

  // Yaw proxy: nose horizontal position relative to the eye midpoint.
  // When facing the camera, nose.x sits between the eyes; turning the
  // head shifts it toward one side.
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeSpan = Math.abs(rightEye.x - leftEye.x) || 0.01;
  const yawProxy = (nose.x - eyeMidX) / eyeSpan;

  // Pitch proxy: nose vertical position relative to the forehead-chin
  // midline. Looking down shifts the nose toward the chin; looking up
  // shifts it toward the forehead.
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
  score: number; // 0-1, fraction of required poses detected
  detectedPoses: PoseLabel[];
}

/** Checks that all 4 head poses (left, right, up, down) are present
 * across the provided images — direct port of liveness_check_multi. */
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

/** Single-image fallback — checks a face is detectable and roughly
 * centered, mirroring the Python version's liveness_check(). */
export async function livenessCheckSingle(
  image: HTMLImageElement | HTMLCanvasElement
): Promise<{ centered: boolean; score: number }> {
  const pose = await estimateYawPitch(image);
  if (!pose) return { centered: false, score: 0 };

  const centered = Math.abs(pose.yawProxy) < 0.15 && Math.abs(pose.pitchProxy) < 0.15;
  const score = Math.max(0, 1 - (Math.abs(pose.yawProxy) + Math.abs(pose.pitchProxy)) / 0.6);
  return { centered, score: Math.round(score * 1000) / 1000 };
}
