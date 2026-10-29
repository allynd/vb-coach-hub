# Detection comparison milestone

The first uploaded Hastings/Eagan run processed 1800 frames. Its 85 ball boxes were all centered at approximately (628,294), within a one-pixel range, on a fixed white feature at the far net post. The single proposed interval is not gameplay evidence. Person boxes averaged 31/frame and produced 352 IDs across all visible people; these are not roster identities or a measured identity-switch count.

The next experiment compares YOLO11 nano and medium with identical settings on the same 60-second sample. Do not process the full match until real-ball coverage has been manually evaluated.

## Changes

- `--raw-detections` uses YOLO prediction without tracker association. All detector boxes at the selected threshold are retained. `trackId` is null; this mode cannot assess tracking stability. It distinguishes detector misses from tracker suppression.
- `--ball-exclude-rect x1,y1,x2,y2` marks ball-box centers in a manually reviewed background region as excluded. Boxes remain logged with `excludedReason` and are rendered in red. They do not create candidate windows. The region is not a general stationary-ball rule: held or briefly stationary real balls must not be automatically discarded.
- `--preview` creates `review.mp4`, an H.264 copy with yellow ball candidates, red exclusions, and cyan person boxes. Original and clip seconds are shown. No boxes are verified stats. Bench personnel and officials are still included; court calibration remains a separate milestone.
- `--imgsz` and `--confidence` are explicit comparison controls. Defaults remain 1280 and 0.15.
- `analysis.json` records library versions, settings, coverage, and excluded-box counts. Coverage is not recall or accuracy. Progress is printed every five video seconds.
- Precision uses `quantize` when installed Ultralytics supports it, with `half` retained for older releases.

## Run on Allyn's Windows machine

From PowerShell, after the already-tested GPU environment is installed:

```powershell
Set-Location "$env:USERPROFILE\VolleyballAI"
git -C .\vb-coach-hub pull --ff-only
.\.venv\Scripts\python.exe -c "from ultralytics import YOLO; YOLO('yolo11m.pt')"
$comparison = ".\runs\comparison-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
foreach ($model in @('yolo11n', 'yolo11m')) {
    .\.venv\Scripts\python.exe .\vb-coach-hub\film-worker\analyze.py `
      .\hastings-sample.mp4 --video-id ugW5_-zfJKY `
      --start 0 --source-offset 277 --seconds 60 `
      --weights ".\$model.pt" --device 0 `
      --raw-detections --imgsz 1280 --confidence 0.15 `
      --ball-exclude-rect 615,280,641,306 --preview `
      --out "$comparison\$model"
    if ($LASTEXITCODE -ne 0) { throw "Analysis failed for $model. Stop and inspect the error." }
}
.\.venv\Scripts\python.exe -m pip freeze | Set-Content "$comparison\requirements-local.txt"
explorer.exe $comparison
```

The rectangle is only calibrated for the supplied 1280x720, 4:37–5:37 clip. It must be rechecked if framing, resolution or footage changes. A real ball crossing the region will also be marked excluded; red overlays make that tradeoff inspectable. No court mask is claimed to be calibrated.

Upload both `analysis.json` files and the medium model's `review.mp4` for comparison. A larger model may still miss the ball. Before choosing a model, label visible ball positions across the sample and compare true/false detections, misses, and short occlusions. More boxes alone is not an improvement. If neither model detects the actual ball reliably, collect labeled volleyball examples and evaluate a specialized detector.

## Inspect existing outputs without GPU inference

```powershell
.\.venv\Scripts\python.exe .\vb-coach-hub\film-worker\diagnostics.py `
  .\hastings-sample.mp4 .\runs\YOUR-RUN\tracks.jsonl `
  --source-offset 277 --ball-exclude-rect 615,280,641,306 `
  --out .\runs\YOUR-RUN\review.mp4
```

This renders existing logs only; it does not rewrite the original analysis or tracks. Preview rendering rejects timestamp/frame-count mismatches and existing output files. It requires OpenCV and FFmpeg. Worker/helper unit and synthetic-video tests do not establish detector accuracy; the GPU comparison must run on the user's machine.
