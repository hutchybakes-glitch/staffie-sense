# CLAUDE.md — Staffie body-language reader

Standing instructions for this project. Read this fully before doing anything. Re-read the **Hard constraints** whenever you're about to add a dependency, a service, or a network call.

## What we're building

An iPhone web app. Sam opens it in Safari, taps Start, points the rear camera at his Staffordshire Bull Terrier, and gets a live, **deterministic** read of the dog's visible body language. Example labels are *resting*, *relaxed*, *alert*, *excited / playful*, *possible stress signals* or *unclear*. Each label comes with a plain-English reason. The app also has a **recording mode** that saves the video with the overlay, plus a per-second CSV of what the app saw.

Working name: **staffie-sense**. You can keep it, or rename it if you have a better idea and log why.

## Hard constraints (non-negotiable)

1. **£0, no sign-ups.**
   - No paid services, paid tiers, API keys, free trials or new accounts of any kind.
   - The only accounts in play are ones Sam already has: his GitHub account **hutchybakes** and his Claude subscription.
   - That rules out Netlify, Vercel, Firebase, Roboflow, Ultralytics HUB, Google Colab, Kaggle, cloud GPUs, Hugging Face login or gated models, analytics, and error-tracking SaaS.
   - Free installs that need no login are fine: pip, npm, winget, GitHub releases, and public ungated Hugging Face files.
2. **Everything runs on the phone.**
   - No backend, no uploads, no telemetry, and no calls to any AI or LLM API at runtime.
   - After the first load, the app fetches only its own static files and keeps working offline.
   - Self-host (vendor) the runtime libraries and model files in the repo instead of loading them from a CDN.
3. **Deterministic interpretation.**
   - Machine learning is allowed for **perception only**: finding the dog and its keypoints.
   - Everything from keypoints to label is explicit, readable rules driven by a config file. No ML or LLM mood classifier.
   - The same keypoint sequence in gives the same output out, every time. No randomness.
4. **Hosting is GitHub Pages on hutchybakes.** The repo is therefore public, and the build output is static files.
5. **Privacy.**
   - Never commit Sam's dog videos, labelled clips, calibration data, or anything the app records.
   - Keep those in gitignored folders such as `clips/` and `private/`.
   - Calibration data lives on the device.
6. **Licences.**
   - Record the licence of every model, dataset and library in `LICENSES.md`.
   - AGPL-3.0 is acceptable because the repo is public anyway. If you use AGPL code or weights, include the licence file.
   - Avoid weights licensed for academic or non-commercial use only, unless there is genuinely no alternative. If you do use them, flag it prominently.

## Sam's setup

- **Laptop:** Windows, 8 GB RAM, Intel integrated graphics, **no NVIDIA GPU**.
  - Any model training is CPU-only: small image sizes, small batches, few dataloader workers, and a time limit.
  - It's fine to run training overnight in the background.
  - Don't run heavy training and heavy browser tests at the same time.
- **Git:** Sam has git and has pushed to GitHub from this machine before. Check `gh auth status` and the git remotes before assuming a push will work.
- **Phone:** an iPhone with current iOS Safari. Sam tests on the real phone via the GitHub Pages URL.
- **Local testing:** `localhost` on the laptop counts as a secure context, so the laptop webcam works for quick local tests.

## Working with Sam

- He's a data analyst (Python, SQL, Power BI), not a front-end developer. He's practical, learns by doing, and trusts results tested in real conditions more than synthetic demos.
- **Python and SQL: write one plain-English comment line directly above every single line of code.** This is his preferred teaching style. It applies to every script, including the harness and training scripts.
- **JavaScript, HTML and CSS:** comment each function and any non-obvious logic.
- **Work autonomously.**
  - Don't stop to ask questions. Make the best decision and keep going.
  - Record each decision in `notes/DECISIONS.md`: date, decision, why, and alternatives rejected.
  - The only things that go to Sam are tasks he physically has to do. List those in `notes/HUMAN_TODO.md`.

## Product requirements

### Live mode

- **Camera start:** a Start button, because iOS needs a user gesture before it allows the camera.
  - Use the rear camera (`facingMode: environment`).
  - Use `<video playsinline muted>`.
- **Overlay:** keypoints and skeleton, the current state, and a confidence indicator.
- **"Why" line:** the top 2–3 signals behind the label, in plain English. Examples: "tail higher than his relaxed baseline", "head lower than shoulders, very little movement".
- **`unclear` is a first-class output.** Use it when there's no dog, the dog is too small in frame, keypoint confidence is low, or too few signals are visible. Never force a label.
- **Screen and performance:**
  - Keep the screen awake while running, using the Wake Lock API where available.
  - Throttle inference to a rate that keeps the phone cool and the label responsive. Aim for roughly 8–12 fps, and measure it.
  - Handle both portrait and landscape.

### Calibration

- **Baseline capture:** a guided capture of 30–60 seconds while the dog is clearly relaxed.
  - Store per-feature baseline stats (for example, median and spread) on the device.
  - Wrap all storage access in try/catch.
  - Offer export and import of the baseline as a JSON file so it can't be lost.
- **Readings are relative to the baseline.** A Staffie's normal ear and tail carriage differs from generic dog guidance (see Research expectations).
- **Settings:** dog name, sensitivity, recalibrate.

### Recording mode

- **Video:** record with the overlay burned in where supported, using canvas `captureStream` plus `MediaRecorder`. Feature-detect the MIME type Safari supports.
  - Fallback: record the raw camera feed and save the CSV separately.
- **Per-second CSV columns:**
  - timestamp
  - state
  - score for each state
  - each feature's value
  - keypoint confidence
  - whether each feature was used
- **Session summary:** time spent in each state and a simple timeline strip.
- **Saving:** save or share files via download or the iOS share sheet.

### Honesty in the UI

- Show a short first-run screen and an info page that's always reachable. Both should say:
  - The app reads *visible body-language signals*, not emotions, and context matters.
  - It is not a safety or behaviour-assessment tool and shouldn't be used to decide whether the dog is safe in a situation.

## Architecture principles (you choose the details)

Pipeline: camera → dog detection → keypoints → features → smoothing → rule scoring → state machine with hysteresis → UI / recorder.

### Perception model

- It needs dog keypoints, ideally including **ear and tail points**, because those are the most informative signals.
- A known free route:
  - The Ultralytics Dog-Pose dataset has 24 keypoints per dog, including ears, tail and paws. It auto-downloads (~337 MB) from a GitHub release with no login.
  - Train a small YOLO pose model on it, export to ONNX, and run it with onnxruntime-web.
  - Verify the keypoint list yourself.
- Many generic 17-point animal models (AP-10K style) have only a tail-root point and no ear points. They're usable for posture and movement, but not for ears and tail.
- Before training anything, search for an existing free, ungated dog-keypoint checkpoint.
- If you use Ultralytics, turn off its telemetry (`yolo settings sync=False`).

### Size and speed

- Keep the model small enough to load quickly on mobile data. Aim for under ~25 MB, and quantise if accuracy holds.
- Prefer the WebGPU backend where Safari supports it, and fall back to WASM.

### Hosting constraint

GitHub Pages can't set custom headers. Multi-threaded WASM needs cross-origin isolation, so it won't work out of the box. Two options:

- run single-threaded WASM or WebGPU, or
- use `coi-serviceworker` to provide the isolation.

Measure both and decide.

### Rules and features

- **One source of truth for rules.**
  - All thresholds, weights, window lengths and hysteresis settings live in `rules.json`.
  - Both the web app and the Python harness read that same file.
- **One source of truth for features.**
  - Write feature definitions once, in `FEATURES.md`.
  - Implement them in both JS and Python.
  - Add a **parity test** proving both give the same values on fixture keypoints.
- **Scale-invariant features.**
  - Normalise distances by body size, e.g. withers-to-tail-root length, so distance from the camera doesn't change the reading.
  - Express features relative to the calibration baseline.
- **Visibility gating.**
  - Each feature declares which keypoints it needs and a minimum confidence.
  - If those keypoints aren't visible, the feature drops out and the remaining weights renormalise.
  - Below a minimum level of evidence, the state is `unclear`.
- **Stability.** Smooth over a rolling window (~2–3 seconds). A new state must lead for a minimum dwell time before the label switches, so it doesn't flicker.
- **Explainability.** Every label must be traceable to the features and rules that produced it.

## Research expectations

Write `RESEARCH.md` before finalising the features. For each body-language signal, cover:

- what it typically indicates
- how strong the evidence is
- context caveats
- any Staffie-specific adjustment
- whether a phone camera can realistically measure it, and how

**Sources:** use reputable ones:

- UK welfare charities: Dogs Trust, RSPCA, Blue Cross, PDSA
- The Kennel Club breed standard
- peer-reviewed work, e.g. DogFACS and canine communication or stress-signal studies

Link every source. Paraphrase; don't copy text.

**Staffie-specific points to verify and build in:**

- Rose or half-pricked ears with a small movement range, so subtle changes matter.
- A low-set tail that's naturally carried low, so a low tail doesn't automatically mean anxiety.
- A wide, open-mouthed "smile" when relaxed.
- A whole-body wiggle when happy.
- A muscular build that hides tension.
- Brindle or dark coats, which can make keypoints less reliable.

**Limits:** be explicit about what a phone camera can't reach at normal distance, such as whale eye, lip licking and subtle facial tension. Design the rules so missing signals lower confidence instead of producing wrong labels.

## Testing

- **Unit tests** for feature extraction, rules, smoothing and the state machine, using fixture keypoint sequences.
- **JS↔Python feature parity test.**
- **Browser test** with Playwright (Chromium) and a fake camera fed from a video file.
  - Flags: `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=...`, with the video converted using ffmpeg.
  - Check that the app loads, the camera starts, the model runs, a state appears, and there are no console errors.
  - Log fps.
- **Development test media:** openly licensed dog videos (e.g. Wikimedia Commons) and Dog-Pose test images. Keep downloaded media out of the repo unless the licence allows it and the files are small.
- **Evaluation harness** (`harness/`, Python):
  - Runs the same model, features and `rules.json` over the videos in `clips/`.
  - Uses Sam's labels from `labels.csv` (columns: file, start_s, end_s, label).
  - Outputs per-second predictions, a confusion matrix, per-state precision and recall, and a threshold-tuning report.
  - Changes to `rules.json` from tuning are made deliberately and committed with the evaluation numbers in the commit message. Never auto-fit them silently.
- **Real-iPhone testing** is Sam's job. Put the checklist in `notes/HUMAN_TODO.md`.

## Housekeeping

- Use a Python virtual environment. Pin versions with `requirements.txt` and an npm lockfile.
- Commit after each working milestone with clear messages. Push to hutchybakes once auth works.
- Keep `README.md` current. It should cover:
  - what the app is and the live URL
  - how to calibrate and how to record
  - how to film and label clips for tuning
  - how to run the harness
- Time-box dead ends. If an approach is stuck after a sensible effort, log it in `notes/DECISIONS.md` and switch to the fallback.
