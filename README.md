# staffie-sense (proof of concept)

An iPhone web app. You point the rear camera at your Staffie and get a live, **deterministic** read of visible movement and posture signals: **Resting**, **Relaxed**, **Alert**, **Active / excited**, or **Unclear**. Each comes with a one-line reason.

**Live URL:** <https://swhutchinson.github.io/staffie-sense/>. Open it in Safari on an iPhone and allow the camera.

It reads body-language *signals*, not emotions. It's not a safety or behaviour-assessment tool.

## How it works

The pipeline: camera → MediaPipe EfficientDet-Lite object detector (the only ML: it finds the "dog" box) → frame-difference motion inside the box, with shake compensation → windowed features → rules in `docs/rules.json` → score smoothing and hysteresis → label, reason and confidence bar.

- Everything runs on the phone. There's no backend and no uploads.
- All runtime files are self-hosted in `docs/`.
- What it can and can't read is in [notes/SIGNALS.md](notes/SIGNALS.md). The choices behind it are in [notes/DECISIONS.md](notes/DECISIONS.md).

## Using it

1. Tap **Start** and allow the camera.
2. Prop the phone up side-on to the dog, with his whole body in frame and some background around him. A handheld phone means "camera moving", which reads as unclear.
3. **Calibrate:** when he's relaxed, tap **Calibrate** and keep still for 15 seconds. Readings are relative to this baseline, which is stored on the phone. Recalibrate on each phone you use.
4. **Debug** shows the raw numbers: fps, inference time, detection, movement ratios, box shape and per-state scores.
5. **CSV** saves a per-second log of the session: state, scores, every feature, whether it was usable, and detection confidence.
6. **Settings:** dog name, sensitivity, detector (Fast/Lite0 or Accurate/Lite2), and export, import or clear the baseline.

## Tuning

Every threshold, weight, window and hysteresis setting is in `docs/rules.json`. Change it there and nowhere else.

## Development

```
npm install
npm test                 # unit tests (features, rules, state machine, calibration)
npm run serve            # http://localhost:8080 (the laptop webcam works on localhost)
npm run e2e -- private/testmedia/test.mjpeg 50   # headless Chromium with a fake camera
```

- `tests/e2e.mjs` takes a few environment variables:
  - `QUERY=?delegate=cpu` forces the CPU delegate.
  - `CALIBRATE=1` presses Calibrate at 2 seconds.
- To make a fake-camera file:
  ```
  ffmpeg -i clip.mp4 -vf scale=640:-2,fps=25 -q:v 5 -f mjpeg out.mjpeg
  ```
- Test media and anything recorded go in `private/` or `clips/`. Both are gitignored, so never commit them.
