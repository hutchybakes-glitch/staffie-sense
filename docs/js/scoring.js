// scoring.js — deterministic rule scoring and the label state machine.
// Every number used here comes from rules.json. No DOM, no randomness.

import { clamp } from './features.js';

// Features whose thresholds scale with the user's sensitivity setting.
const SENSITIVITY_FEATURES = new Set(['motionRel', 'motionNowRel']);

// Linear ramp: 0 at a, 1 at b (works in both directions).
export function ramp(v, a, b) {
  if (a === b) return v >= b ? 1 : 0;
  return clamp((v - a) / (b - a), 0, 1);
}

// Trapezoid: rises a->b, 1 between b and c, falls c->d.
export function trapezoid(v, a, b, c, d) {
  if (v <= a || v >= d) return 0;
  if (v < b) return (v - a) / (b - a);
  if (v <= c) return 1;
  return (d - v) / (d - c);
}

// Membership (0–1) of one signal for a feature value, with sensitivity applied.
function membership(sig, value, sens) {
  const k = SENSITIVITY_FEATURES.has(sig.feature) ? sens : 1;
  if (sig.ramp) return ramp(value, sig.ramp[0] * k, sig.ramp[1] * k);
  const [a, b, c, d] = sig.trapezoid.map((x) => x * k);
  return trapezoid(value, a, b, c, d);
}

// Score every state. Signals whose feature is null drop out and the remaining
// weights renormalise. A state with too little evidence gets score null.
export function scoreStates(features, rules, sensitivity = 'normal') {
  const sens = rules.sensitivity[sensitivity] ?? 1;
  const out = {};
  for (const [name, st] of Object.entries(rules.states)) {
    let total = 0;
    let avail = 0;
    let sum = 0;
    // "required" signals multiply the score: e.g. resting is impossible while moving a lot.
    let requiredFactor = 1;
    let requiredMissing = false;
    const contributions = [];
    for (const sig of st.signals) {
      total += sig.weight;
      const v = features[sig.feature];
      if (v === null || v === undefined || Number.isNaN(v)) {
        if (sig.required) requiredMissing = true;
        continue;
      }
      const m = membership(sig, v, sens);
      avail += sig.weight;
      sum += sig.weight * m;
      if (sig.required) requiredFactor *= m;
      contributions.push({ feature: sig.feature, value: v, membership: m, weight: sig.weight, reason: sig.reason });
    }
    const evidence = total ? avail / total : 0;
    const enough = evidence >= rules.gates.minEvidenceFraction && avail > 0 && !requiredMissing;
    const score = enough ? (sum / avail) * requiredFactor : null;
    out[name] = { score, evidence, contributions };
  }
  return out;
}

// Top plain-English reasons for a state: signals that mostly matched, strongest first.
export function topReasons(stateResult, maxReasons) {
  return stateResult.contributions
    .filter((c) => c.membership >= 0.5)
    .sort((a, b) => b.weight * b.membership - a.weight * a.membership || a.feature.localeCompare(b.feature))
    .slice(0, maxReasons)
    .map((c) => c.reason);
}

// State machine with score smoothing and hysteresis so the label doesn't flicker.
export class StateMachine {
  // rules: the parsed rules.json.
  constructor(rules) {
    this.rules = rules;
    this.reset();
  }

  // Forget all history (e.g. on Stop).
  reset() {
    this.state = 'unclear';
    this.smoothed = null;
    this.lastT = null;
    this.pending = null;
    this.pendingSince = null;
    this.lastResults = null;
  }

  // Feed one scoring step. t in seconds, gate = null or reason string, results from scoreStates.
  // Returns what the UI should show.
  update(t, gate, results) {
    const SM = this.rules.stateMachine;
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;

    let candidate;
    let unclearReason = gate;
    if (gate) {
      // Bad input: drop smoothing so stale scores don't carry over when the dog reappears.
      this.smoothed = null;
      candidate = 'unclear';
    } else {
      this.lastResults = results;
      // Exponential smoothing of each state's score over ~scoreSmoothingSeconds.
      const alpha = this.smoothed === null ? 1 : 1 - Math.exp(-dt / SM.scoreSmoothingSeconds);
      const next = {};
      for (const [name, r] of Object.entries(results)) {
        const prev = this.smoothed?.[name];
        if (r.score === null) next[name] = null;
        else if (prev === null || prev === undefined) next[name] = r.score;
        else next[name] = prev + alpha * (r.score - prev);
      }
      this.smoothed = next;
      // Leader = highest smoothed score (ties broken by rules.json order, so it's deterministic).
      let best = null;
      for (const [name, s] of Object.entries(next)) {
        if (s !== null && (best === null || s > next[best])) best = name;
      }
      if (best === null) {
        candidate = 'unclear';
        unclearReason = 'too few signals visible';
      } else if (next[best] < this.rules.gates.minTopScore) {
        candidate = 'unclear';
        unclearReason = 'signals don\'t clearly match any state';
      } else {
        candidate = best;
      }
    }

    // Hysteresis: a new leader must beat the current state by a margin, for a minimum dwell time.
    if (candidate === this.state) {
      this.pending = null;
    } else {
      const curScore = this.state === 'unclear' ? 0 : (this.smoothed?.[this.state] ?? 0);
      const candScore = candidate === 'unclear' ? Infinity : this.smoothed[candidate];
      const beats = candidate === 'unclear' || this.state === 'unclear' || candScore >= curScore + SM.switchMargin;
      if (!beats) {
        this.pending = null;
      } else if (this.pending !== candidate) {
        this.pending = candidate;
        this.pendingSince = t;
      }
      // Hard gates (no dog, camera moving) switch to unclear faster than ordinary ambiguity.
      const dwell = candidate === 'unclear' && gate ? SM.unclearDwellSeconds : SM.minDwellSeconds;
      if (this.pending === candidate && t - this.pendingSince >= dwell) {
        this.state = candidate;
        this.pending = null;
      }
    }

    // Build the display output for the current (possibly unchanged) state.
    let reasons = [];
    let confidence = 0;
    if (this.state === 'unclear') {
      reasons = [unclearReason || 'settling…'];
    } else if (this.smoothed && this.lastResults) {
      const r = this.lastResults[this.state];
      reasons = topReasons(r, SM.maxReasons);
      if (!reasons.length) reasons = ['weak match: signals are borderline'];
      confidence = clamp((this.smoothed[this.state] ?? 0) * r.evidence, 0, 1);
    } else {
      reasons = [unclearReason || 'settling…'];
    }
    return {
      state: this.state,
      label: this.state === 'unclear' ? 'Unclear' : this.rules.states[this.state].label,
      reasons,
      confidence,
      smoothed: this.smoothed,
      candidate,
      pending: this.pending,
    };
  }
}
