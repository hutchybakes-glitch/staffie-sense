// perception.js — the only ML in the app: MediaPipe's EfficientDet-Lite object
// detector finds the dog's box. Motion is measured with plain frame differencing.
// All files load from this site (vendored), never from a CDN.

import { FilesetResolver, ObjectDetector } from '../vendor/mediapipe/vision_bundle.mjs';

// Create the detector, trying the GPU delegate first and falling back to CPU (WASM).
// `delegates` overrides the order tried, e.g. ['CPU'] after a slow-GPU fallback.
export async function createDetector(rules, modelKey, delegates = null) {
  const D = rules.detection;
  const fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
  const modelPath = new URL('../' + D.models[modelKey || D.model], import.meta.url).href;
  const allow = [...D.preferredLabels, ...D.fallbackLabels];
  let lastErr;
  // ?delegate=cpu or ?delegate=gpu in the URL forces one delegate (handy for testing).
  const forced = new URLSearchParams(location.search).get('delegate');
  const order = forced ? [forced.toUpperCase()] : (delegates || ['GPU', 'CPU']);
  for (const delegate of order) {
    try {
      const det = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        scoreThreshold: D.scoreThreshold,
        maxResults: D.maxResults,
        categoryAllowlist: allow,
      });
      return { det, delegate };
    } catch (e) {
      lastErr = e;
      console.warn(`Detector with ${delegate} delegate failed, trying next`, e);
    }
  }
  throw lastErr;
}

// Intersection-over-union of two {x,y,w,h} boxes.
function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

// Pick the one detection we treat as "the dog".
// Prefer a "dog" label; otherwise accept look-alike labels (dark brindle Staffies are
// sometimes called cat/bear/sheep). Among candidates, stick with whatever overlaps the
// previous box most, else take the highest score.
export function pickDog(detections, rules, prevBox) {
  const D = rules.detection;
  const cands = detections.map((d) => {
    const c = d.categories[0];
    const b = d.boundingBox;
    return { label: c.categoryName, score: c.score, box: { x: b.originX, y: b.originY, w: b.width, h: b.height } };
  });
  const preferred = cands.filter((c) => D.preferredLabels.includes(c.label));
  const pool = preferred.length ? preferred : cands.filter((c) => D.fallbackLabels.includes(c.label));
  if (!pool.length) return null;
  const rank = (c) => (prevBox ? iou(c.box, prevBox) : 0) * 2 + c.score;
  return pool.reduce((best, c) => (rank(c) > rank(best) ? c : best));
}

// Frame-difference motion meter on a small greyscale copy of each frame.
export class MotionMeter {
  // gridWidth: width of the downscaled frame; threshold: grey-level change that counts as "moved".
  // maxShift: largest camera-shake shift (grid pixels) to compensate for.
  constructor(gridWidth, threshold, maxShift = 3) {
    this.gridWidth = gridWidth;
    this.maxShift = maxShift;
    this.lastShift = 0;
    this.threshold = threshold;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.prev = null;
  }

  // Forget the previous frame (after Stop, or a resolution change).
  reset() {
    this.prev = null;
  }

  // Measure fraction of changed pixels inside and outside `box` (in source-pixel units).
  // Returns { motionIn, motionOut, shift } or null on the first frame.
  measure(source, srcW, srcH, box) {
    const gw = this.gridWidth;
    const gh = Math.max(1, Math.round((gw * srcH) / srcW));
    if (this.canvas.width !== gw || this.canvas.height !== gh) {
      this.canvas.width = gw;
      this.canvas.height = gh;
      this.prev = null;
    }
    this.ctx.drawImage(source, 0, 0, gw, gh);
    const px = this.ctx.getImageData(0, 0, gw, gh).data;
    // Convert to greyscale (integer luma approximation).
    const grey = new Uint8Array(gw * gh);
    for (let i = 0, j = 0; j < grey.length; i += 4, j++) {
      grey[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
    }
    const prev = this.prev;
    this.prev = grey;
    if (!prev) return null;

    // Box in grid coordinates (whole frame counts as "outside" when there's no box).
    const s = gw / srcW;
    const bx0 = box ? Math.floor(box.x * s) : -1;
    const by0 = box ? Math.floor(box.y * s) : -1;
    const bx1 = box ? Math.ceil((box.x + box.w) * s) : -1;
    const by1 = box ? Math.ceil((box.y + box.h) * s) : -1;
    const inBox = (x, y) => x >= bx0 && x < bx1 && y >= by0 && y < by1;

    // Shake compensation: find the small whole-frame shift (dx, dy) that best lines the
    // previous frame up with this one, judged on background pixels when there are enough
    // of them. Movement is then measured after undoing that shift.
    const R = this.maxShift;
    const x0 = R, x1 = gw - R, y0 = R, y1 = gh - R;
    let bgCount = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (!inBox(x, y)) bgCount++;
    const useBg = bgCount >= 0.15 * ((x1 - x0) * (y1 - y0)) / 4;
    let best = { dx: 0, dy: 0, err: Infinity };
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        let err = 0, n = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            if (useBg && inBox(x, y)) continue;
            err += Math.abs(grey[y * gw + x] - prev[(y + dy) * gw + x + dx]);
            n++;
          }
        }
        err = n ? err / n : 0;
        // Strictly-less keeps the result deterministic and prefers "no shift" on ties.
        const zeroFirst = dx === 0 && dy === 0 ? -1e-9 : 0;
        if (err + zeroFirst < best.err) best = { dx, dy, err };
      }
    }

    let inN = 0, inMoved = 0, outN = 0, outMoved = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const moved = Math.abs(grey[y * gw + x] - prev[(y + best.dy) * gw + x + best.dx]) > this.threshold ? 1 : 0;
        if (inBox(x, y)) { inN++; inMoved += moved; }
        else { outN++; outMoved += moved; }
      }
    }
    this.lastShift = Math.hypot(best.dx, best.dy);
    return { motionIn: inN ? inMoved / inN : 0, motionOut: outN ? outMoved / outN : 0, shift: this.lastShift };
  }
}
