# Film Analysis — experimental milestone 1

Based on repository main `0155a24` (Coach Hub v15.43). This branch adds a review foundation and a local experimental detector adapter. It is not validated automated stat tracking.

## Footage investigation (October 28, 2026)

- Confirmed the signed-in Allyn Dilly YouTube Studio channel and `ugW5_-zfJKY`, Hastings vs Eagan.
- Studio duration 1:08:32; playback duration 4111.3448 seconds (1:08:31). Playback offers 1080p, 720p, 360p and 144p. The video element at 1080p reports 1920×1080. Original upload bitrate/frame rate are not verified.
- Viewed gameplay around 4:37–5:00. Elevated oblique sideline view; bench/coaches and officials in foreground; net and players overlap; large bottom score overlay covers part of image. Full-court coverage throughout the recording has not been established.
- Suitable for assisted review and a detection experiment. Reliable ball/contact tracking, jersey reading, point winner and full statistics require labeled footage validation. Do not infer accuracy from screenshot clarity or detection confidence.
- Initial owner download was blocked by Chrome. A separate private 4:37–5:37 clip was subsequently created through Studio and uploaded by the user. The real sample has now been inspected and used for the probe/extraction milestone; detector inference is still untested.

## App integration and persistence

Film Analysis opens from the header without changing existing navigation or Game Day scoring. Select an existing match, import worker `analysis.json` or add a manual observation, follow its YouTube timestamp, correct seconds/action/set/player, then approve one stat or reject. Approval is explicit; JSON imports cannot approve themselves or assign roster identities.

Approved observations become the existing `kind: stat`, `source: stat_sheet`, `correction: true`, `scoreImpact: 0` events. They use the existing `sheetPendingOps` queue and append-only Supabase `sheet_stat_ops` pathway. Open Stat Sheets / Sync to upload; cloud authentication, permissions, errors and retries remain managed by the existing sheets UI. Scores and completed status remain unchanged. Existing stat sheet / match editors can remove approved observations; tombstones prevent re-creation of the same candidate.

Stable event identity is match + video + candidate ID. This prevents repeated approval of the same imported candidate, **not** semantic duplicates against courtside events or another detector run. The reviewer must compare existing stats. A rally proposal is not automatically a stat; a reviewer must identify one specific action. Add separate manual observations for additional actions.

Evidence includes absolute video timestamps, detector confidence (nullable/unscored), model, candidate ID and review time in the event's `film` metadata. This survives `sheet_stat_ops.payload` and the existing full-team safety snapshot. The normalized `stat_events` projection does not have evidence columns. Drafts live on `game.filmReview`, persist offline and are included in full-team snapshots, but draft reviews are not a multi-writer collaboration mechanism. Export reviews before switching devices; sync the full team for draft backup. Approved events use the existing collaborative operation log.

No database migration is required for this milestone. Repository SQL and adapters were inspected; the live Supabase schema/RLS configuration and an authenticated cloud round trip were **not** tested. No production statistics or database schema were changed.

## Local Windows / RTX 3090 worker

1. Install FFmpeg/ffprobe from a trusted distribution and ensure both are on PATH. Install Python 3.11+ and create a virtual environment.
2. For GPU inference, install CUDA-enabled PyTorch using the current official selector: https://pytorch.org/get-started/locally/ . Verify `python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"` prints your GPU.
3. Install detector dependencies: `python -m pip install ultralytics opencv-python`. Record exact versions with `python -m pip freeze > requirements-local.txt` after the successful first GPU run. This environment has not yet been pinned or tested on the user's GPU.
4. Supply a trusted local Ultralytics detector `.pt` file. Generic COCO defaults are person class 0 and sports ball class 32. This is not a volleyball-trained detector; override class IDs for custom weights. Review model/software licensing for your deployment. Tracking API: https://docs.ultralytics.com/modes/track/ .
5. With the locally saved owner recording, first probe and cut a 60-second gameplay sample:

```powershell
python film-worker/analyze.py "C:\Users\Allyn\Downloads\Hastings vs Eagan.mp4" --video-id ugW5_-zfJKY --start 277 --seconds 60 --out film-output-probe
```

Then run the GPU experiment in a **different output folder**:

```powershell
python film-worker/analyze.py "C:\Users\Allyn\Downloads\Hastings vs Eagan.mp4" --video-id ugW5_-zfJKY --start 277 --seconds 60 --weights "C:\Models\detector.pt" --device 0 --out film-output-gpu
```

The worker uses CUDA device 0, FP16 and 1280 inference size, one frame at a time. It refuses silent CPU fallback. FFmpeg sample encoding is CPU-based. It processes every sample frame and emits timestamped person/ball detections with track IDs to `tracks.jsonl`, plus `analysis.json` and `sample.mp4`. It refuses to overwrite an existing sample. No credentials or HTTP server are required; no video, rosters, or results are automatically uploaded. Files remain local until the user deletes the temporary sample after verification. Avoid committing footage or weights.

Ball-visible intervals separated by >2 seconds generate **unscored review proposals**, not proven rallies. Detection confidence remains in tracks; it is deliberately not mislabeled as rally or action accuracy. Player tracks can include bench/spectators/officials. Track IDs are not roster identities. Action classification, court masking/calibration, jersey association, score OCR, true rally segmentation and automatic point winners remain unimplemented.

## Validation and next acceptance gates

- New JS tests: malformed imports, untrusted approval state, score-neutral approval, roster/team/set validation, repeated approval, delete tombstones, opponent missed serves.
- Python tests: empty detections, gap segmentation, source-time offsets, isolated detection rejection.
- Synthetic and real uploaded-sample FFmpeg probe/clip tests pass. The 60-second real sample decodes without errors, contains 1800 video frames at 30 fps, and maps input time zero to original-video second 277. This validates file handling, not AI accuracy.
- Existing baseline: 31/33 JS tests pass. Two cloud-schema-compat tests already fail because assert.rejects regex compares a thrown plain object to `[object Object]`; unrelated to film changes.
- No real GPU inference or authenticated Supabase write test yet. Do not merge/deploy as production-ready.

Next: label rally boundaries and ball visibility in the supplied sample by hand; measure boundary precision/recall and ball misses; establish court/overlay masks; audit track switches before roster mapping. Only then add action classification and validate each stat category against coach labels. Require a separate completed-match round-trip test (approve, sync, second-device read, remove, replay) before release.


## Uploaded sample validation

The user-supplied `Hastings vs Eagan - AI analysis sample - 04m37s to 05m37s.mp4` is 9,587,189 bytes, H.264 High, 1280×720, constant 30 fps / 1800 frames, 60.000 seconds of video with AAC stereo audio. This downloaded rendition is 720p even though the original playback supports 1080p. FFmpeg decoded the entire file with no reported errors.

Sampled gameplay frames show the scoreboard at 0–0, briefly 1–0, then 0–1, later 0–2 and 0–3. These are observed overlay readings, not approved point outcomes. The temporary reversal means a score-OCR pipeline must handle corrections, not merely count digit changes. The opening frame already contains play, so the first rally may be truncated. Camera framing also varies within the clip; a fixed court mask needs validation across time. Net/players and foreground coaches obscure contacts and jersey numbers. No automatic or human-approved player stats were created.

For this already-trimmed file use **start 0 and source offset 277**, with the original video ID. Do not seek 277 seconds into a 60-second input:

```powershell
python film-worker/analyze.py "Hastings vs Eagan - AI analysis sample - 04m37s to 05m37s.mp4" --video-id ugW5_-zfJKY --start 0 --source-offset 277 --seconds 60 --out film-output-sample
```

For local inference append `--weights "C:\Models\detector.pt" --device 0`, using a new output directory. Extraction defaults now start at zero; full-recording commands above explicitly retain `--start 277`. `sampleOffset` is the original-video offset (source offset + extraction start). Both track timestamps and candidate windows use that same mapping. Five Python tests pass, including equivalent mapping for a full recording and pre-trimmed clip and rejection of negative/non-finite offsets.
