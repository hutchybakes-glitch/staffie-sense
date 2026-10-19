// features.js — pure functions that turn a short history of per-frame
// observations into windowed features. No DOM, no randomness, so the same
// history always gives the same features (and it runs under Node for tests).
//
// A frame record looks like:
//   { t, present, score, label, cx, cy, w, h, areaFrac, motionIn, motionOut }
// where t is seconds, cx/cy/w/h are in pixels of the processed frame,
// and motionIn/motionOut are fractions (0–1) of changed pixels inside/outside the dog box.

// Median of a numeric array (null when empty).
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Arithmetic mean (null when empty).
export function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Clamp a number into [lo, hi].
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Frames whose time falls in [now - from, now - to].
function slice(frames, now, from, to) {
  return frames.filter((f) => f.t >= now - from && f.t <= now - to);
}

// Net motion for one frame: movement inside the box minus whole-scene movement,
// so a small camera wobble or lighting flicker doesn't count as the dog moving.
export function netMotion(f) {
  return Math.max(0, f.motionIn - f.motionOut);
}

// Compute all windowed features at time `now`.
// Returns { features, gate, info } where gate is null or a plain-English reason
// the reading is unclear, and every feature is a number or null (not measurable).
export function computeFeatures(frames, now, rules, baseline) {
  const W = rules.windows;
  const G = rules.gates;
  const base = baseline || rules.baselineDefaults;
  // Never divide by a tiny baseline: a very still calibration would make every twitch look huge.
  const baseMotion = Math.max(base.motion ?? rules.baselineDefaults.motion, rules.baselineFloors.motion);

  const win = slice(frames, now, W.featureSeconds, 0);
  const present = win.filter((f) => f.present);
  const presenceFrac = win.length ? present.length / win.length : 0;

  const info = {
    presenceFrac,
    detScore: median(present.map((f) => f.score)),
    areaFrac: median(present.map((f) => f.areaFrac)),
    cameraMotion: median(win.map((f) => f.motionOut)),
    motionNet: mean(present.map(netMotion)),
    baseMotion,
  };

  const empty = {
    motionRel: null, motionNowRel: null, motionPrevRel: null, freeze: null,
    speed: null, aspect: null, aspectVar: null, heightChange: null,
  };

  // Gates: decide whether the picture is good enough to say anything at all.
  let gate = null;
  if (!present.length) gate = 'no dog in view';
  else if (presenceFrac < G.minPresenceFraction) gate = 'dog not detected consistently';
  else if (info.areaFrac < G.minAreaFrac) gate = 'dog too small in frame, move closer';
  else if (info.areaFrac > G.maxAreaFrac) gate = 'dog fills the frame, step back so some background is visible';
  else if (info.detScore < G.minDetScore) gate = 'detection confidence low';
  else if (info.cameraMotion > G.maxCameraMotion) gate = 'camera moving, hold the phone still or prop it up';
  if (gate) return { features: empty, gate, info };

  const f = { ...empty };

  // Movement relative to the relaxed baseline (1.0 = same as baseline).
  f.motionRel = mean(present.map(netMotion)) / baseMotion;

  // Movement in the last second, and in an earlier window, to spot sudden freezes.
  const nowFrames = slice(present, now, W.nowSeconds, 0);
  const prevFrames = slice(frames, now, W.prevFromSeconds, W.prevToSeconds).filter((x) => x.present);
  if (nowFrames.length >= 3) f.motionNowRel = mean(nowFrames.map(netMotion)) / baseMotion;
  if (prevFrames.length >= 3) f.motionPrevRel = mean(prevFrames.map(netMotion)) / baseMotion;

  // Freeze: how much movement dropped, scaled by how much there was to begin with.
  if (f.motionNowRel !== null && f.motionPrevRel !== null && f.motionPrevRel > 0) {
    const drop = clamp(1 - f.motionNowRel / f.motionPrevRel, 0, 1);
    const wasMoving = clamp(f.motionPrevRel - 1, 0, 1);
    f.freeze = drop * wasMoving;
  }

  // Speed: centre displacement across the window, in body-lengths per second.
  if (present.length >= 3) {
    const a = present[0];
    const b = present[present.length - 1];
    const dt = b.t - a.t;
    const body = median(present.map((x) => Math.max(x.w, x.h)));
    if (dt > 0.3 && body > 0) {
      f.speed = Math.hypot(b.cx - a.cx, b.cy - a.cy) / body / dt;
    }
  }

  // Box shape: width / height. Big = long and low (lying side-on), small = tall (sitting / facing camera).
  const aspects = present.map((x) => x.w / x.h);
  f.aspect = median(aspects);
  // Variation in shape over the window (coefficient of variation): wiggles, bounces, turning.
  if (aspects.length >= 4) {
    const m = mean(aspects);
    const sd = Math.sqrt(mean(aspects.map((v) => (v - m) ** 2)));
    f.aspectVar = sd / m;
  }

  // Height change: box height-to-width now vs a few seconds ago (square-rooted so it's
  // roughly "fractional height change"). Scale-free, so walking towards the camera doesn't count.
  const ref = slice(frames, now, W.heightRefFromSeconds, W.heightRefToSeconds).filter((x) => x.present);
  if (nowFrames.length >= 3 && ref.length >= 3) {
    const hwNow = median(nowFrames.map((x) => x.h / x.w));
    const hwRef = median(ref.map((x) => x.h / x.w));
    f.heightChange = Math.sqrt(hwNow / hwRef) - 1;
  }

  return { features: f, gate: null, info };
}
