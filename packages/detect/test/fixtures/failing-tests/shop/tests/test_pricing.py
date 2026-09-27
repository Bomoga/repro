import unittest

from shop.pricing import discounted, with_tax


class PricingTest(unittest.TestCase):
    def test_tax(self):
        self.assertEqual(with_tax(10, 0.1), 11.0)

    def test_discount(self):
        self.assertEqual(discounted(200, 10), 180)
