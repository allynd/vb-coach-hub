import json
from pathlib import Path
import tempfile
import unittest
from benchmark import evaluate, load_tracks


class BenchmarkTest(unittest.TestCase):
    def setUp(self):
        self.m = dict(benchmarkId='test', width=1280, height=720, frames=[dict(index=i) for i in range(4)])
        ball = dict(classId=32, xyxy=[90,90,110,110])
        self.rows = [dict(time=i, detections=[dict(ball),dict(ball)]) for i in range(4)]

    def score(self, labels):
        return evaluate(self.m, dict(benchmarkId='test', labels=labels), self.rows)

    def test_one_match_only_and_false_boxes_on_absent_frame(self):
        r=self.score([dict(index=0,state='visible',point=[100,100]),dict(index=1,state='absent')])
        self.assertEqual((r['truePositives'],r['falsePositives'],r['falseNegatives']), (1,3,0))
        self.assertEqual(r['precision'],.25)
        self.assertEqual(r['unlabeled'],2)

    def test_exclusions_misses_and_uncertain_are_not_successes(self):
        for d in self.rows[0]['detections']: d['excludedReason']='manual-background-region'
        r=self.score([dict(index=0,state='visible',point=[100,100]),dict(index=1,state='uncertain')])
        self.assertEqual((r['truePositives'],r['falsePositives'],r['falseNegatives']), (0,0,1))
        self.assertIsNone(r['precision'])
        self.assertEqual(r['recall'],0)
        self.assertEqual(r['ignored'],1)

    def test_reject_mismatched_duplicate_unknown_and_invalid_points(self):
        with self.assertRaises(ValueError): evaluate(self.m,dict(benchmarkId='other',labels=[]),self.rows)
        for labels in [[dict(index=9,state='absent')], [dict(index=0,state='absent')]*2,
                       [dict(index=0,state='visible',point=[float('nan'),0])],
                       [dict(index=0,state='visible',point=[1280,0])]]:
            with self.assertRaises(ValueError):self.score(labels)

    def test_alignment_rejects_shift_and_missing_frames(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'tracks.jsonl'
            p.write_text('\n'.join(json.dumps(dict(time=277+i/30,detections=[])) for i in range(4)))
            self.assertEqual(len(load_tracks(p,4,30,277)),4)
            with self.assertRaises(ValueError):load_tracks(p,4,30,0)
            with self.assertRaises(ValueError):load_tracks(p,5,30,277)


if __name__=='__main__':unittest.main()
