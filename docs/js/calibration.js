// calibration.js — turn ~15 s of "he's relaxed now" frames into a baseline.
// Pure function (no DOM) so it can be unit-tested.

import { mean, median, netMotion } from './features.js';

// Quantile of a numeric array (linear interpolation); null when empty.
function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// Build a baseline from captured frames. Returns { ok, baseline?, reason? }.
// motion uses the mean, matching how the live motion feature is computed.
export function computeBaseline(frames, rules) {
  const present = frames.filter((f) => f.present);
  const validFrac = frames.length ? present.length / frames.length : 0;
  if (validFrac < rules.calibration.minValidFraction || present.length < 10) {
    return { ok: false, reason: `dog only detected in ${Math.round(validFrac * 100)}% of frames, keep him in view and try again` };
  }
  const motions = present.map(netMotion);
  const aspects = present.map((f) => f.w / f.h);
  return {
    ok: true,
    baseline: {
      version: 1,
      capturedAt: new Date().toISOString(),
      frames: present.length,
      motion: mean(motions),
      motionMedian: median(motions),
      motionIQR: [quantile(motions, 0.25), quantile(motions, 0.75)],
      aspect: median(aspects),
      aspectIQR: [quantile(aspects, 0.25), quantile(aspects, 0.75)],
      areaFrac: median(present.map((f) => f.areaFrac)),
    },
  };
}
