# Serve Coach

A web page that analyses a video of a tennis serve and compares its mechanics with professional servers.

Live site: https://rgh4061.github.io/serve-coach/

## How it works

Everything runs in the browser. The video never leaves the user's device.

1. **Body tracking** – [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) finds 33 body joints in each frame.
2. **Ball and racquet tracking** – YOLO11n (Ultralytics, COCO classes "sports ball" and "tennis racket") runs through ONNX Runtime Web.
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
| `js/analysis.js` | Serve measurements, pro comparison, feedback (no browser code, so it can be tested) |
| `data/pros.json` | Professional reference numbers (Pro A, Pro B, …) |
| `models/yolo11n.onnx` | YOLO model file |
| `tests/` | Tests for the analysis code (`node tests/analysis.test.mjs`) |

## Professional references

Pros are stored anonymously as Pro A, Pro B and so on, grouped by stance. The current values are **placeholder estimates**. To add a real reference:

1. Run the pro's serve through the page.
2. Click **Download analysis (JSON)**.
3. Copy the `metrics` block into `data/pros.json` with a new id, the stance, and `"source": "footage"`.

Only numbers go in this repo. Video files are blocked by `.gitignore`. Renaming a pro does not change who owns the footage, so check the rights before any public or commercial launch.

## Licences

YOLO11 from Ultralytics is licensed under AGPL-3.0. That's fine for this open, public project. A closed or commercial product would need an Ultralytics Enterprise licence or a differently licensed detector.

## Running locally

Any static web server works, for example `python3 -m http.server`, then open http://localhost:8000.
