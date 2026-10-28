import unittest
from analyze import candidate_windows, timeline_offset

class WindowsTest(unittest.TestCase):
    def test_full_recording_and_trimmed_clip_share_original_timestamps(self):
        self.assertEqual(timeline_offset(0,277),timeline_offset(277,0))
        self.assertEqual(timeline_offset(277,10),287)
        self.assertEqual(candidate_windows([0,1],timeline_offset(277,10))[0]['start'],287)
    def test_invalid_offsets_rejected(self):
        for offset,start in [(-1,0),(0,-1),(float('nan'),0),(0,float('inf'))]:
            with self.assertRaises(ValueError):
                timeline_offset(offset,start)
    def test_no_ball_no_invented_rally(self):
        self.assertEqual(candidate_windows([],277), [])
    def test_gaps_and_absolute_timestamps(self):
        result=candidate_windows([0,0.5,1,8,9,9],277)
        self.assertEqual([(r['start'],r['end']) for r in result],[(277,278),(285,286)])
        self.assertTrue(all(r['confidence'] is None and r['type']=='' for r in result))
    def test_isolated_detection_not_rally(self):
        self.assertEqual(candidate_windows([0,8],277), [])

if __name__=='__main__':
    unittest.main()
