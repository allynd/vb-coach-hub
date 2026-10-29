"""Compare full-frame and overlapping-tile ball detection on labeled frames only."""
import argparse
import json
import math
from pathlib import Path
import time
import zipfile
from benchmark import digest, evaluate
from diagnostics import annotate_exclusions, exclusion_rect, precision_options


def starts(length, size, overlap):
    if length < 1 or size < 1 or not 0 <= overlap < 1:
        raise ValueError('Invalid tile dimensions or overlap')
    if length <= size:
        return [0]
    stride = max(1, int(size * (1-overlap)))
    return sorted(set(range(0, length-size+1, stride)) | {length-size})


def tiles(width, height, size=640, overlap=.25):
    return [(x,y,min(x+size,width),min(y+size,height))
            for y in starts(height,size,overlap) for x in starts(width,size,overlap)]


def translate(detection, x, y):
    a,b,c,d = detection['xyxy']
    return dict(detection, xyxy=[a+x,b+y,c+x,d+y])


def iou(a, b):
    inter = max(0,min(a[2],b[2])-max(a[0],b[0])) * max(0,min(a[3],b[3])-max(a[1],b[1]))
    union = (a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter
    return inter/union if union > 0 else 0


def suppress(detections, threshold=.5):
    kept=[]
    for d in sorted(detections,key=lambda d:d['confidence'],reverse=True):
        if not any(d['classId']==k['classId'] and iou(d['xyxy'],k['xyxy'])>threshold for k in kept):
            kept.append(d)
    return kept


def predict(model, frame, options):
    boxes=model.predict(frame, **options)[0].boxes
    if boxes is None:
        return []
    return [dict(classId=int(cls),trackId=None,confidence=float(conf),xyxy=xyxy)
            for cls,conf,xyxy in zip(boxes.cls.cpu().tolist(),boxes.conf.cpu().tolist(),boxes.xyxy.cpu().tolist())]


def compare_frame(model, frame, options, regions, rectangles):
    full=annotate_exclusions(predict(model,frame,options),rectangles)
    candidates=[]
    for x,y,x2,y2 in regions:
        candidates.extend(dict(translate(d,x,y),tile=[x,y,x2,y2])
                          for d in predict(model,frame[y:y2,x:x2],options))
    # Apply exclusions after merging so an excluded duplicate cannot reappear.
    tiled=annotate_exclusions(suppress(candidates),rectangles)
    return full,tiled


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('video',type=Path)
    p.add_argument('--benchmark',type=Path,required=True,help='Review ZIP or manifest.json')
    p.add_argument('--labels',type=Path,required=True)
    p.add_argument('--weights',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--device',default='0')
    p.add_argument('--tile-size',type=int,default=640)
    p.add_argument('--overlap',type=float,default=.25)
    p.add_argument('--imgsz',type=int,default=1280)
    p.add_argument('--confidence',type=float,default=.15)
    p.add_argument('--ball-exclude-rect',type=exclusion_rect,action='append',default=[])
    a=p.parse_args()
    if a.imgsz<32 or a.tile_size<32 or not math.isfinite(a.overlap) or not 0<=a.overlap<.9 or not math.isfinite(a.confidence) or not 0<a.confidence<=1:
        p.error('Invalid image size, tile size, overlap, or confidence')
    if a.out.exists():p.error('Output folder already exists; choose a new one')
    if not a.weights.is_file():p.error('Supply trusted local weights')
    if a.benchmark.suffix.lower()=='.zip':
        with zipfile.ZipFile(a.benchmark) as z:m=json.loads(z.read('manifest.json'))
    else:m=json.loads(a.benchmark.read_text(encoding='utf-8'))
    if digest(a.video)!=m['sourceSha256']:
        p.error('Video differs from the labeled source. Use the original hastings-sample.mp4, not a re-encoded preview.')
    labels=json.loads(a.labels.read_text(encoding='utf-8'))
    # Validate all labels before loading models, but never pass positions to inference.
    evaluate(m,labels,{f['index']:dict(time=f['time'],detections=[]) for f in m['frames']})
    for _,_,x2,y2 in a.ball_exclude_rect:
        if x2>m['width'] or y2>m['height']:p.error('Exclusion rectangle exceeds source dimensions')
    import cv2
    import torch
    import ultralytics
    from ultralytics import YOLO
    from ultralytics.cfg import DEFAULT_CFG_DICT
    if a.device!='cpu' and not torch.cuda.is_available():p.error('CUDA unavailable; no CPU fallback')
    model=YOLO(str(a.weights))
    options=dict(device=a.device,imgsz=a.imgsz,conf=a.confidence,classes=[32],verbose=False,
                 iou=.7,rect=True,**precision_options(DEFAULT_CFG_DICT,a.device!='cpu'))
    regions=tiles(m['width'],m['height'],a.tile_size,a.overlap)
    cap=cv2.VideoCapture(str(a.video))
    if not cap.isOpened():raise ValueError('Cannot open source')
    if abs(cap.get(cv2.CAP_PROP_FPS)-m['fps'])>.001:
        cap.release();raise ValueError('Source frame rate mismatch')
    selected={f['index'] for f in m['frames']}
    results={mode:{} for mode in ('full','tiled')}
    a.out.mkdir(parents=True)
    started=time.monotonic()
    try:
        for i in range(m['count']):
            ok,frame=cap.read()
            if not ok:raise ValueError(f'Source ended before frame {i}')
            if i not in selected:continue
            if frame.shape[:2]!=(m['height'],m['width']):raise ValueError('Dimensions mismatch')
            full,tiled=compare_frame(model,frame,options,regions,a.ball_exclude_rect)
            for mode,dets in [('full',full),('tiled',tiled)]:
                results[mode][i]=dict(frameIndex=i,time=m['sourceOffset']+i/m['fps'],detections=dets)
            print(f'Compared {len(results["full"])}/{len(selected)} frames',flush=True)
        ok,_=cap.read()
        if ok:raise ValueError('Source contains extra frames')
    finally:cap.release()
    report=dict(benchmarkId=m['benchmarkId'],sourceSha256=m['sourceSha256'],labelsSha256=digest(a.labels),
                weightsSha256=digest(a.weights),weights=a.weights.name,torch=torch.__version__,
                ultralytics=ultralytics.__version__,options=options,tiles=regions,mergeIoU=.5,
                exclusionRects=a.ball_exclude_rect,elapsedSeconds=time.monotonic()-started,
                limitation='Diagnostic sample only. No trajectories, rallies, roster identities or approved stats.')
    for mode,rows in results.items():
        with (a.out/f'{mode}-sampled.jsonl').open('w',encoding='utf-8') as f:
            for row in rows.values():f.write(json.dumps(row)+'\n')
        report[mode]=evaluate(m,labels,rows)
    (a.out/'comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    for mode in results:
        s=report[mode]
        print(f'{mode}: TP={s["truePositives"]} FP={s["falsePositives"]} FN={s["falseNegatives"]} precision={s["precision"]} recall={s["recall"]}')
    print(f'Saved {a.out / "comparison.json"}; no statistics uploaded.')


if __name__=='__main__':main()
