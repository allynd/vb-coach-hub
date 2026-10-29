"""Auditable detection filters and local review-video rendering; no stat approval."""
import argparse
import json
import math
from pathlib import Path
import subprocess


def exclusion_rect(value):
    try:
        rect = tuple(float(x) for x in value.split(','))
        if len(rect) != 4 or not all(math.isfinite(x) for x in rect):
            raise ValueError()
        x1, y1, x2, y2 = rect
        if not (0 <= x1 < x2 and 0 <= y1 < y2):
            raise ValueError()
        return rect
    except (ValueError, TypeError):
        raise argparse.ArgumentTypeError('Rectangle must be x1,y1,x2,y2 in source-video pixels')


def annotate_exclusions(detections, rectangles, ball_class=32):
    """Keep excluded boxes in the audit log; never call accepted boxes verified balls."""
    result = []
    for item in detections:
        d = dict(item)
        if d['classId'] == ball_class:
            x1, y1, x2, y2 = d['xyxy']
            x, y = (x1 + x2) / 2, (y1 + y2) / 2
            if any(a <= x <= c and b <= y <= e for a, b, c, e in rectangles):
                d['excludedReason'] = 'manual-background-region'
        result.append(d)
    return result


class Coverage:
    def __init__(self, person_class=0, ball_class=32):
        self.person_class, self.ball_class = person_class, ball_class
        self.frames = self.people = self.ball_frames = self.excluded = 0
        self.ids = set()

    def add(self, detections):
        self.frames += 1
        self.people += sum(d['classId'] == self.person_class for d in detections)
        self.ids.update(d['trackId'] for d in detections
                        if d['classId'] == self.person_class and d.get('trackId') is not None)
        balls = [d for d in detections if d['classId'] == self.ball_class]
        self.ball_frames += any(not d.get('excludedReason') for d in balls)
        self.excluded += sum(bool(d.get('excludedReason')) for d in balls)

    def report(self):
        return dict(framesProcessed=self.frames, meanPersonBoxes=self.people / self.frames if self.frames else 0,
                    personTrackIds=len(self.ids), ballFramesAfterExclusions=self.ball_frames,
                    ballFrameCoverage=self.ball_frames / self.frames if self.frames else 0,
                    excludedBallBoxes=self.excluded,
                    warning='Coverage is not accuracy or recall. Boxes and track IDs are not roster identities.')


def precision_options(config, gpu):
    # New Ultralytics versions renamed half; keep older installations usable.
    return {'quantize': 16 if gpu else 32} if 'quantize' in config else {'half': gpu}


def render_preview(video, tracks, output, offset=0, rectangles=(), ball_class=32):
    import cv2
    if Path(output).exists():
        raise ValueError('Preview already exists; choose a new output file')
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not cap.isOpened() or not math.isfinite(fps) or fps <= 0 or not width or not height:
        cap.release()
        raise ValueError('Cannot decode preview source')
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    proc = None
    count = 0
    try:
        proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-nostdin', '-n', '-f', 'rawvideo',
                                 '-pix_fmt', 'bgr24', '-s', f'{width}x{height}', '-r', str(fps),
                                 '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-crf', '23', '-preset', 'fast',
                                 '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(output)], stdin=subprocess.PIPE)
        with Path(tracks).open(encoding='utf-8') as lines:
            for line in lines:
                row = json.loads(line)
                ok, frame = cap.read()
                if not ok or abs(row['time'] - (offset + count / fps)) > 0.51 / fps:
                    raise ValueError('Tracks and source video are not aligned')
                for rect in rectangles:
                    a, b, c, d = map(round, rect)
                    cv2.rectangle(frame, (a, b), (c, d), (0, 0, 255), 2)
                for det in annotate_exclusions(row['detections'], rectangles, ball_class):
                    ball = det['classId'] == ball_class
                    excluded = bool(det.get('excludedReason'))
                    color = (0, 0, 255) if excluded else (0, 255, 255) if ball else (255, 200, 0)
                    a, b, c, d = map(round, det['xyxy'])
                    cv2.rectangle(frame, (a, b), (c, d), color, 2 if ball else 1)
                    if ball:
                        label = f"{'EXCLUDED' if excluded else 'BALL?'} {det['confidence']:.2f}"
                        cv2.putText(frame, label, (max(0, a-15), max(18, b-5)), cv2.FONT_HERSHEY_SIMPLEX, .5, color, 1)
                cv2.rectangle(frame, (0, 0), (width, 48), (0, 0, 0), -1)
                cv2.putText(frame, f"Original {row['time']:.2f}s | clip {count/fps:.2f}s | detections, NOT verified stats",
                            (8, 19), cv2.FONT_HERSHEY_SIMPLEX, .5, (255, 255, 255), 1)
                cv2.putText(frame, 'Yellow: ball candidate | red: excluded | cyan: person (includes bench/officials)',
                            (8, 39), cv2.FONT_HERSHEY_SIMPLEX, .5, (255, 255, 255), 1)
                proc.stdin.write(frame.tobytes())
                count += 1
            if cap.read()[0] or count == 0:
                raise ValueError('Track count does not match the source video')
        proc.stdin.close()
        if proc.wait() != 0:
            raise RuntimeError('FFmpeg could not encode preview')
    except Exception:
        if proc is not None:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            Path(output).unlink(missing_ok=True)
        raise
    finally:
        if proc is not None and proc.stdin is not None and not proc.stdin.closed:
            try:
                proc.stdin.close()
            except BrokenPipeError:
                pass
        cap.release()
    return count


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('video', type=Path)
    p.add_argument('tracks', type=Path)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--source-offset', type=float, default=0)
    p.add_argument('--ball-exclude-rect', type=exclusion_rect, action='append', default=[])
    a = p.parse_args()
    print(f'Rendered {render_preview(a.video, a.tracks, a.out, a.source_offset, a.ball_exclude_rect)} frames to {a.out}')
