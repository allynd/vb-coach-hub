import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from diagnostics import exclusion_rect, annotate_exclusions, Coverage, precision_options, render_preview
from analyze import candidate_windows


def ball(x=628, y=294):
    return {'classId':32,'trackId':7,'confidence':0.3,'xyxy':[x-5,y-5,x+5,y+5]}


class DiagnosticsTest(unittest.TestCase):
    def test_rectangles_are_finite_ordered_pixel_coordinates(self):
        self.assertEqual(exclusion_rect('615,280,641,306'),(615,280,641,306))
        for value in ['1,2,3','0,0,nan,3','-1,0,2,3','3,0,2,3']:
            with self.assertRaises(argparse.ArgumentTypeError):
                exclusion_rect(value)

    def test_background_exclusion_keeps_audit_evidence_and_other_classes(self):
        original=[ball(),ball(800,200),dict(ball(),classId=0)]
        result=annotate_exclusions(original,[(615,280,641,306)])
        self.assertEqual(len(result),3)
        self.assertEqual(result[0]['excludedReason'],'manual-background-region')
        self.assertNotIn('excludedReason',result[1])
        self.assertNotIn('excludedReason',result[2])
        self.assertNotIn('excludedReason',original[0])

    def test_no_rectangle_does_not_assume_stationary_balls_are_invalid(self):
        self.assertEqual(annotate_exclusions([ball()],[]),[ball()])

    def test_filtered_background_never_creates_a_review_candidate(self):
        times=[]
        for t in [0,0.5,1,2,3]:
            detections=annotate_exclusions([ball()],[(615,280,641,306)])
            if any(d['classId']==32 and not d.get('excludedReason') for d in detections):
                times.append(t)
        self.assertEqual(candidate_windows(times,277),[])

    def test_coverage_counts_frames_not_multiple_boxes_and_handles_raw_ids(self):
        c=Coverage()
        c.add([ball(),ball(800,200),dict(ball(),classId=0,trackId=None)])
        c.add(annotate_exclusions([ball()],[(615,280,641,306)]))
        report=c.report()
        self.assertEqual(report['ballFramesAfterExclusions'],1)
        self.assertEqual(report['ballFrameCoverage'],.5)
        self.assertEqual(report['excludedBallBoxes'],1)
        self.assertEqual(report['personTrackIds'],0)
        self.assertEqual(Coverage().report()['ballFrameCoverage'],0)

    def test_precision_compatibility(self):
        self.assertEqual(precision_options({'quantize':None},True),{'quantize':16})
        self.assertEqual(precision_options({'quantize':None},False),{'quantize':32})
        self.assertEqual(precision_options({'half':False},True),{'half':True})

    @unittest.skipUnless(importlib.util.find_spec('cv2') and shutil.which('ffmpeg'), 'requires OpenCV and FFmpeg')
    def test_preview_encodes_all_frames_and_rejects_misalignment(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);video=root/'source.mp4';tracks=root/'tracks.jsonl';out=root/'review.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=10',
                            '-t','1','-pix_fmt','yuv420p',str(video)],check=True)
            rows=[{'time':277+i/10,'detections':[ball(100,100)]} for i in range(10)]
            tracks.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            self.assertEqual(render_preview(video,tracks,out,277),10)
            probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0',
                                                     '-show_entries','stream=nb_read_frames,codec_name','-of','json',str(out)]))
            self.assertEqual(probe['streams'][0]['nb_read_frames'],'10')
            self.assertEqual(probe['streams'][0]['codec_name'],'h264')
            with self.assertRaises(ValueError):render_preview(video,tracks,out,277)
            rows[0]['time']=0;tracks.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            bad=root/'bad.mp4'
            with self.assertRaises(ValueError):render_preview(video,tracks,bad,277)
            self.assertFalse(bad.exists())

if __name__=='__main__':unittest.main()
