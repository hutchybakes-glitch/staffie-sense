// Browser smoke test: serves docs/, opens it in headless Chromium with a fake camera
// fed from an MJPEG file, taps Start, and logs the state / fps once a second.
// Usage: node tests/e2e.mjs [path/to/video.mjpeg] [seconds]
// Convert a clip first:  ffmpeg -i in.mp4 -vf scale=640:-2,fps=25 -q:v 5 -f mjpeg out.mjpeg

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const video = resolve(process.argv[2] || 'private/testmedia/test.mjpeg');
const seconds = Number(process.argv[3] || 50);
const port = 8099;
const outDir = resolve('private/e2e');
mkdirSync(outDir, { recursive: true });

// Start a static server for docs/ (no caching so edits show up).
const server = spawn(process.execPath, ['node_modules/http-server/bin/http-server', 'docs', '-p', String(port), '-c-1', '-s'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
});
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/^(INFO|W\d{4}|I\d{4})/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${port}/${process.env.QUERY || ''}`);
  // Dismiss the first-run info dialog, then start.
  await page.click('#infoDialog button');
  await page.click('#startBtn');
  await page.click('#debugBtn');
  await page.waitForFunction(() => window.__staffie?.last, null, { timeout: 60000 });
  console.log('delegate:', await page.evaluate(() => window.__staffie.delegate));

  const tally = {};
  const fpsList = [];
  for (let s = 1; s <= seconds; s++) {
    await page.waitForTimeout(1000);
    // Optional: run a calibration starting at 2 s (CALIBRATE=1).
    if (process.env.CALIBRATE && s === 2) await page.click('#calibBtn');
    const snap = await page.evaluate(() => {
      const l = window.__staffie.last;
      const f = l.features;
      return {
        state: l.out.state, reasons: l.out.reasons.join('; '), fps: window.__staffie.fps,
        det: l.pick ? `${l.pick.label} ${l.pick.score.toFixed(2)}` : 'none',
        mr: f.motionRel?.toFixed(2), asp: f.aspect?.toFixed(2), spd: f.speed?.toFixed(2), gate: l.gate,
      };
    });
    tally[snap.state] = (tally[snap.state] || 0) + 1;
    fpsList.push(snap.fps);
    console.log(`${String(s).padStart(3)}s ${snap.state.padEnd(8)} fps ${snap.fps} det ${snap.det} mr ${snap.mr} asp ${snap.asp} spd ${snap.spd} | ${snap.reasons}`);
    if (s % 10 === 0) await page.screenshot({ path: `${outDir}/shot-${s}s.png` });
  }
  const fpsSorted = [...fpsList].sort((a, b) => a - b);
  console.log('state seconds:', JSON.stringify(tally));
  console.log('fps median:', fpsSorted[Math.floor(fpsSorted.length / 2)]);
  console.log('console errors:', errors.length ? errors : 'none');
  if (errors.length) failed = true;
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
