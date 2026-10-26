"""python -m unittest tests/test_archive.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import stock_archive as ia  # noqa: E402
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
        irb = ia.IRBank("https://irbank.net")
        self.assertEqual([n for n, _ in irb.subpages("7203", p["links"], "full")], ["margin", "short"])
        self.assertEqual(irb.follow_links(p["links"], "https://irbank.net/7203/margin", set()), ["https://irbank.net/7203/margin?y=2025"])

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

    def test_kabutan(self):
        html = """<table><thead><tr><th>日付</th><th>終値</th><th>前週比</th><th>売り残</th><th>前週比</th><th>買い残</th><th>前週比</th><th>倍率</th></tr></thead>
        <tbody><tr><th>26/10/16</th><td>3,100</td><td>+1%</td><td>120,000</td><td>▲1,000</td><td>480,000</td><td>+2,000</td><td>4.00</td></tr>
        <tr><th>26/10/09</th><td>3,000</td><td>-1%</td><td>121,000</td><td>+500</td><td>478,000</td><td>-100</td><td>3.95</td></tr></tbody></table>
        <a href="?code=7203&ashi=shin&page=2">2</a><a href="/stock/kabuka?code=7203&ashi=day">日足</a><a href="/stock/finance?code=7203">決算</a><a href="/stock/news?code=7203">news</a>"""
        p = ia.parse_html(html)
        m = ia.extract_margin(p["tables"], 2026)
        self.assertEqual([(r["date"], r["sell"], r["buy"], r["ratio"]) for r in m], [("2026-10-09", 121000, 478000, 3.95), ("2026-10-16", 120000, 480000, 4.0)])
        self.assertEqual(m[1]["extra"]["終値"], "3,100")
        k = ia.Kabutan("https://kabutan.jp")
        self.assertEqual(k.follow_links(p["links"], k.margin_url("7203"), set()), ["https://kabutan.jp/stock/kabuka?code=7203&ashi=shin&page=2"])
        self.assertEqual([n for n, _ in k.subpages("7203", p["links"], "weekly")], ["margin", "finance"])
        self.assertEqual([n for n, _ in k.subpages("7203", p["links"], "full")], ["margin", "finance", "holder", "kabuka_day"])

    def test_market_pages(self):
        p = ia.parse_html("<a href='/market/margin'>信用残の推移</a><a href='/7203/margin'>信用残</a><a href='/stock/x?code=7203'>信用倍率</a><a href='/news'>ニュース</a><a href='https://other.example/m'>信用残</a>")
        self.assertEqual([(n, u) for n, u, _ in ia.IRBank("https://irbank.net").market_pages(p["anchors"], 10)], [("market_margin", "https://irbank.net/market/margin")])

    def test_irbank_edinet_pages(self):
        # データのページ(信用残・日証金・財務)だけを取り、開示書類・時価総額の推移・EDINET のトップなどは取らない
        p = ia.parse_html("<a href='/7203/margin'>m</a><a href='/7203/nisshokin'>n</a><a href='/7203/cap'>c</a><a href='/7203/140120181113436778'>doc</a><a href='/E02144/pl'>PL</a><a href='/E02144/tdnet'>t</a><a href='/E02144'>top</a>")
        self.assertEqual([n for n, _ in ia.IRBank("https://irbank.net").subpages("7203", p["links"], "full")], ["margin", "nisshokin", "E02144_pl"])

    def test_merge_margin(self):
        old = [{"date": "2026-01-02", "buy": 1}, {"date": "2026-01-09", "buy": 2}]
        new = [{"date": "2026-01-09", "buy": 3}, {"date": "2026-01-16", "buy": 4}]
        self.assertEqual([r["buy"] for r in ia.merge_margin(old, new)], [1, 3, 4])

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
