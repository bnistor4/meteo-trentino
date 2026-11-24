import base64
import unittest
from datetime import date

import numpy as np

from refresh import complete_reduce, distances, eligible, encoded, estimate, frost_indicator, held_out_error, rain_peak, season, spring, summer


class IndicatorTests(unittest.TestCase):
    def test_incomplete_days_are_not_silently_treated_as_zero(self):
        result = complete_reduce([np.array([-1, 1]), np.array([0, np.nan])], frost_indicator, np.sum)
        np.testing.assert_allclose(result, [2, np.nan])
        self.assertFalse(eligible(96, 1, 96))
        self.assertFalse(eligible(90, 0, 96))
        self.assertTrue(eligible(92, 0, 96))

    def test_season_periods(self):
        self.assertEqual(season(date(2026, 3, 31)), (date(2025, 4, 1), date(2025, 10, 31)))
        self.assertEqual(season(date(2026, 4, 1)), (date(2026, 4, 1), date(2026, 4, 1)))
        self.assertEqual(season(date(2026, 6, 1)), (date(2026, 4, 1), date(2026, 6, 1)))
        self.assertEqual(season(date(2026, 11, 1)), (date(2026, 4, 1), date(2026, 10, 31)))

    def test_idw_and_coverage(self):
        result = estimate(np.array([[1., 3., 4.], [16., 17., 18.], [3., 40., 40.]]),
                          np.array([200., 300., 400.]), np.array([200., 200., 200.]),
                          np.array([10., 20., 25.]), False)
        self.assertTrue(10 < result[0] < 13)
        self.assertTrue(np.isnan(result[1:]).all())
        distance = distances(np.array([11.]), np.array([46.]), np.array([11., 12.]), np.array([46., 46.]))
        np.testing.assert_allclose(distance, [[0, 77.24]], atol=.1)

    def test_elevation_regression_and_guard(self):
        z = np.arange(8) * 200 + 200
        d = np.tile(np.arange(1., 9.), (2, 1))
        result = estimate(d, z, np.array([1200., 3000.]), 20 - .006 * z, True)
        np.testing.assert_allclose(result, [12.8, np.nan])

    def test_signed_raster_and_missingness(self):
        actual = np.frombuffer(base64.b64decode(encoded(np.array([-7.1, np.nan, 11.8, 40000]))), dtype="<i2")
        np.testing.assert_array_equal(actual, [-7, -32768, 12, 32767])

    def test_default_rain_peaks_keep_the_earliest_window_and_skip_incomplete_cells(self):
        data = np.array([[10, 0, 2], [4, 0, np.nan], [10, 0, 2], [1, 0, 0]])
        values, peaks = rain_peak(data, 2)
        np.testing.assert_allclose(values, [14, 0, np.nan])
        np.testing.assert_array_equal(peaks, [1, -1, -1])

    def test_seasonal_extreme_periods(self):
        self.assertEqual(spring(date(2026, 1, 1)), (date(2025, 3, 1), date(2025, 5, 31)))
        self.assertEqual(spring(date(2026, 3, 31)), (date(2026, 3, 1), date(2026, 3, 31)))
        self.assertEqual(summer(date(2026, 11, 23)), (date(2026, 6, 1), date(2026, 8, 31)))
        self.assertEqual(summer(date(2026, 7, 1)), (date(2026, 6, 1), date(2026, 7, 1)))

    def test_held_out_error_does_not_include_target(self):
        d = np.ones((4, 4)) - np.eye(4)
        self.assertEqual(held_out_error(d, np.zeros(4), {0: 0., 1: 0., 2: 0., 3: 12.}, False),
                         {"n": 4, "mae": 6.})


if __name__ == "__main__":
    unittest.main()
