import * as faceapi from 'face-api.js';

let loadingPromise = null;
let modelsReady = false;

const modelPath = `${process.env.PUBLIC_URL || ''}/models`;

/** True after models are downloaded AND the first warm-up inference has run (GPU shaders compiled). */
export function areFaceModelsReady() {
  return modelsReady;
}

/**
 * Run throwaway inferences so TensorFlow.js compiles all GPU shaders / WebGL
 * kernels now instead of on the first real scan.
 *
 * We call `detectAllFaces().withFaceLandmarks().withFaceDescriptors()` (the
 * "All" variants) because they always return an array — never undefined — even
 * when zero faces are found.  This guarantees the landmark and descriptor
 * network kernels also get compiled, not just the detector.
 *
 * Run sequentially; parallel warm-ups can race on WebGL context setup.
 */
async function warmUpModels() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, 320, 240);
  ctx.fillStyle = '#555';
  ctx.fillRect(80, 40, 160, 160);

  try {
    await faceapi
      .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.01 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
  } catch (_) { /* ignore */ }

  try {
    await faceapi
      .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.01 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
  } catch (_) { /* ignore */ }
}

export function loadFaceModelsOnce() {
  if (modelsReady) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    console.time('[FaceVerification] Models load + warm-up');
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
      faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelPath)
    ]);
    console.log('[FaceVerification] Weights downloaded — running warm-up inference…');
    await warmUpModels();
    console.timeEnd('[FaceVerification] Models load + warm-up');
    modelsReady = true;
  })().catch((e) => {
    loadingPromise = null;
    throw e;
  });
  return loadingPromise;
}

const SSD_OPTIONS = new faceapi.SsdMobilenetv1Options({
  minConfidence: 0.4
});

const TINY_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 608,
  scoreThreshold: 0.35
});

/**
 * Detect a face and extract its 128-D descriptor.
 * Uses SSD MobileNet v1 (more accurate) first, then falls back to TinyFaceDetector.
 */
async function detectWithDescriptor(img) {
  let det = await faceapi
    .detectSingleFace(img, SSD_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (det) return det;

  det = await faceapi
    .detectSingleFace(img, TINY_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor();
  return det || null;
}

/**
 * Load an image element from a data URL or regular URL.
 * For JPEG data URLs we re-render through a canvas at full quality to give the
 * detector the cleanest possible pixels.
 */
async function loadImage(src) {
  return faceapi.fetchImage(src);
}

/**
 * Extract a face descriptor from a data URL (or regular image URL).
 * Returns Float32Array(128) or null if no face found.
 */
export async function descriptorFromDataUrl(dataUrl) {
  await loadFaceModelsOnce();
  const img = await loadImage(dataUrl);
  const det = await detectWithDescriptor(img);
  return det ? det.descriptor : null;
}

/**
 * Extract multiple descriptors from one image using both detectors.
 * The averaged result is more robust for registration photos.
 */
export async function descriptorFromDataUrlRobust(dataUrl) {
  await loadFaceModelsOnce();
  const img = await loadImage(dataUrl);

  const results = [];

  const ssd = await faceapi
    .detectSingleFace(img, SSD_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (ssd) results.push(ssd.descriptor);

  const tiny = await faceapi
    .detectSingleFace(img, TINY_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (tiny) results.push(tiny.descriptor);

  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  const avg = new Float32Array(128);
  for (const d of results) {
    for (let i = 0; i < 128; i++) avg[i] += d[i];
  }
  for (let i = 0; i < 128; i++) avg[i] /= results.length;
  return avg;
}

/**
 * Confidence mapping — tuned so that real same-person distances (~0.2–0.4)
 * produce 75%+ and different-person distances (>0.6) produce <50%.
 *
 * Uses a smooth cosine-based curve centered around the typical match threshold (0.6).
 */
export function confidenceFromDistance(distance) {
  const MATCH_THRESHOLD = 0.6;
  const RANGE = 0.7;

  const t = Math.max(0, Math.min(1, (MATCH_THRESHOLD + RANGE / 2 - distance) / RANGE));
  return Math.max(0, Math.min(100, Math.round(100 * (0.5 + 0.5 * Math.cos(Math.PI * (1 - t))))));
}

/** Dispatched when threshold or capture-station FRS on/off changes (same-tab + listeners). */
export const FACE_SETTINGS_CHANGED_EVENT = 'schoolPickup_faceSettingsChanged';

export function notifyFaceSettingsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FACE_SETTINGS_CHANGED_EVENT));
  }
}

/** localStorage key — Admin panel slider and capture station read the same value */
export const FACE_MATCH_THRESHOLD_STORAGE_KEY = 'schoolPickup_faceMatchThreshold';

const DEFAULT_FACE_MATCH_THRESHOLD = 75;
export const FACE_MATCH_THRESHOLD_MIN = 50;
export const FACE_MATCH_THRESHOLD_MAX = 95;

/** When false, capture station skips guardian face verification (pickup photos still saved). */
export const FACE_RECOGNITION_ENABLED_STORAGE_KEY = 'schoolPickup_faceRecognitionEnabled';

export function getFaceRecognitionEnabled() {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(FACE_RECOGNITION_ENABLED_STORAGE_KEY);
    if (v === null) return true;
    return v === '1' || v === 'true';
  } catch {
    return true;
  }
}

export function setFaceRecognitionEnabled(enabled) {
  const on = !!enabled;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(FACE_RECOGNITION_ENABLED_STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    notifyFaceSettingsChanged();
  }
  return on;
}

export function getFaceMatchThreshold() {
  if (typeof window === 'undefined') return DEFAULT_FACE_MATCH_THRESHOLD;
  try {
    const raw = window.localStorage.getItem(FACE_MATCH_THRESHOLD_STORAGE_KEY);
    const n = raw != null ? parseInt(raw, 10) : DEFAULT_FACE_MATCH_THRESHOLD;
    if (Number.isNaN(n)) return DEFAULT_FACE_MATCH_THRESHOLD;
    return Math.min(
      FACE_MATCH_THRESHOLD_MAX,
      Math.max(FACE_MATCH_THRESHOLD_MIN, n)
    );
  } catch {
    return DEFAULT_FACE_MATCH_THRESHOLD;
  }
}

export function setFaceMatchThreshold(percent) {
  const n = Math.min(
    FACE_MATCH_THRESHOLD_MAX,
    Math.max(FACE_MATCH_THRESHOLD_MIN, Math.round(Number(percent)))
  );
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FACE_MATCH_THRESHOLD_STORAGE_KEY, String(n));
    notifyFaceSettingsChanged();
  }
  return n;
}

/**
 * @param {string} dataUrl - live capture JPEG data URL
 * @param {Array<{ label?: string, name?: string, image?: string, descriptor?: number[] }>} guardians
 */
export async function verifyLiveCaptureToGuardians(dataUrl, guardians) {
  if (!getFaceRecognitionEnabled()) {
    return {
      status: 'disabled',
      message: 'Face recognition is turned off.',
      yes: false,
      confidence: 0,
      bestLabel: '',
      matchedGuardian: null
    };
  }
  await loadFaceModelsOnce();
  const live = await descriptorFromDataUrl(dataUrl);
  if (!live) {
    return {
      status: 'no_face',
      message: 'No face detected in live capture',
      yes: false,
      confidence: 0,
      bestLabel: '',
      matchedGuardian: null
    };
  }
  const refs = (guardians || []).filter(
    (g) => Array.isArray(g.descriptor) && g.descriptor.length === 128
  );
  if (!refs.length) {
    return {
      status: 'no_refs',
      message: 'No reference faces registered',
      yes: false,
      confidence: 0,
      bestLabel: '',
      matchedGuardian: null
    };
  }
  let bestDist = Infinity;
  let bestLabel = '';
  let matchedGuardian = null;
  for (const g of refs) {
    const ref = new Float32Array(g.descriptor);
    const d = faceapi.euclideanDistance(live, ref);
    if (d < bestDist) {
      bestDist = d;
      bestLabel = g.label || g.name || 'Guardian';
      matchedGuardian = {
        label: bestLabel,
        name: (g.name || '').trim(),
        image: (g.image || '').trim()
      };
    }
  }
  const confidence = confidenceFromDistance(bestDist);
  const minMatch = getFaceMatchThreshold();
  return {
    status: 'ok',
    message: '',
    yes: confidence >= minMatch,
    confidence,
    bestLabel,
    distance: bestDist,
    matchedGuardian
  };
}
