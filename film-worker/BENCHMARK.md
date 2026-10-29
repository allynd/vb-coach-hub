# Game-ball labeling milestone

The medium-model clip had candidate ball detections in 136/1800 frames, but these include false positives. The fixed white object at the far net-post base is a **spare volleyball**, as confirmed by Allyn. Excluding it does not establish game-ball accuracy. Review windows are not verified rallies.

This tool creates an offline browser labeling page from the original, unannotated video. By default it samples every 30 frames (60 images from the 30fps, 60-second sample), independently of detections. Click the game ball center, including held and dead-ball periods; spare balls never count. Use Uncertain for ambiguous images. No labels are supplied as ground truth automatically. Export before closing, and import to resume. No GPU rerun or new Python dependencies are needed; FFmpeg and FFprobe must be on PATH.

## PowerShell

```powershell
Set-Location "$env:USERPROFILE\VolleyballAI"
git -C .\vb-coach-hub pull --ff-only
$benchmark = ".\runs\ball-benchmark-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
.\.venv\Scripts\python.exe .\vb-coach-hub\film-worker\benchmark.py prepare `
  .\hastings-sample.mp4 --source-offset 277 --step 30 --out $benchmark
if ($LASTEXITCODE -ne 0) { throw 'Benchmark preparation failed' }
Start-Process "$benchmark\label.html"
```

After exporting `ball-labels.json`, evaluate the same labels against each model's original tracks. Substitute actual paths:

```powershell
.\.venv\Scripts\python.exe .\vb-coach-hub\film-worker\benchmark.py score `
  "$benchmark\manifest.json" "$env:USERPROFILE\Downloads\ball-labels.json" `
  .\runs\YOUR-COMPARISON\yolo11m\tracks.jsonl
```

Repeat for nano. Reports include track-file hashes, benchmark ID, counts and per-frame errors. Keep the source video paired with its own logs: count/timestamp checks cannot detect unrelated footage with identical timing. The manifest includes a video SHA256 for provenance.

## Metric definition and limits

A visible label can match at most one nonexcluded class-32 box whose **center** lies within 20 source pixels (configurable with `--tolerance`) of the marked point. Other boxes are false positives. A visible point with no match is a false negative. All accepted boxes in confidently Not visible frames are false positives. Uncertain/unreviewed frames are omitted; reports disclose missing labels. Zero denominators produce null, not perfect scores. This is point-localization precision/recall, not bounding-box AP, rally accuracy, or verified statistics.

A 60-frame uniform sample is a first diagnostic benchmark, not a representative match-level estimate. One-second sampling can miss brief contacts; separate contiguous annotated sequences are needed before evaluating trajectories. Keep labels and tolerance fixed when comparing models; reserve other footage for validation before tuning on these frames. This milestone does not change the deployed app, Supabase schema, or approved statistics.
