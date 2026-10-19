# Licences

| Component | Where | Licence | Notes |
|---|---|---|---|
| This repo's own code | `docs/js`, `tests/`, etc. | MIT (see `LICENSE`) | |
| MediaPipe Tasks Vision 1.0.1 (`vision_bundle.mjs` and WASM) | `docs/vendor/mediapipe/` | Apache-2.0 (`docs/vendor/mediapipe/LICENSE`) | From npm `@mediapipe/tasks-vision`. |
| EfficientDet-Lite0 float16 (`efficientdet_lite0.tflite`) | `docs/models/` | Apache-2.0 (see note) | Downloaded from `storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/`. Trained on COCO. |
| EfficientDet-Lite2 float16 (`efficientdet_lite2.tflite`) | `docs/models/` | Apache-2.0 (see note) | Same source, `efficientdet_lite2`. |
| COCO dataset (training data of the above) | not included | Annotations CC BY 4.0 | Images remain under their Flickr licences. Only the trained weights are used. |
| Playwright 1.63.0 | dev dependency | Apache-2.0 | Browser test only. Not shipped. |
| http-server 14.1.1 | dev dependency | MIT | Local test server only. Not shipped. |

**Note on the EfficientDet-Lite model licence:** the [MediaPipe object detector page](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector) doesn't state the model licence on the page itself. Code samples on that page are Apache-2.0. The upstream EfficientDet (Google AutoML) and the MediaPipe repo are Apache-2.0, and Google distributes these files publicly, without a login, for use with MediaPipe. They're treated as Apache-2.0 here. Re-check this before any commercial use.

## Development test media (not committed)

These were used only for local headless browser tests. They live in the gitignored `private/testmedia/`.

| File | Source | Licence |
|---|---|---|
| Miss Oreo (O-Dog).webm | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Miss_Oreo_(O-Dog).webm) | CC0 |
| REM - Rapid eye movement sleep of a dog.webm | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:REM_-_Rapid_eye_movement_sleep_of_a_dog.webm) | CC BY-SA 3.0 |
| Puppy playing.webm | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Puppy_playing.webm) | CC BY-SA 3.0 |
| Hoela-hond-517783.ogv | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Hoela-hond-517783.ogv) | CC BY-SA 3.0 NL |
