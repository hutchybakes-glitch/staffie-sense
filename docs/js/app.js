// app.js — wires camera → detector → motion → features → rules → state machine → UI.

import { createDetector, pickDog, MotionMeter } from './perception.js';
import { computeFeatures } from './features.js';
import { scoreStates, StateMachine } from './scoring.js';
import { computeBaseline } from './calibration.js';
import { load, save, remove, saveFile } from './storage.js';

// ---------- DOM handles ----------
const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const ui = {
  state: $('stateLabel'), reason: $('reason'), conf: $('confBar'), badge: $('calibBadge'),
  banner: $('banner'), debug: $('debug'), startOverlay: $('startOverlay'),
  start: $('startBtn'), stop: $('stopBtn'), calib: $('calibBtn'), debugBtn: $('debugBtn'),
  csv: $('csvBtn'), settings: $('settingsBtn'), info: $('infoBtn'),
  infoDialog: $('infoDialog'), settingsDialog: $('settingsDialog'),
  dogName: $('dogName'), sensitivity: $('sensitivity'), modelKey: $('modelKey'),
  baselineInfo: $('baselineInfo'), exportBtn: $('exportBtn'), importFile: $('importFile'), clearBtn: $('clearBtn'),
};

// ---------- App state ----------
let rules = null;
let detector = null;          // { det, delegate, modelKey }
let stream = null;
let running = false;
let wakeLock = null;
let sm = null;
let meter = null;
let frames = [];              // recent per-frame records (rolling history)
let smoothBox = null;         // display/feature box after light smoothing
let lastInferMs = 0;
let lastProcessT = 0;
let fpsTimes = [];            // timestamps of processed frames in the last second
let inferMsAvg = 0;
let framesSinceStart = 0;
let switching = false;        // true while swapping the detector to CPU
let sessionStart = null;      // seconds (performance clock) when Start was pressed
let sessionStartIso = null;
let csvRows = [];
let lastLoggedSecond = -1;
let calib = null;             // { until, frames } while calibrating
let last = null;              // latest { features, info, gate, results, out, pick }

const settings = {
  dogName: load('dogName', ''),
  sensitivity: load('sensitivity', 'normal'),
  modelKey: load('modelKey', null),
};
let baseline = load('baseline', null);

// ---------- Helpers ----------

// Format a number for display (or "–" when not measurable).
function fmt(v, d = 2) {
  return v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(d);
}

// Show a temporary message at the bottom of the screen (0 = stays until replaced).
let bannerTimer = null;
function showBanner(text, ms = 4000) {
  ui.banner.textContent = text;
  ui.banner.hidden = false;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => { ui.banner.hidden = true; }, ms);
}

// Refresh the "calibrated / not calibrated" badge and the settings text.
function renderBaselineInfo() {
  const name = settings.dogName || 'your dog';
  if (baseline) {
    ui.badge.textContent = 'calibrated';
    ui.badge.classList.add('ok');
    ui.baselineInfo.textContent =
      `Baseline for ${name}, captured ${new Date(baseline.capturedAt).toLocaleString()}\n` +
      `movement ${fmt(baseline.motion, 3)}, box shape ${fmt(baseline.aspect)}, ${baseline.frames} frames`;
  } else {
    ui.badge.textContent = 'not calibrated';
    ui.badge.classList.remove('ok');
    ui.baselineInfo.textContent = 'No baseline yet: using generic defaults. Use Calibrate while he is relaxed.';
  }
}

// Load rules.json (the single source of truth for thresholds).
async function loadRules() {
  const res = await fetch('rules.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`rules.json: HTTP ${res.status}`);
  return res.json();
}

// Ask iOS/Chrome to keep the screen on while running (where supported).
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('wake lock unavailable', e);
  }
}

// Re-acquire the wake lock when the page becomes visible again (iOS drops it on hide).
document.addEventListener('visibilitychange', () => {
  if (running && document.visibilityState === 'visible') requestWakeLock();
});

// ---------- Start / stop ----------

// Start the camera and the processing loop. Must run from a tap (iOS rule).
async function start() {
  ui.start.disabled = true;
  ui.reason.textContent = 'Starting camera…';
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera needs HTTPS (or localhost).');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    await video.play();

    rules = rules || (await loadRules());
    const modelKey = settings.modelKey || rules.detection.model;
    if (!detector || detector.modelKey !== modelKey) {
      ui.reason.textContent = 'Loading detector…';
      if (detector) detector.det.close();
      detector = { ...(await createDetector(rules, modelKey)), modelKey };
    }

    sm = new StateMachine(rules);
    framesSinceStart = 0;
    inferMsAvg = 0;
    meter = new MotionMeter(rules.motion.gridWidth, rules.motion.pixelDiffThreshold, rules.motion.maxShift);
    frames = [];
    smoothBox = null;
    csvRows = [];
    lastLoggedSecond = -1;
    sessionStart = performance.now() / 1000;
    sessionStartIso = new Date().toISOString();
    running = true;
    await requestWakeLock();

    ui.startOverlay.classList.add('hidden');
    ui.stop.disabled = false;
    ui.calib.disabled = false;
    ui.csv.disabled = false;
    ui.reason.textContent = 'Looking for the dog…';
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    ui.state.textContent = 'Error';
    ui.state.className = 'state state-unclear';
    ui.reason.textContent = e.name === 'NotAllowedError'
      ? 'Camera permission denied. Allow camera access in Safari settings and reload.'
      : `Couldn't start: ${e.message || e}`;
    stopStream();
    ui.start.disabled = false;
  }
}

// Stop camera tracks and release the wake lock.
function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  try { wakeLock?.release(); } catch (e) { /* already released */ }
  wakeLock = null;
}

// Stop button: halt processing but keep the CSV available to download.
function stop() {
  running = false;
  calib = null;
  stopStream();
  octx.clearRect(0, 0, overlay.width, overlay.height);
  ui.startOverlay.classList.remove('hidden');
  ui.start.disabled = false;
  ui.stop.disabled = true;
  ui.calib.disabled = true;
  ui.state.textContent = 'Stopped';
  ui.state.className = 'state state-unclear';
  ui.reason.textContent = csvRows.length ? `Session: ${csvRows.length} s logged. Tap CSV to save it.` : 'Tap Start to begin.';
  ui.conf.style.width = '0%';
}

// ---------- Main loop ----------

// requestAnimationFrame loop, throttled to rules.detection.inferenceFps.
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  const nowMs = performance.now();
  if (nowMs - lastProcessT < 1000 / rules.detection.inferenceFps - 2) return;
  if (switching || video.readyState < 2 || !video.videoWidth) return;
  lastProcessT = nowMs;
  try {
    processFrame(nowMs);
  } catch (e) {
    console.error('frame processing failed', e);
  }
}

// One processing step: detect, measure motion, update features, rules and UI.
function processFrame(nowMs) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const t = nowMs / 1000;

  // 1. Detection (the only ML step).
  const t0 = performance.now();
  // MediaPipe needs strictly increasing timestamps.
  lastInferMs = Math.max(nowMs, lastInferMs + 1);
  const result = detector.det.detectForVideo(video, lastInferMs);
  const inferMs = performance.now() - t0;
  inferMsAvg = inferMsAvg ? inferMsAvg * 0.9 + inferMs * 0.1 : inferMs;
  framesSinceStart++;
  maybeFallBackToCpu();

  const pick = pickDog(result.detections || [], rules, smoothBox);
  if (pick) {
    // Light smoothing of the box so jitter doesn't look like movement; jump if it's a different place.
    const a = rules.detection.boxSmoothing;
    const b = pick.box;
    const overlap = smoothBox && Math.abs(b.x - smoothBox.x) < b.w && Math.abs(b.y - smoothBox.y) < b.h;
    smoothBox = overlap
      ? { x: smoothBox.x + a * (b.x - smoothBox.x), y: smoothBox.y + a * (b.y - smoothBox.y),
          w: smoothBox.w + a * (b.w - smoothBox.w), h: smoothBox.h + a * (b.h - smoothBox.h) }
      : { ...b };
  } else {
    smoothBox = null;
  }

  // 2. Motion inside vs outside the box (uses the raw detection box for coverage).
  const motion = meter.measure(video, vw, vh, pick ? pick.box : null);

  // 3. Record this frame.
  const box = smoothBox;
  frames.push({
    t,
    present: !!(pick && motion),
    score: pick ? pick.score : 0,
    label: pick ? pick.label : '',
    cx: box ? box.x + box.w / 2 : 0,
    cy: box ? box.y + box.h / 2 : 0,
    w: box ? box.w : 0,
    h: box ? box.h : 0,
    areaFrac: box ? (box.w * box.h) / (vw * vh) : 0,
    motionIn: motion ? motion.motionIn : 0,
    motionOut: motion ? motion.motionOut : 0,
  });
  const keepAfter = t - rules.windows.historySeconds;
  while (frames.length && frames[0].t < keepAfter) frames.shift();

  // 4. Calibration capture, if running.
  if (calib) {
    calib.frames.push(frames[frames.length - 1]);
    const left = Math.ceil(calib.until - t);
    if (left > 0) {
      showBanner(`Calibrating… ${left} s left. Keep ${settings.dogName || 'him'} relaxed and in view.`, 0);
    } else {
      finishCalibration();
    }
  }

  // 5. Features → rule scores → state machine (all deterministic).
  const { features, gate, info } = computeFeatures(frames, t, rules, baseline);
  const results = scoreStates(features, rules, settings.sensitivity);
  const out = sm.update(t, gate, results);
  last = { features, info, gate, results, out, pick, vw, vh };

  // 6. FPS bookkeeping.
  fpsTimes.push(nowMs);
  while (fpsTimes.length && fpsTimes[0] < nowMs - 1000) fpsTimes.shift();

  // 7. Draw and log.
  drawOverlay(vw, vh, pick, out);
  renderLabel(out);
  if (!ui.debug.hidden) renderDebug();
  logSecond(t);
}

// If the GPU delegate turns out slow on this device, swap to the CPU (WASM) delegate once.
async function maybeFallBackToCpu() {
  const D = rules.detection;
  if (detector.delegate !== 'GPU' || framesSinceStart !== D.gpuFallbackAfterFrames) return;
  if (new URLSearchParams(location.search).get('delegate')) return;
  if (inferMsAvg <= D.gpuFallbackMs) return;
  switching = true;
  const slowMs = inferMsAvg;
  try {
    const cpu = await createDetector(rules, detector.modelKey, ['CPU']);
    detector.det.close();
    detector = { ...cpu, modelKey: detector.modelKey };
    inferMsAvg = 0;
    showBanner(`GPU was slow (${Math.round(slowMs)} ms/frame), switched to CPU.`);
  } catch (e) {
    console.warn('CPU fallback failed, staying on GPU', e);
  } finally {
    switching = false;
  }
}

// ---------- Rendering ----------

// Draw the dog box, its label and the current state on the overlay canvas.
function drawOverlay(vw, vh, pick, out) {
  if (overlay.width !== vw || overlay.height !== vh) {
    overlay.width = vw;
    overlay.height = vh;
  }
  octx.clearRect(0, 0, vw, vh);
  if (!smoothBox) return;
  const colours = { resting: '#81c784', relaxed: '#4fc3f7', alert: '#ffb74d', active: '#f06292', unclear: '#9e9e9e' };
  const c = colours[out.state] || '#fff';
  const lw = Math.max(2, Math.round(vw / 300));
  octx.lineWidth = lw;
  octx.strokeStyle = c;
  octx.strokeRect(smoothBox.x, smoothBox.y, smoothBox.w, smoothBox.h);
  // Centre dot.
  octx.fillStyle = c;
  octx.beginPath();
  octx.arc(smoothBox.x + smoothBox.w / 2, smoothBox.y + smoothBox.h / 2, lw * 2, 0, Math.PI * 2);
  octx.fill();
  // Tag above the box.
  const fs = Math.max(14, Math.round(vw / 40));
  octx.font = `600 ${fs}px sans-serif`;
  const tag = `${pick ? pick.label : ''} ${pick ? Math.round(pick.score * 100) + '%' : ''}`.trim();
  const tw = octx.measureText(tag).width + 10;
  const ty = Math.max(0, smoothBox.y - fs - 6);
  octx.fillStyle = 'rgba(0,0,0,0.6)';
  octx.fillRect(smoothBox.x, ty, tw, fs + 6);
  octx.fillStyle = c;
  octx.fillText(tag, smoothBox.x + 5, ty + fs);
}

// Update the label card (state, reason line, confidence bar).
function renderLabel(out) {
  ui.state.textContent = out.label;
  ui.state.className = `state state-${out.state}`;
  ui.reason.textContent = out.reasons.join('; ');
  ui.conf.style.width = `${Math.round(out.confidence * 100)}%`;
}

// Fill the debug panel with raw signal values, fps and scores.
function renderDebug() {
  if (!last) return;
  const { features: f, info, gate, results, out, pick, vw, vh } = last;
  const fps = fpsTimes.length;
  const lines = [
    `fps ${fps}  infer ${fmt(inferMsAvg, 1)} ms  ${detector.delegate}/${detector.modelKey}  ${vw}x${vh}`,
    `det ${pick ? pick.label : 'none'} ${fmt(pick?.score)}  area ${fmt(info.areaFrac * 100, 1)}%  present ${fmt(info.presenceFrac)}`,
    `shake ${fmt(meter.lastShift, 1)}px  camMotion ${fmt(info.cameraMotion, 3)}  netMotion ${fmt(info.motionNet, 3)}  base ${fmt(info.baseMotion, 3)}`,
    `motionRel ${fmt(f.motionRel)}  now ${fmt(f.motionNowRel)}  prev ${fmt(f.motionPrevRel)}  freeze ${fmt(f.freeze)}`,
    `speed ${fmt(f.speed)} bl/s  aspect ${fmt(f.aspect)}  aspectVar ${fmt(f.aspectVar, 3)}  heightChg ${fmt(f.heightChange)}`,
    `gate ${gate || 'ok'}`,
    'scores (raw / smoothed / evidence):',
    ...Object.entries(results).map(([k, r]) =>
      `  ${k.padEnd(8)} ${fmt(r.score)} / ${fmt(out.smoothed?.[k])} / ${fmt(r.evidence)}`),
    `state ${out.state}  leader ${out.candidate}  pending ${out.pending || '–'}`,
    `sensitivity ${settings.sensitivity}  baseline ${baseline ? 'yes' : 'defaults'}`,
  ];
  ui.debug.textContent = lines.join('\n');
}

// ---------- Per-second CSV log ----------

const FEATURE_KEYS = ['motionRel', 'motionNowRel', 'motionPrevRel', 'freeze', 'speed', 'aspect', 'aspectVar', 'heightChange'];

// Append one row per elapsed whole second (snapshot of the latest step).
function logSecond(t) {
  const sec = Math.floor(t - sessionStart);
  if (sec === lastLoggedSecond || !last) return;
  lastLoggedSecond = sec;
  const { features: f, info, gate, results, out, pick } = last;
  const row = {
    timestamp: new Date().toISOString(),
    elapsed_s: sec,
    state: out.state,
    confidence: out.confidence.toFixed(3),
  };
  for (const k of Object.keys(rules.states)) row[`score_${k}`] = results[k].score === null ? '' : results[k].score.toFixed(3);
  for (const k of Object.keys(rules.states)) row[`smoothed_${k}`] = out.smoothed?.[k] == null ? '' : out.smoothed[k].toFixed(3);
  for (const k of FEATURE_KEYS) row[k] = f[k] === null ? '' : f[k].toFixed(4);
  for (const k of FEATURE_KEYS) row[`used_${k}`] = f[k] === null ? 0 : 1;
  row.det_label = pick ? pick.label : '';
  row.det_score = info.detScore === null ? '' : info.detScore.toFixed(3);
  row.area_frac = info.areaFrac === null ? '' : info.areaFrac.toFixed(4);
  row.presence_frac = info.presenceFrac.toFixed(3);
  row.camera_motion = info.cameraMotion === null ? '' : info.cameraMotion.toFixed(4);
  row.net_motion = info.motionNet === null ? '' : info.motionNet.toFixed(4);
  row.gate = gate || '';
  row.reasons = out.reasons.join(' | ');
  row.fps = fpsTimes.length;
  row.calibrating = calib ? 1 : 0;
  csvRows.push(row);
}

// Quote a CSV cell if it contains a comma, quote or newline.
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Save the session's per-second log as a CSV file.
async function downloadCsv() {
  if (!csvRows.length) {
    showBanner('Nothing logged yet.');
    return;
  }
  const cols = Object.keys(csvRows[0]);
  const text = [cols.join(','), ...csvRows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
  const stamp = (sessionStartIso || new Date().toISOString()).replace(/[:.]/g, '-');
  await saveFile(`staffie-sense-${stamp}.csv`, text, 'text/csv');
}

// ---------- Calibration ----------

// Begin a guided relaxed-baseline capture.
function startCalibration() {
  if (!running) return;
  calib = { until: performance.now() / 1000 + rules.calibration.seconds, frames: [] };
  ui.calib.classList.add('on');
}

// Finish capture, compute and store the baseline (or explain why not).
function finishCalibration() {
  const res = computeBaseline(calib.frames, rules);
  calib = null;
  ui.calib.classList.remove('on');
  if (!res.ok) {
    showBanner(`Calibration failed: ${res.reason}.`, 6000);
    return;
  }
  baseline = { ...res.baseline, dogName: settings.dogName };
  save('baseline', baseline);
  renderBaselineInfo();
  showBanner(`Baseline saved (movement ${fmt(baseline.motion, 3)}, shape ${fmt(baseline.aspect)}).`, 5000);
}

// ---------- Settings & info ----------

// Copy stored settings into the settings form.
function fillSettingsForm() {
  ui.dogName.value = settings.dogName;
  ui.sensitivity.value = settings.sensitivity;
  ui.modelKey.value = settings.modelKey || 'lite0';
  renderBaselineInfo();
}

ui.dogName.addEventListener('change', () => { settings.dogName = ui.dogName.value.trim(); save('dogName', settings.dogName); renderBaselineInfo(); });
ui.sensitivity.addEventListener('change', () => { settings.sensitivity = ui.sensitivity.value; save('sensitivity', settings.sensitivity); });
ui.modelKey.addEventListener('change', () => {
  settings.modelKey = ui.modelKey.value;
  save('modelKey', settings.modelKey);
  showBanner('Detector change applies next time you tap Start.');
});

// Export the baseline as a JSON file so it can't be lost.
ui.exportBtn.addEventListener('click', () => {
  if (!baseline) { showBanner('No baseline to export yet.'); return; }
  saveFile(`staffie-sense-baseline-${(settings.dogName || 'dog').replace(/\W+/g, '_')}.json`,
    JSON.stringify(baseline, null, 2), 'application/json');
});

// Import a previously exported baseline JSON file.
ui.importFile.addEventListener('change', async () => {
  const file = ui.importFile.files[0];
  ui.importFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (typeof data.motion !== 'number' || typeof data.aspect !== 'number') throw new Error('not a baseline file');
    baseline = data;
    save('baseline', baseline);
    renderBaselineInfo();
    showBanner('Baseline imported.');
  } catch (e) {
    showBanner(`Import failed: ${e.message}`);
  }
});

// Delete the stored baseline.
ui.clearBtn.addEventListener('click', () => {
  baseline = null;
  remove('baseline');
  renderBaselineInfo();
});

// Toggle the debug panel.
ui.debugBtn.addEventListener('click', () => {
  ui.debug.hidden = !ui.debug.hidden;
  ui.debugBtn.classList.toggle('on', !ui.debug.hidden);
  if (!ui.debug.hidden) renderDebug();
});

ui.start.addEventListener('click', start);
ui.stop.addEventListener('click', stop);
ui.calib.addEventListener('click', startCalibration);
ui.csv.addEventListener('click', downloadCsv);
ui.settings.addEventListener('click', () => { fillSettingsForm(); ui.settingsDialog.showModal(); });
ui.info.addEventListener('click', () => ui.infoDialog.showModal());
ui.infoDialog.addEventListener('close', () => save('seenInfo', true));

// First run: show the honesty screen once.
renderBaselineInfo();
if (!load('seenInfo', false)) ui.infoDialog.showModal();
// Expose a tiny read-only hook for the automated browser test.
window.__staffie = { get last() { return last; }, get fps() { return fpsTimes.length; }, get delegate() { return detector?.delegate; } };
