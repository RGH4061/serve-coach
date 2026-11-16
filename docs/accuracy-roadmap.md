# Serve Coach: accuracy roadmap

Last updated: 16 November 2026 (analysis-0.3)

This document lists where the measurements go wrong today, what each fix would cost, and the order to do them in. It is based on testing with a real professional serve: a 120 fps iPhone clip of a doubles pro, filmed front-on.

## What the real clip taught us

The first run scored the pro 75/100. Every point lost came from a measuring bug, not his technique:

| Problem | Cause | Status |
|---|---|---|
| Contact height read as 1.99 × his height (physically impossible) | Body size was taken from the first frames, where he was bent over bouncing the ball | Fixed: size now comes from shin, thigh and torso lengths, which don't change with posture |
| Landing distance 1.79 × height | Measured how far he travelled; doubles players keep running in | Fixed: first touchdown after contact |
| Racquet drop negative | Took the racquet on its way up as the "drop"; one false detection at contact | Fixed: only counts the racquet seen below the shoulder and hand, before contact, otherwise blank |
| Trophy marked too early or late | Used "tossing arm highest" | Fixed: deepest knee bend with the toss arm up and the hitting elbow raised |

Detection rates on that clip: player 100% of frames, ball 25%, racquet 63%. The racquet was never detected at the bottom of the drop, because it was too blurred.

A slow-motion side-on clip of a tour pro (Daddy Fed) scored 65 at first. The clip speed had been set to 4× when it was really about 8×, and the top of the toss was out of shot. Toss height is now left blank when the ball isn't seen both rising into and falling from its peak. Knee bend read only 22° and was left out of his reference until it has been checked by eye.

## Where error comes from, biggest first

1. **Camera angle (2D projection).** One phone sees a flat picture. Angles bend and distances shrink when a limb points towards the camera. Forward and back distances (toss placement, landing) are only valid side-on. Now partly handled: there's a camera-angle option, and side-only measurements are dropped for other angles.
2. **Reference quality.** Pro A and B are estimates. One real pro (Pro C) is not a range. Scores are only as good as the reference spread.
3. **Small, fast objects.** In a wide shot the ball is a few pixels across, and the racquet blurs during the drop and swing.
4. **Timing resolution.** At 60 analysed frames per second, contact can be off by 1 to 2 frames (17–33 ms), which also shifts contact height and arm angle.
5. **Body scale and ground level.** These are now robust, but still 2D estimates.
6. **Jitter.** Joint positions wobble between frames; a 3-frame average is crude.

## Proposals

Effort: S = an afternoon, M = a few days, L = a week or more. Impact is on score reliability.

### Quick wins (S)

- **Confidence per measurement.** Show "low confidence" and leave it out of the score when the needed object was barely seen (for example, ball in fewer than 5 frames near the toss peak). Stops one bad detection from costing 20 points.
- **Auto-detect camera angle.** Shoulder width compared with torso length at set-up tells side-on from front-on. Pre-fill the option and warn when it doesn't match what the user picked.
- **Work out slow-motion speed from the toss.** A tossed ball falls under gravity at 9.81 m/s², so with the player's height for scale, fitting a curve to the rising toss gives the slow-motion factor. On the Daddy Fed clip it gave 8.6× from 85 ball positions, fitting to within 2 pixels. Pre-fill the clip speed with it and warn when the chosen value disagrees, since a wrong clip speed breaks every timing measurement.
- **Auto-suggest trim.** Find the serve from the hitting-wrist peak and motion energy, then pre-set the trim handles. Users only adjust it.
- **Analyse every frame near key moments.** Do a quick 30 fps pass to find the serve, then a full-frame-rate pass (120/240 fps) from trophy to landing. Faster overall and sharper timing.
- **Better smoothing.** Replace the 3-frame average with a One-Euro or Savitzky–Golay filter, skip joints with low visibility, and fill short gaps.

### Medium (M)

- **Done (16 Nov): zoomed ball search and frame-to-frame tracking.** YOLO now also searches an enlarged square above the player's head and around the hands (from the full-resolution video), and a tracker follows the one tossed ball, accepting weak detections only where the ball is predicted to be. On the Pro C clip the ball was found in 55 of 55 frames from toss to contact (previously 45), with no wrong picks. Analysis takes roughly twice as long.
- **Zoomed ball and racquet search.** Run YOLO a second time on a crop above the player's head (for the ball) and around the hitting hand (for the racquet). The ball becomes 3–4× larger to the model. This is likely the biggest cheap gain in ball detection.
- **Fit the toss as a curve.** A tossed ball follows a parabola. Fitting one through the frames where it was seen gives the true peak height and position even when some frames miss the ball, and rejects false detections that don't fit.
- **Contact from sound.** The strings hitting the ball make a sharp click in the audio. Finding that spike pins contact to about 1 ms, much better than the video. Browsers can decode the audio track of most phone videos.
- **3D angles from MediaPipe.** MediaPipe also returns "world landmarks", rough 3D joint positions. Computing knee, elbow and shoulder angles in 3D removes much of the camera-angle error for angles. Distances stay 2D.
- **Pose model choice.** Offer MediaPipe "heavy" as a slower, more accurate option for short trimmed clips.
- **Reference library.** At least 5 pros for each stance and camera angle, all measured the same way. Set each measurement's range from their spread (for example the 10th–90th percentile) rather than one tolerance for everyone. Store the movement for each, for the side-by-side.

### Larger (L)

- **Court calibration.** Detect the baseline and sidelines. Known court dimensions turn pixels into real metres and give a true "into the court" direction. That makes toss placement and landing exact, and makes the height entry optional.
- **Tennis-trained detectors.** Fine-tune the ball detector on tennis footage (TrackNet-style ball tracking is well established) and train a racquet model that finds the handle and tip, giving racquet angle as well as position.
- **Accuracy test set.** 15–20 clips with hand-marked trophy, contact and toss-peak frames, plus a few hand-measured angles. Run it on every change and report the error in frames and degrees. This is how we'll know a change made things better rather than different.
- **Two phones or iPhone LiDAR.** True 3D. Needs a native app or a sync step, so it's a later version.

## Suggested order

1. Confidence per measurement, auto camera angle, auto trim (all quick, all visible to users).
2. Zoomed ball search, toss curve fit, contact from sound (fixes the three weakest detections).
3. Build the reference library to about 5 pros per stance; replace Pro A/B placeholders.
4. 3D angles from world landmarks; full-frame-rate pass around key moments.
5. Accuracy test set, then court calibration and tennis-trained models.

## Side-by-side matching (built in 0.3)

The stick-figure pro is chosen by, in order: same stance, same camera angle, same hitting hand, then closest height. Both figures are scaled to the same height, placed on the same ground line with the court to the right, and time-aligned on trophy and contact. Only pros with recorded movement (source "footage") can appear; Pro A and Pro B are numbers only.
