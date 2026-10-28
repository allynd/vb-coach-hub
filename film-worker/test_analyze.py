import unittest
from analyze import candidate_windows

class WindowsTest(unittest.TestCase):
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
