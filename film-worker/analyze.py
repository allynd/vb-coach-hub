"""Local-only experimental film worker. Never writes match statistics or Supabase."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess


def probe(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    video = next(s for s in data['streams'] if s['codec_type'] == 'video')
    return {'width': video['width'], 'height': video['height'], 'frameRate': video['avg_frame_rate'], 'duration': float(data['format']['duration'])}


def candidate_windows(times, offset, gap=2.0, minimum=1.0):
    """Ball-visible windows are review proposals, NOT validated rally boundaries."""
    spans = []
    for t in sorted(set(times)):
        if not spans or t - spans[-1][1] > gap:
            spans.append([t, t])
        else:
            spans[-1][1] = t
    return [{'id': f'ball-{round((offset+a)*1000)}-{round((offset+b)*1000)}',
             'start': round(offset+a, 3), 'end': round(offset+b, 3),
             'confidence': None, 'type': '',
             'note': 'Ball-visible interval; verify rally boundaries, action and player. Not a confirmed rally.'}
            for a, b in spans if b-a >= minimum]


def timeline_offset(source_offset, start):
    """Map input-file time zero and extraction start to original-video seconds."""
    if not all(math.isfinite(x) and x >= 0 for x in (source_offset, start)):
        raise ValueError('Source offset and start must be finite, nonnegative seconds')
    return source_offset + start


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('video', type=Path)
    p.add_argument('--video-id', required=True)
    p.add_argument('--start', type=float, default=0, help='Extraction start within this input file')
    p.add_argument('--source-offset', type=float, default=0, help='Original video timestamp at input-file time zero; 277 for the uploaded 4:37 clip')
    p.add_argument('--seconds', type=float, default=60)
    p.add_argument('--out', type=Path, default=Path('film-output'))
    p.add_argument('--weights', type=Path, help='Optional locally supplied trusted Ultralytics model weights')
    p.add_argument('--device', default='0', help='CUDA GPU index (0 for RTX 3090); cpu is explicit testing only')
    p.add_argument('--person-class', type=int, default=0)
    p.add_argument('--ball-class', type=int, default=32, help='COCO sports ball; override for a volleyball-specific model')
    args = p.parse_args()
    if not re.fullmatch(r'[\w-]{11}', args.video_id):
        p.error('Invalid YouTube video ID')
    if not args.video.is_file():
        p.error('Supply a locally downloaded video file')
    if not all(math.isfinite(x) for x in [args.start, args.seconds]) or args.start < 0 or not 0 < args.seconds <= 300:
        p.error('Start must be nonnegative; sample duration must be 1–300 seconds')
    try:
        offset = timeline_offset(args.source_offset, args.start)
    except ValueError as error:
        p.error(str(error))
    meta = probe(args.video)
    if args.start >= meta['duration']:
        p.error('Start exceeds video duration')
    args.out.mkdir(parents=True, exist_ok=True)
    clip = args.out / 'sample.mp4'
    # Exact decode/re-encode avoids keyframe-dependent copy timestamps. No audio needed.
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-n', '-ss', str(args.start), '-i', str(args.video), '-t', str(args.seconds), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', str(clip)], check=True)
    output = {'schemaVersion': 1, 'videoId': args.video_id, 'model': 'probe-only',
              'source': meta, 'sample': probe(clip), 'sampleOffset': offset,
              'sourceOffset': args.source_offset, 'inputStart': args.start,
              'candidates': [], 'limitations': ['No action classifier or automatic roster identity yet.']}
    if args.weights:
        import cv2
        import torch
        from ultralytics import YOLO
        if not args.weights.is_file():
            p.error('Weights must be a local file')
        if args.device != 'cpu' and not torch.cuda.is_available():
            p.error('CUDA unavailable. Install CUDA-enabled PyTorch and check NVIDIA driver. No silent CPU fallback.')
        model = YOLO(str(args.weights))
        output['model'] = args.weights.name
        output['weightsSha256'] = hashlib.file_digest(args.weights.open('rb'), 'sha256').hexdigest()
        output['device'] = 'cpu' if args.device == 'cpu' else torch.cuda.get_device_name(int(args.device))
        cap = cv2.VideoCapture(str(clip))
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError('Invalid sample frame rate')
        ball_times = []
        index = 0
        with (args.out / 'tracks.jsonl').open('w', encoding='utf-8') as track_file:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                # Process every frame: fast balls are lost by aggressive frame skipping.
                result = model.track(frame, persist=True, tracker='bytetrack.yaml', device=args.device,
                                     half=args.device != 'cpu', imgsz=1280, conf=0.15,
                                     classes=[args.person_class, args.ball_class], verbose=False)[0]
                boxes = result.boxes
                detections = []
                if boxes is not None:
                    for i in range(len(boxes)):
                        cls = int(boxes.cls[i].item())
                        detections.append({'classId': cls, 'trackId': int(boxes.id[i].item()) if boxes.id is not None else None,
                                           'confidence': float(boxes.conf[i].item()), 'xyxy': boxes.xyxy[i].cpu().tolist()})
                        if cls == args.ball_class:
                            ball_times.append(index/fps)
                track_file.write(json.dumps({'time': offset+index/fps, 'detections': detections})+'\n')
                index += 1
        cap.release()
        output['candidates'] = candidate_windows(ball_times, offset)
        output['limitations'].extend(['Person tracks include bench, officials and spectators until court masking is calibrated.',
                                     'Sports-ball detector confidence is not volleyball-stat accuracy.',
                                     'Ball visibility windows may merge or split rallies; point winners are unknown.'])
    (args.out / 'analysis.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(f"Saved {args.out / 'analysis.json'}; no statistics approved or uploaded.")


if __name__ == '__main__':
    main()
