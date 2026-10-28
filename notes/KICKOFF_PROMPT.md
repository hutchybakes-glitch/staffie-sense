Build the Staffie body-language reader described in `CLAUDE.md`, end to end, working autonomously. Read `CLAUDE.md` in full first. Its hard constraints override anything below.

You have full freedom over the stack, model, file structure and implementation, as long as you stay inside these constraints:

- £0 and no sign-ups
- everything runs on the device
- deterministic rules
- hosted on GitHub Pages under hutchybakes

Where this prompt suggests an approach, treat it as a starting point, not an instruction. If you find something better, use it and log why in `DECISIONS.md`.

**How to work:**

- Don't stop to ask me questions, and don't pause between phases for approval. Decide, log the decision, continue.
- If something needs me physically, add it to `HUMAN_TODO.md` and keep going with everything else. Examples: filming the dog, testing on the iPhone, a GitHub setting the CLI can't change.
- While a long job runs (e.g. model training), work on other phases in parallel. Keep an eye on RAM, since the laptop only has 8 GB.

---

## Phase 0: Recon and plan

- **Check the environment:** OS, Python, Node, git, `gh auth status`, ffmpeg, disk space and free RAM. Install any missing free tools via winget, pip or npm.
- **Set up the repo:**
  - If `gh` is authenticated, create `hutchybakes/<name>` with it. Otherwise, init locally and add "create the repo" to `HUMAN_TODO.md`.
  - Add a `.gitignore` covering `clips/`, `private/`, datasets, the venv and training runs.
  - Create `DECISIONS.md`, `HUMAN_TODO.md` and `LICENSES.md`.
- **Write `PLAN.md`** covering:
  - your chosen approach for each phase
  - the fallback for each risky step
  - how you'll know each phase is done

## Phase 1: Research

- Produce `RESEARCH.md` as specified in `CLAUDE.md`.
- From it, produce `FEATURES.md`. For each feature, give:
  - its definition
  - the keypoints it needs
  - its normalisation
  - its confidence gate
  - what it suggests
- Produce a first `rules.json` with v0 thresholds and weights grounded in the research. Mark it clearly as untuned.
- Define the state set. Start from resting, relaxed, alert, excited-playful, possible stress signals and unclear. If the research says otherwise, change it and log why.

## Phase 2: Perception model

**Goal:** an ONNX dog-keypoint model that runs in iPhone Safari at a usable rate, ideally with ear and tail points.

**Fallback ladder:**

1. Use an existing free, ungated dog-keypoint checkpoint that you can export to ONNX.
2. If none exists, train a small YOLO pose model on the Ultralytics Dog-Pose dataset on CPU.
   - Use a small image size, a small batch and ≤2 workers.
   - Run it in the background with a time limit. Overnight is fine.
   - While it trains, build Phases 3–5 against a stand-in model so nothing waits on it.
3. If nothing workable gives ear and tail points, ship v1 on posture and movement features only (resting / relaxed / alert / active / unclear).
   - Say so clearly in the UI and the README.
   - Leave the ear/tail upgrade as a documented next step.

**Done when:**

- the model is exported and its keypoint order is documented
- its accuracy is reported on the dataset's test split
- its inference time is measured in Chromium, for WASM and for WebGPU if available
- a Python script draws its keypoints on sample images, so I can see it working

## Phase 3: Web app shell

- Build the camera view, the overlay canvas, in-browser model inference and an fps counter.
- Handle the iPhone specifics:
  - start on a user gesture
  - `playsinline`
  - rear camera
  - wake lock
  - orientation changes
  - inference throttling
- Self-host the model and runtime files.
- Decide between WebGPU and WASM, and pick a cross-origin-isolation approach for GitHub Pages. Log both decisions.
- **Done when:** the Playwright fake-camera test passes.

## Phase 4: Interpretation engine

- Build feature extraction, smoothing, rule scoring, the state machine with hysteresis, visibility gating and the plain-English "why" explanations. All of it is driven by `rules.json`.
- Build the calibration flow, with on-device storage plus JSON export and import.
- **Done when:** the unit tests and the JS↔Python parity test pass.

## Phase 5: Recording mode

- Record video with the overlay burned in, using feature detection, plus the fallback path.
- Write the per-second CSV.
- Show a session summary with time in each state and a timeline strip.
- Save and share files on iOS.

## Phase 6: Evaluation harness and filming guide

- Build `harness/` as specified in `CLAUDE.md`. It runs on `clips/` plus `labels.csv` and outputs:
  - per-second predictions
  - a confusion matrix
  - per-state precision and recall
  - a tuning report
- Run it end to end on openly licensed sample dog footage, so the harness is proven before my clips exist.
- Add a filming guide to `HUMAN_TODO.md` and the README covering:
  - which states to capture
  - how many clips, and how long each should be
  - angles (side-on is best for tail and posture)
  - distance and lighting
  - how to fill in `labels.csv`

## Phase 7: Polish

- Support Add to Home Screen: a manifest plus a simple original icon, with no copyrighted or branded imagery.
- Cache the app for offline use with a service worker.
- Add the first-run disclaimer and the info page.
- Add settings: dog name, sensitivity, recalibrate.
- Make the UI clean and mobile-first, with dark mode.

## Phase 8: Deploy and verify

- Deploy to GitHub Pages using Actions or a branch. Your call; both are free for public repos.
- Enable Pages via `gh api` if you can. If not, add it to `HUMAN_TODO.md`.
- Confirm the live URL serves the app and the model loads:
  - fetch the page and the model file
  - if feasible, run the Playwright test against the live URL
- Finish the README.

---

## When you finish

Write `REPORT.md` and print a short summary covering:

1. The live URL.
2. What works, what was cut, and why.
3. Measured fps and model accuracy.
4. The exact next steps for me, in order, taken from `HUMAN_TODO.md`. Start with calibrating on my dog and filming clips for tuning.
5. What the harness will tell us once my labelled clips are in, and how to apply tuning changes to `rules.json`.
