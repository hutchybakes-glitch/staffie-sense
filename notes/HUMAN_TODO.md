# Things only Sam can do

## Today: get it on the iPhone (about 5 minutes)

1. **Create the empty repo.** Go to <https://github.com/new>, signed in as **hutchybakes-glitch**.
   - Repository name: `staffie-sense`
   - Visibility: **Public**
   - Don't tick README, .gitignore or licence. The repo must be empty.
   - Click **Create repository**.
2. **Push.** In this folder, run:
   ```
   git push -u origin main
   ```
   - The remote is already set to `https://github.com/hutchybakes-glitch/staffie-sense.git`.
   - If a browser sign-in pops up, approve it.
3. **Turn on Pages.**
   - In the repo, go to **Settings → Pages**.
   - Under **Build and deployment → Source**, choose **Deploy from a branch**.
   - Set the branch to `main` and the folder to `/docs`, then click **Save**.
   - Wait 1–2 minutes.
4. **Open the live URL in iPhone Safari:** <https://hutchybakes-glitch.github.io/staffie-sense/>

## Optional: try it on the laptop webcam first

- Run `npm install`, then `npm run serve`.
- Open <http://localhost:8080> in Chrome or Edge.
- I tested it headless with a fake camera, but not with your real webcam or dog.

## Real-iPhone checklist (please note the results)

- [ ] Page loads. The first-run info screen shows. Tapping **Start** asks for the camera, and the **rear** camera opens.
- [ ] A box appears around him, labelled "dog" (or a look-alike such as "cat" or "bear"; that's fine).
- [ ] Tap **Debug**. Note the `fps` and `infer` ms, and whether it says `GPU` or `CPU`. If it switched to CPU, a banner will have said so.
- [ ] **Calibrate:**
  - Prop the phone up, side-on to him, with his whole body in frame and some floor or wall visible around him.
  - Wait until he's settled and relaxed, then tap **Calibrate** and keep still for 15 seconds.
  - The badge should turn to "calibrated".
- [ ] Watch for **Resting** (lying and still), **Relaxed** (pottering, normal), **Alert** (head pops up or he suddenly freezes) and **Active / excited** (zoomies, play, wiggling). Does the label match what you see? Does it flicker?
- [ ] Rotate the phone to landscape. The overlay should still line up with him.
- [ ] The screen stays awake while it's running.
- [ ] Tap **CSV** after a few minutes. Does the iOS share sheet or a download appear, and does the file open in Numbers or Excel?
- [ ] **Settings:** try **Accurate (Lite2)** if detection drops out a lot on his coat. It takes effect after Stop and Start.
- [ ] **Settings → Export baseline**, so you have a copy.
- [ ] Note anything that reads wrong, with the time, so the rules can be tuned. The CSV has the raw numbers.

## Later

- Film and label a few clips of him (into `clips/`, which is gitignored) for the evaluation harness in the full build.
