"""inst_data.py の取り出し(JPX・日証金・EDINET の実際のファイルの形をまねた行で確かめる)。"""
import datetime as dt
import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import inst_data as I  # noqa: E402


class InstTest(unittest.TestCase):
    def test_short_positions(self):
        rows = [[None] * 16, [None, None, "空売り残高に関する情報"], [None, None, "公表年月日\nDate of Disclosure", dt.datetime(2026, 10, 23)],
                [None, None, "計算年月日", "銘柄コード", "銘柄名\n（日本語／英語）", None, "商号・名称・氏名", "住所・所在地", "委託者・投資一任契約の相手方の商号・名称・氏名", "委託者・投資一任契約の相手方の住所・所在地", "信託財産・運用財産の名称", "空売り残高割合", "空売り残高数量", "空売り残高売買単位数", "直近計算年月日", "直近空売り残高割合", "備考"],
                [None, None, "Date of Calculation", "Code of Stock"],
                [None, None, dt.datetime(2026, 10, 21), 1407, "ウエスト", "West", "Barclays Capital Securities Ltd", "London", None, None, None, 0.0147, 677483, 6774, dt.datetime(2026, 10, 20), 0.0131, None],
                [None, None, dt.datetime(2026, 10, 21), "130A", "VIS", "VIS", "Arrowstreet Capital", "Boston", None, None, "Arrowstreet Global", 0.0052, 1000, 10, dt.datetime(2026, 10, 16), 0.005, None]]
        out = I.parse_short_positions(rows)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["code"], "1407"); self.assertEqual(out[0]["date"], "2026-10-21"); self.assertAlmostEqual(out[0]["ratio"], 1.47)
        self.assertEqual(out[0]["prevDate"], "2026-10-20"); self.assertAlmostEqual(out[0]["prevRatio"], 1.31)
        self.assertEqual(out[1]["fund"], "Arrowstreet Global")

    def test_zandaka_shina(self):
        z = [["申込日", "決済日", "銘柄コード", "銘柄名", "取引所区分名", "上場区分", "速報／確報", "融資新規株数", "融資返済株数", "融資残高株数", "貸株新規株数", "貸株返済株数", "貸株残高株数", "差引残高株数"],
             ["2026/10/22", "2026/10/26", "1301", "極洋", "東証およびＰＴＳ", "", "確報", "100", "100", "7200", "0", "0", "3600", "3600"]]
        r = I.parse_zandaka(z)[0]
        self.assertEqual((r["code"], r["date"], r["loan"], r["lend"], r["ratio"], r["kind"]), ("1301", "2026-10-22", 7200, 3600, 2.0, "確報"))
        sh = [["品貸料率一覧"], ["（注）"], ["抽出条件", "全体"], ["貸借申込日", "決済日", "コード", "銘柄名", "取引所区分", "決算事由", "決算等", "貸借値段（円）", "貸株超過株数", "最高料率（円）", "当日品貸料率（円）", "当日品貸日数", "前日品貸料率（円）", "備考", "制限", "応札倍率ランク"],
              ["20261022", "20261026", "1377", "サカタのタネ", "東証", "決算", "20261130", "4170.00", "1900", "8.40", "0.10", "1", "0.10", "", "", "F"],
              ["20261022", "20261026", "1301", "極洋", "東証", "決算", "20270331", "4505.00", "0", "9.20", "*****", "*****", "*****", "満額", "", ""]]
        out = I.parse_shina(sh)
        self.assertEqual(out[0]["fee"], 0.10); self.assertEqual(out[0]["date"], "2026-10-22"); self.assertIsNone(out[1]["fee"])

    def test_short_ratio_pdf_text(self):
        text = "空売り集計（日次）\n2026年10月23日 5,985,343 60.3% 3,107,814 31.3% 827,323 8.3% 9,920,480\n"
        r = I.parse_short_ratio(text)[0]
        self.assertEqual(r["date"], "2026-10-23"); self.assertAlmostEqual(r["ratio"], (3107814 + 827323) / 9920480, places=5)
        sec = I.parse_short_sectors("電気機器 2,165,426 60.8% 980,410 27.5% 416,289 11.7% 3,562,126\n証券、商品先物取引業 26,942 51.9% 23,213 44.7% 1,757 3.4% 51,913")
        self.assertEqual([s["sector"] for s in sec], ["電気機器", "証券、商品先物取引業"])

    def test_arbitrage(self):
        rows = [[None] * 15, [None, None, None, "裁定取引に係る現物株式の売買及び現物ポジション（全取引参加者報告合計）"],
                [None] * 13 + ["2026年10月23日"], [None] * 13 + ["株式会社東京証券取引所"],
                [None, None, None, "１．裁定取引に係る現物株式の売買（10月21日売買分）"], [None] * 5 + ["売　付　け", None, None, None, None, "買　付　け"],
                [None, None, None, "株　　数", None, 4863, None, None, None, None, 41495],
                [None, None, None, "２．裁定取引に係る現物ポジション（10月21日現在）", None, None, None, None, None, None, None, None, None, None, "（単位：千株）"],
                [None, None, None, None, None, "売りポジション（株数）", None, None, None, None, "買いポジション（株数）"],
                [None, None, None, None, None, "当限", "翌限以降", None, "合計", None, "当限", None, "翌限以降", None, "合計"],
                [None, None, None, "株　　数", None, 8033, 0, None, 8033, None, 842459, None, 2062, None, 844521],
                [None, None, None, None, "前日比", -4662, 0, None, -4662, None, 35839, None, 0, None, 35839]]
        r = I.parse_arbitrage(rows)
        self.assertEqual((r["date"], r["sell"], r["buy"]), ("2026-10-21", 8033, 844521))

    def test_large_csv(self):
        csv = "要素ID\t項目名\tコンテキストID\t相対年度\t連結・個別\t期間・時点\tユニットID\t単位\t値\n" \
              "jplvh_cor:HoldingRatioOfShareCertificatesEtc\t株券等保有割合\tFilingDateInstant\t提出日時点\tその他\t時点\tpure\t\t0.0634\n" \
              "jplvh_cor:HoldingRatioOfShareCertificatesEtcPerLastReport\t直前の報告書に記載された株券等保有割合\tFilingDateInstant\t提出日時点\tその他\t時点\tpure\t\t0.0512\n" \
              "jplvh_cor:PurposeOfHolding\t保有目的\tFilingDateInstant\t提出日時点\tその他\t時点\t\t\t純投資\n"
        buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w"); z.writestr("XBRL_TO_CSV/jplvh.csv", csv.encode("utf-16")); z.close()
        r = I.parse_large_csv(buf.getvalue())
        self.assertAlmostEqual(r["ratio"], 6.34); self.assertAlmostEqual(r["prevRatio"], 5.12); self.assertEqual(r["purpose"], "純投資")

    def test_merge_rows(self):
        out = I.merge_rows([{"date": "2026-01-02", "v": 1}], [{"date": "2026-01-02", "v": 2}, {"date": "2026-01-01", "v": 0}], lambda r: r["date"])
        self.assertEqual([r["v"] for r in out], [0, 2])


if __name__ == "__main__":
    unittest.main()


class JpxMarketTest(unittest.TestCase):
    def test_investor(self):
        E = None
        hdr = lambda cells: [E, E, E] + cells  # noqa: E731
        g = lambda name: [name, E, E, E]  # noqa: E731
        rows = [["投資部門別 株式売買状況 Stocks by Investor Type"], [],
                hdr(g("自己 Proprietary") * 0 + ["自己 Proprietary", E, E, E, E, E, E, E] + ["委託 Brokerage"] + [E] * 23),
                hdr(["自己 Proprietary"] + [E] * 7 + ["個人 Individuals"] + [E] * 7 + ["海外投資家 Foreigners "] + [E] * 7 + ["証券会社 Securities Cos."] + [E] * 3 + ["法人 Institutions"] + [E] * 3),
                hdr(g("現金取引 Cash") + g("信用取引 Margin") + g("現金取引 Cash") + g("信用取引 Margin") + g("法人 Institutions") + g("個人 Individuals") + g("証券会社 Securities Cos.") + g("投資信託 Investment Trusts")),
                hdr(g("現金取引 Cash") + g("信用取引 Margin") + g("現金取引 Cash") + g("信用取引 Margin") + g("法人 Institutions") + g("個人 Individuals") + g("証券会社 Securities Cos.") + g("投資信託 Investment Trusts")),
                ["年月週 Year, Month, Week", "市場／Market", "株数／金額"] + ["売 Sales", "買 Purchases", "差引 Balance", "合計 Total"] * 8,
                ["2026102", "二市場\nTokyo & Nagoya Markets", "株数 Shares"] + [1] * 32,
                [E, E, "金額 Value"] + [100e5, 150e5, 50e5, 250e5, 10e5, 0, -10e5, 10e5, 200e5, 100e5, -100e5, 300e5, 50e5, 80e5, 30e5, 130e5,
                                         300e5, 500e5, 200e5, 800e5, 5e5, 2e5, -3e5, 7e5, 9e5, 9e5, 0, 18e5, 40e5, 60e5, 20e5, 100e5]]
        r = I.parse_investor(rows, "2026-10-16")
        self.assertEqual(r["totals"]["自己"], 40.0)
        self.assertEqual(r["totals"]["個人"], -70.0)
        self.assertEqual(r["totals"]["海外投資家"], 197.0)
        self.assertEqual(r["subs"]["投資信託"], 20.0)
        self.assertEqual(r["subs"]["個人(信用)"], 30.0)

    def test_margin_history(self):
        rows = [["信用取引現在高（一般信用取引・制度信用取引別）"], [], [],
                ["[東京・名古屋 Tokyo & Nagoya]"],
                [dt.datetime(2002, 8, 2), 1254269, 1004839, 2615658, 1570284, 115172, 91766, 1139097, 913073, 362, 133, 2615296, 1570151],
                ["[東京 Tokyo]"],
                [dt.datetime(2002, 8, 2), 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]]
        out = I.parse_margin_history(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual((out[0]["date"], out[0]["sell"], out[0]["buy"]), ("2002-08-02", 1254269000, 2615658000))
        self.assertEqual(out[0]["buyAmount"], 1570284 * 10 ** 6); self.assertEqual(out[0]["buyStdShares"], 2615296000)

    def test_margin_current(self):
        E = None
        rows = [[E, E, dt.datetime(2026, 10, 9)], [E, E, dt.datetime(2026, 10, 9), dt.datetime(2026, 10, 9)], [E, E, dt.datetime(2026, 10, 14)],
                [E, E, E, E, "二市場 Tokyo&Nagoya"],
                [E, "制度信用取引残高", "自己", "株数Shs.", 76217, -3701, 1590, 495, 76216, -3701, 1590, 495],
                [E, E, E, "金額Val.", 101813, -4716, 2164, 411, 0, 0, 0, 0],
                [E, E, "委託", "株数Shs.", 207494, 10413, 1819931, 36991, 0, 0, 0, 0],
                [E, E, E, "金額Val.", 447137, -4092, 3671626, 116298, 0, 0, 0, 0],
                [E, "一般信用取引残高", "委託", "株数Shs.", 83193, 5805, 2009099, 27562, 0, 0, 0, 0],
                [E, E, E, "金額Val.", 213102, 20134, 3034267, 67796, 0, 0, 0, 0],
                [E, "信用取引残高合計", E, "株数Shs.", 366905, 12518, 3830621, 65049, 0, 0, 0, 0],
                [E, E, E, "金額Val.", 999999, 0, 9999999, 0, 0, 0, 0, 0],
                [E, "貸借取引残高", E, "金額Val.", 888888, 0, 8888888, 0, 0, 0, 0, 0]]
        r = I.parse_margin_current(rows)
        self.assertEqual((r["date"], r["sell"], r["buy"]), ("2026-10-09", 366905000, 3830621000))
        self.assertEqual(r["buyAmount"], (2164 + 3671626 + 3034267) * 10 ** 6)
        self.assertEqual(r["buyStdShares"], (1590 + 1819931) * 1000); self.assertEqual(r["buyNegShares"], 2009099 * 1000)
