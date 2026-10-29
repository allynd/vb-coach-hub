"""Local, detector-blind game-ball labeling and point-localization evaluation."""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_tracks(path, count, fps, offset):
    rows = [json.loads(s) for s in Path(path).read_text(encoding='utf-8').splitlines() if s.strip()]
    if len(rows) != count or any(not math.isfinite(r['time']) or abs(r['time'] - (offset + i / fps)) > .51 / fps for i, r in enumerate(rows)):
        raise ValueError('Tracks do not match frame count, frame rate, or source offset')
    return rows


def evaluate(manifest, labels, rows, tolerance=20):
    if not math.isfinite(tolerance) or tolerance <= 0:
        raise ValueError('Tolerance must be positive and finite')
    if labels.get('benchmarkId') != manifest['benchmarkId']:
        raise ValueError('Labels belong to a different benchmark')
    allowed = {f['index'] for f in manifest['frames']}
    seen = set()
    tp = fp = fn = reviewed = ignored = 0
    details = []
    for label in labels['labels']:
        i = label['index']
        if type(i) is not int or i not in allowed or i in seen:
            raise ValueError('Unknown or duplicate frame label')
        seen.add(i)
        state = label['state']
        if state not in ('visible', 'absent', 'uncertain', 'unreviewed'):
            raise ValueError('Unknown label state')
        if state in ('uncertain', 'unreviewed'):
            ignored += 1
            continue
        balls = [d for d in rows[i]['detections'] if d['classId'] == 32 and not d.get('excludedReason')]
        matched = False
        if state == 'visible':
            x, y = label['point']
            if not all(isinstance(v, (float, int)) and math.isfinite(v) for v in (x, y)) or not (0 <= x < manifest['width'] and 0 <= y < manifest['height']):
                raise ValueError('Invalid game-ball point')
            matched = any(math.hypot((d['xyxy'][0]+d['xyxy'][2])/2-x, (d['xyxy'][1]+d['xyxy'][3])/2-y) <= tolerance for d in balls)
        t = int(matched)
        f = len(balls) - t
        n = int(state == 'visible' and not matched)
        tp += t; fp += f; fn += n; reviewed += 1
        details.append(dict(index=i, time=rows[i]['time'], tp=t, fp=f, fn=n))
    return dict(reviewed=reviewed, ignored=ignored, unlabeled=len(allowed)-len(seen), truePositives=tp,
                falsePositives=fp, falseNegatives=fn, precision=tp/(tp+fp) if tp+fp else None,
                recall=tp/(tp+fn) if tp+fn else None, tolerancePixels=tolerance, frames=details,
                warning='Point-localization metrics on manually reviewed frames only; not rally or stat accuracy.')


def make_pack(video, output, offset, step):
    if output.exists():
        raise ValueError('Choose a new output folder; existing labels must not be overwritten')
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
        '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_frames', '-of', 'json', str(video)]))['streams'][0]
    a, b = map(int, probe['avg_frame_rate'].split('/'))
    fps = a / b
    count = int(probe['nb_read_frames'])
    if step < 1 or not math.isfinite(offset) or offset < 0 or count < 1:
        raise ValueError('Invalid step, source offset, or video')
    manifest = dict(version=1, sourceSha256=digest(video), width=probe['width'], height=probe['height'],
                    fps=fps, count=count, sourceOffset=offset, step=step,
                    frames=[dict(index=i, time=offset+i/fps) for i in range(0,count,step)])
    manifest['benchmarkId'] = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'select=not(mod(n\\,{step}))',
                        '-vsync', '0', '-q:v', '2', str(Path(tmp)/'%06d.jpg')], check=True)
        images = sorted(Path(tmp).glob('*.jpg'))
        if len(images) != len(manifest['frames']):
            raise ValueError('Decoded frame count differs from manifest')
        payload = dict(manifest=manifest, images=['data:image/jpeg;base64,'+base64.b64encode(p.read_bytes()).decode() for p in images])
    template = Path(__file__).with_name('benchmark.html').read_text(encoding='utf-8')
    output.mkdir(parents=True)
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    (output/'label.html').write_text(template.replace('/*BENCHMARK_DATA*/null', json.dumps(payload)), encoding='utf-8')
    print(f'Open {output / "label.html"}. Label only the game ball; export labels before closing.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    pack = sub.add_parser('prepare')
    pack.add_argument('video', type=Path); pack.add_argument('--out', type=Path, required=True)
    pack.add_argument('--source-offset', type=float, default=0)
    pack.add_argument('--step', type=int, default=30, help='Uniform frame interval, independent of detections')
    score = sub.add_parser('score')
    score.add_argument('manifest', type=Path); score.add_argument('labels', type=Path); score.add_argument('tracks', type=Path)
    score.add_argument('--tolerance', type=float, default=20)
    args = p.parse_args()
    if args.command == 'prepare':
        make_pack(args.video, args.out, args.source_offset, args.step)
    else:
        m = json.loads(args.manifest.read_text(encoding='utf-8'))
        rows = load_tracks(args.tracks, m['count'], m['fps'], m['sourceOffset'])
        result = evaluate(m, json.loads(args.labels.read_text(encoding='utf-8')), rows, args.tolerance)
        result['tracksSha256'] = digest(args.tracks)
        result['benchmarkId'] = m['benchmarkId']
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
