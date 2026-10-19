# Signals: what this version reads, and what it can't (yet)

This proof of concept sees two things: **a box around the dog** (from a pretrained COCO object detector) and **which pixels change between frames**. Everything below is derived from those two, using rules in `docs/rules.json`. It reads *visible movement and posture signals*, not emotions. As Dogs Trust stresses, signals need reading across the whole body and in context, and one signal on its own can mislead.

## Signals it reads

| Signal | How it's measured | What it's used for | Caveats |
|---|---|---|---|
| **Amount of movement** (`motionRel`) | Share of pixels inside the dog box that changed, minus whole-scene change, after shake compensation. Expressed as a ratio to his relaxed baseline. | Resting (well below baseline), relaxed (around baseline), active / excited (well above). | Depends on distance, lighting, fps and phone. That's why calibration matters. Panting and chewing count as movement. |
| **Lying vs upright** (`aspect`, box width ÷ height) | Shape of the box. Long and low (≥ 1.9) looks like lying side-on. Tall (≤ 1.0) looks like sitting or standing facing the camera. | Resting (low and long), alert (upright). | Camera angle matters a lot: a dog lying *facing* the camera gives a squarer box. Film side-on where possible. |
| **Rising up / head lift** (`heightChange`) | Box height-to-width ratio now vs 2.5–6 s ago. Scale-free, so walking towards the camera doesn't count. | Alert ("head or body raised compared with a moment ago"). | A head lift only shows if it changes the box outline. |
| **Sudden stillness** (`freeze`) | Movement in the last second compared with 1.5–4 s ago, scaled by how much he was moving before. | Alert ("suddenly went still after moving"). | A dog that just stops to lie down also "freezes". Context matters. |
| **Travel** (`speed`) | Box centre displacement in body lengths per second. | Active (moving around the room) vs settled. | Panning the phone looks like travel, so hold it still or prop it up. |
| **Shape wobble** (`aspectVar`) | Variation in box shape over 2 s. | Active: the whole-body wiggle, bouncing and turning typical of a happy Staffie. | Detector box jitter adds noise. |

`unclear` is a real output. It appears when there's no dog, the dog is too small, too close or not consistently detected, detection confidence is low, the camera is moving, or no state clearly matches.

## Signals it can't read yet, and why

| Signal | Why not | What would fix it |
|---|---|---|
| **Tail position and wag** | A box has no tail point. Staffies carry the tail low by breed standard ([Kennel Club](https://www.thekennelclub.org.uk/breed-standards/terrier/staffordshire-bull-terrier/)), so "low tail" must be read relative to *his* baseline, not generic advice. | A keypoint model with tail-base and tail-tip points (the Dog-Pose 24-point set has the tail). |
| **Ear carriage** | No ear points. Staffie rose or half-pricked ears move only a little, so subtle changes need precise points. | Dog-Pose keypoints (it includes ear base and ear tip). |
| **Head height relative to shoulders** | No head or withers points; the box only hints at it. | AP-10K (nose, eyes, neck) or Dog-Pose keypoints. |
| **Mouth: relaxed open "smile" vs closed and tense, panting, lip licking** | Too small at normal filming distance. | Close-up face model. Probably not realistic from across a room. |
| **Whale eye, eye shape, brow tension** | Far too small at phone distance. | Not realistic at room distance. Flagged as a permanent limit. |
| **Muscle tension, weight shift** | A muscular Staffie build hides tension, and it isn't visible in a box. | Partly via keypoint geometry (stance width, lean) later. |
| **Sound** (growling, whining) | The app doesn't use the microphone. | Out of scope. |

Dark or brindle coats lower detection confidence, which pushes the app towards `unclear` rather than a wrong label. The Lite2 detector in Settings may help.

## Sources

- Dogs Trust, *How to understand your dog's body language*: <https://www.dogstrust.org.uk/dog-advice/understanding-your-dog/body-language>. Covers reading the whole body and context, and that dark coats hide small movements.
- RSPCA, *Understanding your dog's behaviour*: <https://www.rspca.org.uk/adviceandwelfare/pets/dogs/behaviour/understanding>
- The Kennel Club, *Staffordshire Bull Terrier breed standard*: <https://www.thekennelclub.org.uk/breed-standards/terrier/staffordshire-bull-terrier/>. Covers rose or half-pricked ears and a low-set tail.

A full `RESEARCH.md` (DogFACS and peer-reviewed stress-signal work) belongs to the later full build.
