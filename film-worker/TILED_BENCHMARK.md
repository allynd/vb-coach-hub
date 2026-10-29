# Controlled crop experiment

Allyn's 60 reviewed frames contain 49 visible-ball labels and 11 not-visible labels. The uploaded raw medium-model logs scored 6 true positives, 3 false positives and 43 misses (precision 66.7%, recall 12.2%) at the fixed 20-pixel center tolerance. These are sample-local detection metrics, not match/stat accuracy.

This experiment runs YOLO11m on the same 60 original frames in two modes: full frame and six overlapping 640×640 crops, each at imgsz=1280. It remaps tile boxes to original pixels and suppresses overlapping duplicates by confidence (IoU > 0.5), then applies the same spare-ball exclusion. Crops are inferred sequentially to bound GPU memory. The tiled mode uses only tiles, not a union with the full-frame result. Each mode uses confidence=.15, model NMS IoU=.7, class 32, and the same precision. No labels are used to select crops or alter predictions.

Full-frame inference is rerun as the paired control because the older worker re-encoded its input. The new comparison decodes the original labeled source directly, with no re-encoding or JPEG inference. The old 6/3/43 result may therefore differ. Both new modes see identical source frames. The input hash must match the labeling manifest, and labels must match its benchmark ID. There is no silent substitution of a different clip.

## Run on the RTX 3090 PC

Keep the original `hastings-sample.mp4` and `yolo11m.pt` in `VolleyballAI`. Save `Hastings_Ball_Review.zip` and your exported `ball-labels.json` in Downloads. The ZIP need not be extracted. If the browser added a suffix to either filename, update the path below.

```powershell
Set-Location "$env:USERPROFILE\VolleyballAI"
git -C .\vb-coach-hub pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Repository update failed' }
$experiment = ".\runs\tiled-benchmark-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
.\.venv\Scripts\python.exe .\vb-coach-hub\film-worker\tiled_benchmark.py `
  .\hastings-sample.mp4 `
  --benchmark "$env:USERPROFILE\Downloads\Hastings_Ball_Review.zip" `
  --labels "$env:USERPROFILE\Downloads\ball-labels.json" `
  --weights .\yolo11m.pt --device 0 `
  --ball-exclude-rect 615,280,641,306 `
  --out $experiment
if ($LASTEXITCODE -ne 0) { throw 'Experiment failed; keep the error output' }
explorer.exe $experiment
```

Upload `comparison.json` first. It contains both scores, per-frame errors, hashes, settings, versions and elapsed time. The two `*-sampled.jsonl` files preserve boxes with explicit source frame indices; they are sparse diagnostic logs and **must not** be imported into the full-frame track renderer or used to generate rally windows. Failed runs never write a success report; use a fresh output folder after a failure.

No new labels, dependencies, full-match run, or model download are needed. This script does not touch the app or database. GPU inference has to be validated on the user's machine; geometry/scoring tests do not demonstrate improved detection. Cropping may increase false positives or remove useful context. Keep the fixed benchmark and tolerance for this comparison, and evaluate on separate footage before claiming general improvement. Continuous tracking requires a later experiment on consecutive frames.

API reference: https://docs.ultralytics.com/modes/predict/ (NumPy BGR inputs and boxes in source-image pixel coordinates). The benchmark reports point-localization precision/recall, not bounding-box AP.
