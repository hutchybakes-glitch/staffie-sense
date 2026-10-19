# Decisions

Format: date, decision, why, alternatives rejected.

## 2026-10-19: Proof-of-concept day

**1. Build a one-day proof of concept, not the full KICKOFF_PROMPT build.**
*Why:* Sam's brief for today is "can the phone camera read live movement at all", within about 3 hours, openable on the iPhone today.
*Rejected:* the full harness, parity tests and recorder. Deferred, not dropped.

**2. Perception: MediaPipe EfficientDet-Lite0 "dog" box plus frame-difference motion. No keypoints yet.**
*Why:* I time-boxed the search for a ready-made, in-browser dog keypoint model to about 20 minutes. Nothing usable today turned up:
- `emgs/dogs-pose-recognition` (HF, AFL-3.0) looked promising. Inspected without unpickling, it's a YOLOv5 *detector* with three posture classes, not keypoints. It was trained on an unknown Roboflow set, and loading it would mean running an untrusted pickle.
- `20-team-daeng-ddang-ai/dog-pose-estimation` (HF) has no licence, so it's all rights reserved.
- `litert-community/RTMPose-Animal-AP10K-LiteRT` (Apache-2.0, 27 MB fp16 TFLite) is the best candidate for next time. It gives 17 AP-10K points (eyes, nose, neck, tail root, legs), but no ear points and no tail tip. It needs a separate detector crop and a generic TFLite runtime in Safari, which is more than a 3-hour job to make reliable.
- Ultralytics publishes the Dog-Pose dataset but no pretrained dog-pose checkpoint, and training was ruled out for today.

The fallback is exactly what the brief allowed. MediaPipe Tasks Vision runs in iOS Safari, is Apache-2.0, needs no build step, and its runtime and model files self-host.
*Rejected:* TF.js COCO-SSD (heavier and older); YOLOv8n ONNX (needs a torch install to export, and AGPL weights for no gain over EfficientDet for a box); DeepLabCut SuperAnimal (heavy HRNet, and licence unclear).

**3. Pin `@mediapipe/tasks-vision` 1.0.1, vendored into `docs/vendor/`.**
*Why:* it's the latest stable release more than two weeks old, and vendoring follows CLAUDE.md (no CDN). It ships `vision_wasm_internal` and the `nosimd` variant; the `module` variant isn't used.

**4. Ship Lite0 by default (7 MB), with Lite2 (12 MB) selectable in Settings.**
*Why:* Lite0 is the fast one. Lite2 may hold onto a dark brindle coat or a small dog better. Both are under the 25 MB budget.

**5. Accept look-alike labels when no "dog" is found.**
*Why:* COCO models often call a dark or brindle dog cat, bear, sheep, cow or horse; the headless test showed "horse" and "cat" on real dogs. "dog" is always preferred. The look-alike list lives in `rules.json`.
*Rejected:* dog-only, which made too many frames go unclear.

**6. Motion: on a 96-px-wide greyscale copy of each frame, measure the fraction of pixels that changed, inside the dog box versus outside it, after shake compensation.**
*Why:* it's cheap and deterministic. The "outside" fraction cancels lighting flicker. The shake step finds the ±3 px shift that best re-aligns the background, which handles small hand wobble.
*Limits:* rotation and zoom shake are not compensated. The value also depends on frame rate (fewer fps means more change per frame), so **calibrate on the phone you use**. A baseline made on the laptop won't transfer.

**7. Features:**
- `motionRel`, `motionNowRel`, `motionPrevRel`: movement as a ratio to the relaxed baseline.
- `freeze`: movement drop multiplied by "was moving".
- `speed`: body lengths per second.
- `aspect`: box width ÷ height.
- `aspectVar`: shape wobble.
- `heightChange`: sqrt of the height-to-width ratio now vs 2.5–6 s ago. It's scale-free, so walking towards the camera doesn't count.

*Why:* these are the only signals a box plus pixels can support honestly.

**8. Scoring: each state is a weighted mean of ramp or trapezoid memberships. Signals marked `required` multiply the score.**
*Why:* a pure weighted mean let a dog moving 4× his baseline score "resting", because his box was long and he wasn't travelling. The required multipliers make "resting needs low movement" explicit and readable. Missing features drop out and the weights renormalise. Too little evidence makes the state null.

**9. Stability: exponential score smoothing (1.5 s) plus hysteresis (the leader must beat the current state by 0.08 for 1.5 s).**
Hard gates (no dog, dog too small or too close, camera moving) switch to unclear after 1.0 s. Ordinary ambiguity uses the normal 1.5 s dwell, so a single twitch can't blank the label.

**10. Gates to `unclear`:**
- no dog
- dog detected in under 60% of the window
- box under 3% of the frame, or over 75% of it (too close to separate dog movement from camera movement)
- detection score under 0.35
- camera motion over 25%
- weak top score

*Why:* the headless test on a close-up sleeping-dog clip (box at 93% of the frame) read "active" purely from camera wobble. Saying "step back" is more honest.

**11. Delegate: try the GPU first. If it averages over 100 ms per frame after 5 frames, switch to CPU (WASM) once. `?delegate=cpu|gpu` forces one.**
*Why:* in headless Chromium the GPU delegate (software WebGL) ran at 1 fps while CPU ran at 6 fps. iPhone behaviour is unknown, so the app measures and decides on the device.

**12. Single-threaded WASM, no `coi-serviceworker`.**
*Why:* the MediaPipe vision WASM used here doesn't need SharedArrayBuffer, so there's no cross-origin isolation to work around.

**13. Target 10 fps inference (in `rules.json`).**
Measured: about 6 fps on the laptop CPU in headless Chromium, 180 ms per inference. A recent iPhone should do better, but that's unverified, so it's on Sam's checklist.

**14. Deploy from `/docs` on `main` with GitHub Pages, under `hutchybakes-glitch`.**
*Why:* GitHub has no user called `hutchybakes` (the public API returns 404). The credential stored on this laptop and Sam's existing repos (`gb-grid-live`, `pace-app`) belong to `hutchybakes-glitch`, so that's the account CLAUDE.md means. I couldn't create the repo or enable Pages from here: there's no `gh` CLI, and reading the stored token to call the API was, rightly, blocked. Sam does those two clicks (see HUMAN_TODO.md).

**15. No offline service worker today.**
*Why:* PWA polish is explicitly out of scope. The app still loads only its own files; nothing comes from a CDN.

**16. Keep the name `staffie-sense`.**
*Why:* it's clear, and there was no reason to churn it.

**17. Code licence: MIT for this repo's own code.**
*Why:* it's permissive and simple. Third-party licences are in LICENSES.md.
