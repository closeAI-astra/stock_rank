"""python -m unittest tests/test_irbank_parse.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import irbank_archive as ia  # noqa: E402
from fs_crypto import decrypt_json, encrypt_json, make_meta, check_key  # noqa: E402

MARGIN_HTML = """<html><head><title>トヨタ自動車 (7203) 信用残 - IR BANK</title></head><body>
<h2>信用残の推移</h2>
<table><thead><tr><th>日付</th><th>売残</th><th>売残増減</th><th>買残</th><th>買残増減</th><th>信用倍率</th></tr></thead>
<tbody>
<tr><td>2026/10/16</td><td>1,234,500</td><td>▲12,000</td><td>5,678,900</td><td>+3,400</td><td>4.60倍</td></tr>
<tr><td>2026/10/09</td><td>1,246,500</td><td>-</td><td>5,675,500</td><td>-</td><td>4.55</td></tr>
</tbody></table>
<a href="/7203/margin?y=2025">2025</a> <a href="/7203/short">空売り</a> <a href="https://example.com/x">外部</a>
</body></html>"""

MD_HTML = """<table><tr><th>申込日</th><th>買残</th><th>売残</th></tr>
<tr><td>1/9</td><td>10万</td><td>2万</td></tr><tr><td>12/26</td><td>9万</td><td>3万</td></tr></table>"""


class ParseTest(unittest.TestCase):
    def test_tables_and_links(self):
        p = ia.parse_html(MARGIN_HTML)
        self.assertIn("信用残", p["title"])
        self.assertEqual(len(p["tables"]), 1)
        t = p["tables"][0]
        self.assertEqual(t["title"], "信用残の推移")
        self.assertEqual(t["headers"][1], "売残")
        self.assertEqual(t["rows"][0][2], "▲12,000")
        self.assertEqual(ia.subpage_links(p["links"], "7203"), ["margin", "short"])
        self.assertEqual(ia.follow_links(p["links"], "7203", "margin", set()), ["https://irbank.net/7203/margin?y=2025"])

    def test_margin(self):
        m = ia.extract_margin(ia.parse_html(MARGIN_HTML)["tables"], 2026)
        self.assertEqual([r["date"] for r in m], ["2026-10-09", "2026-10-16"])
        self.assertEqual(m[1]["sell"], 1234500)
        self.assertEqual(m[1]["buy"], 5678900)
        self.assertAlmostEqual(m[1]["ratio"], 4.6)
        self.assertEqual(m[1]["extra"]["売残増減"], "▲12,000")

    def test_month_day_rollover(self):
        m = ia.extract_margin(ia.parse_html(MD_HTML)["tables"], 2026)
        self.assertEqual([(r["date"], r["buy"], r["sell"]) for r in m], [("2025-12-26", 90000, 30000), ("2026-01-09", 100000, 20000)])

    def test_num(self):
        self.assertEqual(ia.parse_num("▲1,200"), -1200)
        self.assertEqual(ia.parse_num("1.5億"), 1.5e8)
        self.assertIsNone(ia.parse_num("-"))
        self.assertEqual(ia.parse_num("-35"), -35)

    def test_crypto_roundtrip(self):
        meta, key = make_meta("pw", iterations=1000)
        self.assertTrue(check_key(meta, key))
        self.assertEqual(decrypt_json(encrypt_json({"a": "日本"}, key), key), {"a": "日本"})


if __name__ == "__main__":
    unittest.main()
