import unittest
from unittest.mock import patch
from tiled_benchmark import starts, tiles, translate, suppress, compare_frame
from benchmark import evaluate


def ball(box, confidence=.7):
    return dict(classId=32,trackId=None,confidence=confidence,xyxy=box)


class TileTest(unittest.TestCase):
    def test_cover_full_frame_including_right_and_bottom_edges(self):
        regions=tiles(1280,720)
        self.assertEqual(len(regions),6)
        self.assertIn((640,80,1280,720),regions)
        for y in range(720):
            intervals=sorted((x,x2) for x,y1,x2,y2 in regions if y1<=y<y2)
            end=0
            for x,x2 in intervals:
                self.assertLessEqual(x,end);end=max(end,x2)
            self.assertEqual(end,1280)

    def test_small_image_and_bad_overlap(self):
        self.assertEqual(tiles(320,180),[(0,0,320,180)])
        for overlap in [-.1,1,float('nan')]:
            with self.assertRaises(ValueError):starts(1280,640,overlap)

    def test_translation_preserves_source_and_confidence(self):
        d=ball([10,20,30,40])
        moved=translate(d,640,80)
        self.assertEqual(moved['xyxy'],[650,100,670,120])
        self.assertEqual(d['xyxy'],[10,20,30,40])
        self.assertEqual(moved['confidence'],.7)

    def test_duplicate_suppression_keeps_best_and_separate_balls(self):
        result=suppress([ball([100,100,110,110],.2),ball([101,101,111,111],.8),ball([200,100,210,110])])
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['confidence'],.8)

    def test_class_specific_suppression(self):
        d=ball([0,0,10,10])
        self.assertEqual(len(suppress([d,dict(d,classId=0)])),2)

    def test_end_to_end_crop_offsets_exclusion_and_sparse_scoring(self):
        class Frame:
            def __getitem__(self,key):return self
        # Full misses; first crop has spare and game ball, second repeats game ball.
        predictions=[[ball([620,285,636,301])],
                     [ball([620,285,636,301]),ball([500,100,510,110],.8)],
                     [ball([20,100,30,110],.6)]]
        with patch('tiled_benchmark.predict',side_effect=predictions):
            full,tiled=compare_frame(None,Frame(),{},[(0,0,640,640),(480,0,1120,640)],[(615,280,641,306)])
        self.assertTrue(full[0]['excludedReason'])
        self.assertEqual(len(tiled),2)
        m=dict(benchmarkId='test',width=1280,height=720,frames=[dict(index=30)])
        labels=dict(benchmarkId='test',labels=[dict(index=30,state='visible',point=[505,105])])
        s=evaluate(m,labels,{30:dict(time=278,detections=tiled)})
        self.assertEqual((s['truePositives'],s['falsePositives'],s['falseNegatives']),(1,0,0))


if __name__=='__main__':unittest.main()
