# Serve Coach

A web page that analyses a video of a tennis serve and compares its mechanics with professional servers.

Live site: https://rgh4061.github.io/serve-coach/

## How it works

Everything runs in the browser. The video never leaves the user's device.

1. **Body tracking** – [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) finds 33 body joints in each frame.
2. **Ball and racquet tracking** – YOLO11n (Ultralytics, COCO classes "sports ball" and "tennis racket") runs through ONNX Runtime Web, once on the whole frame and once zoomed in above the player's head and hands. A tracker then follows the one tossed ball from frame to frame.
3. **Serve analysis** (`js/analysis.js`) finds the trophy position, toss peak and contact, works out the stance (pinpoint or platform), and measures knee bend, trophy elbow, shoulder tilt, toss height and placement, racquet drop, contact height, arm extension, jump, leg-drive timing and landing.
4. **Comparison** – each measurement is scored 0–100 against the professional references for the same stance (`data/pros.json`), then weighted into one serve score.
5. **Feedback** – the top three issues, prioritised by what the user ticked (into the net, long, and so on).
6. **History** – scans are saved in the browser's local storage for now.

Measurements use **H** (the player's height) as the unit, so players of different sizes can be compared.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page |
| `css/style.css` | Styling |
| `js/app.js` | Page logic: upload, frame stepping, drawing, results |
| `js/detectors.js` | Loads and runs MediaPipe Pose and YOLO |
| `js/analysis.js` | Serve measurements, pro comparison, pro matching, feedback (no browser code, so it can be tested) |
| `js/dashboard.js` | Score ring, phase cards, progress chart |
| `js/viewer.js` | Video panel, overlay drawing, timeline and trim |
| `js/compare.js` | "You vs Pro" stick-figure panel |
| `js/synthetic.js` | Computer-generated example serve (tests and example dashboard) |
| `data/pros/` | Recorded pro movements for the side-by-side |
| `builder.html`, `js/builder.js` | Reference builder for adding pros |
| `js/ball-track.js` | Zoomed ball search region and frame-to-frame ball tracker |
| `js/pipeline.js` | Steps through a video running the detectors (shared by both pages) |
| `tools/add-pro.mjs` | Adds a pro reference from a downloaded analysis file |
| `docs/accuracy-roadmap.md` | Known error sources and planned accuracy improvements |
| `data/pros.json` | Professional reference numbers (Pro A, Pro B, …) |
| `models/yolo11n.onnx` | YOLO model file |
| `tests/` | Tests (`node tests/analysis.test.mjs`, `node tests/ball-track.test.mjs`) |

## Professional references

Pros are stored anonymously as Pro A, Pro B and so on, grouped by stance. The current values are **placeholder estimates**. To add a real reference, use the **reference builder** at `/builder.html` (not linked from the main page):

1. Enter the pro's alias, height, camera angle and level.
2. For each of 3–5 serves: choose the clip, trim it, analyse, check the trophy, toss-peak and contact markers (fix any with the "… is here" buttons), untick any measurement that looks wrong, then add the serve.
3. Pick which serve to use for the stick figure, then click **Download updated pros.json**.
4. Replace `data/pros.json` in your local repo with the downloaded file, then commit and push in GitHub Desktop.

The builder uses exactly the same measuring code as the main page, so users and pros are always measured the same way. The command-line route (`node tools/add-pro.mjs`) still works for a single downloaded analysis.

Only numbers go in this repo. Video files are blocked by `.gitignore`. Renaming a pro does not change who owns the footage, so check the rights before any public or commercial launch.

## Licences

YOLO11 from Ultralytics is licensed under AGPL-3.0. That's fine for this open, public project. A closed or commercial product would need an Ultralytics Enterprise licence or a differently licensed detector.

## Running locally

Any static web server works, for example `python3 -m http.server`, then open http://localhost:8000.
