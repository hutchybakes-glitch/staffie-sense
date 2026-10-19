// Unit tests for the deterministic pipeline: features → rule scores → state machine.
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeFeatures } from '../docs/js/features.js';
import { scoreStates, StateMachine, ramp, trapezoid } from '../docs/js/scoring.js';
import { computeBaseline } from '../docs/js/calibration.js';

const rules = JSON.parse(readFileSync(new URL('../docs/rules.json', import.meta.url)));

// Build a synthetic frame sequence at 10 fps. `fn(t)` returns per-frame overrides.
function makeFrames(seconds, fn) {
  const frames = [];
  for (let i = 0; i <= seconds * 10; i++) {
    const t = i / 10;
    frames.push({
      t, present: true, score: 0.8, label: 'dog',
      cx: 320, cy: 240, w: 300, h: 150, areaFrac: 0.15,
      motionIn: 0.02, motionOut: 0.0,
      ...fn(t),
    });
  }
  return frames;
}

// Run the whole pipeline over a sequence; returns the per-step outputs.
function runPipeline(frames, baseline = null) {
  const sm = new StateMachine(rules);
  const outs = [];
  for (let i = 0; i < frames.length; i++) {
    const hist = frames.slice(0, i + 1);
    const { features, gate } = computeFeatures(hist, frames[i].t, rules, baseline);
    outs.push(sm.update(frames[i].t, gate, scoreStates(features, rules)));
  }
  return outs;
}

test('ramp and trapezoid', () => {
  assert.equal(ramp(0.5, 0, 1), 0.5);
  assert.equal(ramp(2, 0, 1), 1);
  assert.equal(ramp(0.25, 1, 0), 0.75);
  assert.equal(trapezoid(1.5, 0, 1, 2, 3), 1);
  assert.equal(trapezoid(2.5, 0, 1, 2, 3), 0.5);
  assert.equal(trapezoid(-1, 0, 1, 2, 3), 0);
});

test('no dog → unclear with a reason', () => {
  const frames = makeFrames(5, () => ({ present: false }));
  const out = runPipeline(frames).at(-1);
  assert.equal(out.state, 'unclear');
  assert.match(out.reasons[0], /no dog/);
});

test('dog too small → unclear', () => {
  const frames = makeFrames(5, () => ({ areaFrac: 0.005 }));
  const out = runPipeline(frames).at(-1);
  assert.equal(out.state, 'unclear');
  assert.match(out.reasons[0], /too small/);
});

test('shaky camera → unclear', () => {
  const frames = makeFrames(5, () => ({ motionOut: 0.5, motionIn: 0.6 }));
  assert.equal(runPipeline(frames).at(-1).state, 'unclear');
});

test('lying still, long box → resting', () => {
  const frames = makeFrames(8, () => ({ motionIn: 0.003, w: 360, h: 160 }));
  const out = runPipeline(frames).at(-1);
  assert.equal(out.state, 'resting');
  assert.ok(out.reasons.length >= 1);
});

test('baseline-level movement, steady → relaxed', () => {
  const frames = makeFrames(8, () => ({ motionIn: 0.02, w: 260, h: 200 }));
  assert.equal(runPipeline(frames).at(-1).state, 'relaxed');
});

test('lots of movement and travel → active', () => {
  const frames = makeFrames(8, (t) => ({
    motionIn: 0.15, cx: 100 + 250 * t, w: 260 + 60 * Math.sin(t * 6), h: 200,
  }));
  assert.equal(runPipeline(frames).at(-1).state, 'active');
});

test('moving then sudden still and taller → alert', () => {
  const frames = makeFrames(9, (t) => (t < 6
    ? { motionIn: 0.08, w: 300, h: 160 }
    : { motionIn: 0.002, w: 230, h: 230 }));
  const outs = runPipeline(frames);
  assert.ok(outs.slice(-25).some((o) => o.state === 'alert'), 'alert should appear after the freeze');
});

test('hysteresis: a 0.3 s twitch does not change the label', () => {
  const frames = makeFrames(10, (t) => (t > 7 && t < 7.3 ? { motionIn: 0.06, w: 360, h: 160 } : { motionIn: 0.003, w: 360, h: 160 }));
  const outs = runPipeline(frames);
  const after = outs.filter((_, i) => frames[i].t > 6);
  assert.ok(after.every((o) => o.state === 'resting'), after.map((o) => o.state).join(','));
});

test('deterministic: same input → same output', () => {
  const frames = makeFrames(8, (t) => ({ motionIn: 0.02 + 0.01 * Math.sin(t), w: 300 + 20 * Math.cos(t) }));
  assert.deepEqual(runPipeline(frames), runPipeline(frames));
});

test('missing features renormalise rather than fail', () => {
  const res = scoreStates({ motionRel: 0.2, motionNowRel: null, motionPrevRel: null, freeze: null, speed: 0.01, aspect: 2.0, aspectVar: null, heightChange: null }, rules);
  assert.ok(res.resting.score > 0.9);
  assert.ok(res.resting.evidence === 1);
  assert.ok(res.alert.score === null, 'alert has too little evidence');
});

test('calibration baseline', () => {
  const frames = makeFrames(15, () => ({ motionIn: 0.03 }));
  const res = computeBaseline(frames, rules);
  assert.ok(res.ok);
  assert.ok(Math.abs(res.baseline.motion - 0.03) < 1e-9);
  assert.equal(res.baseline.aspect, 2);
  const bad = computeBaseline(makeFrames(15, () => ({ present: false })), rules);
  assert.equal(bad.ok, false);
});
