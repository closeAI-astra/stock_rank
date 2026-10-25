"""テスト用: Future Sight と同じ形・同じ暗号形式の偽データを作る。

  python tests/make_mock.py OUT_DIR PASSWORD
  → OUT_DIR/enc-meta.json, OUT_DIR/data/*.json.enc (dashboard, chart-index, chart-chunks/, stock-detail-index, stock-detail/, field-catalog, macro, econ)

形は Future Sight の app.js が読んでいるキーに合わせている(値はすべて乱数)。
"""
import datetime as dt
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fs_crypto import encrypt_json, make_meta  # noqa: E402

out, password = Path(sys.argv[1]), sys.argv[2]
random.seed(7)
meta, key = make_meta(password, iterations=310000)
(out / "data" / "chart-chunks").mkdir(parents=True, exist_ok=True)
(out / "data" / "stock-detail").mkdir(parents=True, exist_ok=True)
(out / "enc-meta.json").write_text(json.dumps({**meta, "builtAt": "2026-10-25T09:00:00+00:00"}))


def w(name, obj):
    (out / "data" / f"{name}.json.enc").write_bytes(encrypt_json(obj, key))


STOCKS = [("7203", "トヨタ自動車", "輸送用機器"), ("6758", "ソニーグループ", "電気機器"), ("8035", "東京エレクトロン", "電気機器"), ("9984", "ソフトバンクグループ", "情報・通信業"),
          ("6857", "アドバンテスト", "電気機器"), ("8306", "三菱UFJフィナンシャル・グループ", "銀行業"), ("7011", "三菱重工業", "機械"), ("4063", "信越化学工業", "化学"),
          ("6920", "レーザーテック", "電気機器"), ("9432", "日本電信電話", "情報・通信業"), ("7974", "任天堂", "その他製品"), ("5401", "日本製鉄", "鉄鋼")]
END = dt.date(2026, 10, 23)


def bdays(start, end):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += dt.timedelta(days=1)


preds, chart_index, detail_index, chunks, dchunks = [], {}, {}, {}, {}
for k, (code, name, ind) in enumerate(STOCKS):
    p0 = random.uniform(800, 9000)
    days = list(bdays(dt.date(2023, 1, 4), END))
    split_day = dt.date(2025, 4, 1) if code == "6857" else None  # 1株→4株の分割(日足は調整済み・信用残は未調整)
    price, daily = p0, []
    for d in days:
        price *= math.exp(random.gauss(0.0004, 0.018))
        o = price * math.exp(random.gauss(0, 0.006)); c = price
        h = max(o, c) * (1 + abs(random.gauss(0, 0.008))); l = min(o, c) * (1 - abs(random.gauss(0, 0.008)))
        daily.append([d.isoformat(), round(o, 1), round(h, 1), round(l, 1), round(c, 1), int(random.uniform(2e5, 6e6))])
    weekly = []
    wp = daily[0][4]
    for i in range(260, 0, -1):
        wd = dt.date(2023, 1, 2) - dt.timedelta(weeks=i)
        wp_prev = wp
        wp = wp_prev * math.exp(random.gauss(0, 0.035))
        weekly.append([wd.isoformat(), round(wp_prev, 1), round(max(wp, wp_prev) * 1.02, 1), round(min(wp, wp_prev) * 0.98, 1), round(wp, 1), int(random.uniform(1e6, 2e7))])
    weekly.sort()
    close = daily[-1][4]
    periods = {}
    for h in [1, 3, 5, 10, 20, 60, 126, 180, 252]:
        r = random.gauss(0.002 * math.sqrt(h), 0.02 * math.sqrt(h) / 3)
        sd = 0.015 * math.sqrt(h)
        models = {m: {"return": r + random.gauss(0, sd / 3), "price": None} for m in ["CURRENT", "GBM", "DNN"]}
        for m in models.values():
            m["price"] = close * (1 + m["return"])
        periods[str(h)] = {"return": r, "price": close * (1 + r), "low68": close * (1 + r - sd), "high68": close * (1 + r + sd), "low90": close * (1 + r - 1.65 * sd), "high90": close * (1 + r + 1.65 * sd),
                           "adopted": random.choice(["CURRENT", "GBM", "DNN"]), "models": models, "touchUp": random.random(), "touchDown": random.random(),
                           "claude": {"return": r * 1.1, "price": close * (1 + r * 1.1)} if h in (5, 20) else None}
    preds.append({"code": code, "name": name, "market": "プライム", "industry": ind, "close": close, "change1d": daily[-1][4] / daily[-2][4] - 1, "rank": k + 1, "volumeRank": k + 3, "periods": periods})
    ck, dk = f"c{k // 5:02d}", f"d{k // 5:02d}"
    chart_index[code] = ck
    detail_index[code] = dk
    chunks.setdefault(ck, {})[code] = {"d": daily, "w": weekly, "p": {}, "s": [[split_day.isoformat(), 4]] if split_day else []}
    # 信用残: 2024-01 から週次(金曜申込)、2026-09-25 からは日次
    credit, buy, sell = [], random.uniform(2e5, 4e6), random.uniform(5e4, 1.5e6)
    d = dt.date(2024, 1, 5)
    while d <= END:
        daily_mode = d >= dt.date(2026, 9, 25)
        if d.weekday() < 5 and (daily_mode or d.weekday() == 4):
            buy = max(1e4, buy * math.exp(random.gauss(0, 0.06))); sell = max(1e3, sell * math.exp(random.gauss(0, 0.08)))
            f = 4 if split_day and d >= split_day else 1
            b, s = round(buy) * f, round(sell) * f
            credit.append({"date": d.isoformat(), "buy": b, "sell": s, "ratio": round(b / s, 2), "availableFrom": (d + dt.timedelta(days=4 if not daily_mode else 1)).isoformat()})
        d += dt.timedelta(days=1)
    years = ["2019/03", "2020/03", "2021/03", "2022/03", "2023/03", "2024/03", "2025/03", "2026/03"]
    sales = random.uniform(5e11, 3e13)
    fin_vals = {"sales": [], "operating_profit": [], "ordinary_income": [], "net_income": [], "eps": [], "dps": [], "total_assets": [], "equity": []}
    for _ in years:
        sales *= random.uniform(0.95, 1.12); op = sales * random.uniform(0.05, 0.15)
        fin_vals["sales"].append(sales); fin_vals["operating_profit"].append(op); fin_vals["ordinary_income"].append(op * 1.05); fin_vals["net_income"].append(op * 0.7)
        fin_vals["eps"].append(op * 0.7 / 1e9); fin_vals["dps"].append(op * 0.2 / 1e9); fin_vals["total_assets"].append(sales * 1.4); fin_vals["equity"].append(sales * 0.6)
    annual = [{"period": f"{y[:4]}.{y[5:]}", "end": f"{y[:4]}-{y[5:]}-31", "sales": fin_vals["sales"][i] / 1e6, "op": fin_vals["operating_profit"][i] / 1e6, "ord": fin_vals["ordinary_income"][i] / 1e6, "net": fin_vals["net_income"][i] / 1e6, "eps": fin_vals["eps"][i], "dps": fin_vals["dps"][i], "announce": f"{y[:4]}-05-10", "acct": "IFRS"} for i, y in enumerate(years) if i >= 4]
    annual.append({"period": "2027.03", "end": "2027-03-31", "sales": annual[-1]["sales"] * 1.05, "op": annual[-1]["op"] * 1.08, "net": annual[-1]["net"] * 1.07, "eps": annual[-1]["eps"] * 1.07, "dps": annual[-1]["dps"] * 1.1, "forecast": True})
    quarter = [{"period": f"{2024 + (q + 1) // 4}.{['06', '09', '12', '03'][q % 4]}", "end": f"{2024 + (q + 1) // 4}-{['06', '09', '12', '03'][q % 4]}-28", "sales": annual[-2]["sales"] / 4 * random.uniform(.9, 1.1), "op": annual[-2]["op"] / 4 * random.uniform(.8, 1.2), "ord": annual[-2]["op"] / 4, "net": annual[-2]["net"] / 4, "eps": annual[-2]["eps"] / 4, "announce": "2026-08-01"} for q in range(9)]
    dchunks.setdefault(dk, {})[code] = {
        "credit": credit,
        "kabutan": {"annual": annual, "quarter": quarter, "q1cum": [{"period": "2026.06 Q1累計", "end": "2026-06-30", "sales": quarter[-1]["sales"], "op": quarter[-1]["op"], "progress": 24.5}], "half": [],
                    "balance": [{"period": "2026.06", "total_assets": fin_vals["total_assets"][-1] / 1e6, "equity": fin_vals["equity"][-1] / 1e6, "equity_ratio": 42.1, "bps": close * 0.8, "debt_ratio": 0.6, "announce": "2026-08-01"}]},
        "irbank": {
            "security": {"name": name, "market": "プライム", "industry": ind, "issued_shares": random.uniform(3e8, 3e9), "fiscal_year_end_month": 3, "listing_month": "1949-05", "edinet_code": f"E0{random.randint(1000, 9999)}"},
            "fin": {"periods": years, "values": fin_vals, "meta": [{"fy": y, "std": "IFRS"} for y in years]},
            "ind": {"periods": years, "values": {"roe": [random.uniform(5, 15) for _ in years], "operating_margin": [random.uniform(5, 15) for _ in years], "employees": [random.uniform(1e4, 3e5) for _ in years]}},
            "val": {"periods": years, "per5yAvg": random.uniform(10, 25), "values": {"stock_price": [close * random.uniform(.5, 1) for _ in years], "per": [random.uniform(8, 30) for _ in years], "market_cap": [close * 1e9 for _ in years]}},
            "div": [{"fiscal_year": y, "dps": fin_vals["dps"][i], "consecutive_dividend_increase_years": i, "doe": 2.1} for i, y in enumerate(years)],
            "seg": [{"fiscal_year": y, "segment_name": s, "revenue": fin_vals["sales"][i] * share, "operating_income": fin_vals["operating_profit"][i] * share, "revenue_share": share * 100, "yoy_growth": random.uniform(-5, 15)} for i, y in enumerate(years[-3:], start=5) for s, share in [("自動車", 0.7), ("金融", 0.2), ("その他", 0.1)]],
            "peers": [{"security_code": STOCKS[(k + 1) % len(STOCKS)][0], "name": STOCKS[(k + 1) % len(STOCKS)][1], "industry": STOCKS[(k + 1) % len(STOCKS)][2], "competition_reason": "主要事業が競合", "segments": ["事業A"]}],
        },
        "research": {"predictions": [[(END - dt.timedelta(days=7 * i)).isoformat(), 20, "GBM", random.gauss(0.01, 0.03), random.gauss(0.01, 0.03), random.gauss(0.01, 0.03), random.gauss(0.01, 0.03), random.gauss(0.01, 0.04) if i > 4 else None, close * random.uniform(.9, 1.1), 0.5, 0.4] for i in range(40)]},
    }

w("dashboard", {"asOf": "2026-10-23T15:30:00+09:00", "predictableCount": len(preds), "universeCount": len(preds), "predictions": preds, "news": []})
w("chart-index", chart_index)
w("stock-detail-index", detail_index)
for ck, v in chunks.items():
    (out / "data" / "chart-chunks" / f"{ck}.json.enc").write_bytes(encrypt_json(v, key))
for dk, v in dchunks.items():
    (out / "data" / "stock-detail" / f"{dk}.json.enc").write_bytes(encrypt_json(v, key))
w("field-catalog", {
    "fin": {"sales": {"label": "売上高", "unit": "jpy"}, "operating_profit": {"label": "営業利益", "unit": "jpy"}, "ordinary_income": {"label": "経常利益", "unit": "jpy"}, "net_income": {"label": "純利益", "unit": "jpy"}, "eps": {"label": "EPS", "unit": "jpy_per_share"}, "dps": {"label": "配当", "unit": "jpy_per_share"}, "total_assets": {"label": "総資産", "unit": "jpy"}, "equity": {"label": "純資産", "unit": "jpy"}},
    "finGroups": [{"id": "pl", "label": "損益計算書", "keys": ["sales", "operating_profit", "ordinary_income", "net_income", "eps", "dps"]}, {"id": "bs", "label": "貸借対照表", "keys": ["total_assets", "equity"]}],
    "ind": {"roe": {"label": "ROE", "unit": "percent", "category": "profitability"}, "operating_margin": {"label": "営業利益率", "unit": "percent", "category": "profitability"}, "employees": {"label": "従業員数", "unit": "people", "category": "human_capital"}},
    "indCategories": {"profitability": "収益性", "human_capital": "人的資本", "valuation": "株価"},
    "val": {"stock_price": {"label": "株価", "unit": "jpy_per_share"}, "per": {"label": "PER", "unit": "times"}, "market_cap": {"label": "時価総額", "unit": "jpy"}},
})
months = [f"{y}-{m:02d}" for y in range(2023, 2027) for m in range(1, 13)][:44]
def series(base):
    v, out_ = base, []
    for _ in months:
        v *= random.uniform(0.93, 1.08); out_.append(v)
    return out_
items = [("TOTAL", "総額", 80000), ("701", "自動車", 15000), ("70303", "半導体等電子部品", 5000), ("605", "鉄鋼", 3500), ("70107", "原動機", 2500)]
blocks = {flow: {area: [{"code": c, "name": n, "values": series(b * (0.9 if flow == "import" else 1) * (0.3 if area != "WORLD" else 1)), "yoy": random.uniform(-.1, .2), "yoy3m": random.uniform(-.1, .2)} for c, n, b in items] for area in ["WORLD", "US", "CN"]} for flow in ["export", "import"]}
weekly_pts = lambda b: [[(dt.date(2021, 10, 1) + dt.timedelta(weeks=i)).isoformat(), b * math.exp(random.gauss(0, 0.02) * math.sqrt(i + 1))] for i in range(260)]
w("macro", {"generatedAt": "2026-10-23T18:00:00+09:00",
            "trade": {"available": True, "months": months, "areas": {"WORLD": "世界", "US": "米国", "CN": "中国"}, "blocks": blocks, "notes": ["速報値は改定される。"], "source": "財務省 貿易統計", "fetchReport": {"fetchedAt": "2026-10-20T08:50:00+09:00", "note": "9月分は速報"}},
            "markets": [{"label": "ボラティリティ・金利", "items": [{"sym": "^VIX", "name": "VIX", "available": True, "last": 16.2, "date": "2026-10-22", "chg1": -0.02, "chg5": 0.05, "chg20": -0.1, "chg250": 0.1, "spark": [15, 16, 17, 16.2], "weekly": weekly_pts(16)}, {"sym": "JPY=X", "name": "ドル円", "available": True, "last": 151.2, "date": "2026-10-22", "chg1": 0.002, "chg20": 0.01, "chg250": 0.03, "spark": [148, 150, 151.2], "weekly": weekly_pts(150)}]}],
            "commodities": {"groups": [{"label": "エネルギー", "items": [{"sym": "CL=F", "name": "WTI原油", "available": True, "last": 72.1, "date": "2026-10-22", "chg1": 0.01, "chg20": -0.03, "chg250": -0.1, "spark": [75, 73, 72.1], "weekly": weekly_pts(75)}, {"sym": "NG=F", "name": "天然ガス", "available": False}]}]}})
lvl = lambda b: [[f"{m}-01", v] for m, v in zip(months, series(b))]
w("econ", {"categories": {"trade": "貿易・生産", "price": "物価"}, "series": [
    {"id": "kr_exports", "name": "韓国 輸出(前年比)", "cat": "trade", "catLabel": "貿易・生産", "available": True, "last": 58000, "prior": 55000, "date": "2026-09", "unit": "百万ドル", "transform": "yoy", "tName": "前年比", "tLast": 0.072, "spark": [1, 2, 3, 2, 4], "levelSeries": lvl(55000), "tSeries": [[f"{m}-01", random.uniform(-.1, .2)] for m in months], "measures": "韓国の月次輸出額。半導体の先行指標。", "why": "日本の半導体製造装置株と連動しやすい。", "jp": "東京エレクトロン、アドバンテスト", "source": "yahoo", "key": "KR_EXP"},
    {"id": "tsmc_rev", "name": "TSMC 月次売上", "cat": "trade", "catLabel": "貿易・生産", "available": True, "last": 300000, "date": "2026-09", "unit": "百万台湾ドル", "transform": "yoy", "tName": "前年比", "tLast": 0.31, "spark": [1, 3, 2, 5], "levelSeries": lvl(250000), "tSeries": [[f"{m}-01", random.uniform(0, .4)] for m in months], "source": "release"},
    {"id": "us_cpi", "name": "米 CPI", "cat": "price", "catLabel": "物価", "available": True, "last": 320.1, "date": "2026-09", "unit": "指数", "transform": "yoy", "tName": "前年比", "tLast": 0.028, "spark": [3, 2.9, 2.8], "levelSeries": lvl(300), "tSeries": [[f"{m}-01", random.uniform(.02, .04)] for m in months], "source": "fred", "key": "CPIAUCSL"},
    {"id": "jp_machine", "name": "工作機械受注", "cat": "trade", "catLabel": "貿易・生産", "available": False, "measures": "日本工作機械工業会の受注額。"},
], "regime": {"quadrant": "回復", "tilt": "景気敏感株", "growth": 0.4, "inflation": -0.2, "growthParts": [["a", "PMI", 0.5]], "inflationParts": [["b", "CPI", -0.2]]}, "releases": [{"name": "韓国 輸出", "period": "2026-09", "value": 7.2, "unit": "%", "prior": 5.1, "consensus": 6.0, "released_at": "2026-10-01"}]})
def index_points(base, start=dt.date(2020, 1, 6)):
    v, pts = base, []
    for d in bdays(start, END):
        o = v; v *= math.exp(random.gauss(0.0003, 0.012)); pts.append([d.isoformat(), round(o, 2), round(max(o, v) * 1.004, 2), round(min(o, v) * 0.996, 2), round(v, 2), random.randint(50_000_000, 200_000_000)])
    return pts
pages = []
for pid, sym, name, kind, base, tz in [("N225", "^N225", "日経平均", "日本株指数", 23000, "JP"), ("TPX", "^TPX", "TOPIX", "日本株指数", 1700, "JP"), ("GSPC", "^GSPC", "S&P 500", "米国株指数", 3200, "US")]:
    pts = index_points(base); last, prev = pts[-1][4], pts[-2][4]
    pages.append({"id": pid, "symbol": sym, "name": name, "kind": kind, "tz": tz, "points": pts,
                  "stats": {"last": last, "date": pts[-1][0], "prev": prev, "chg1d": last / prev - 1, "chg5d": 0.01, "chg20d": -0.02, "chg60d": 0.03, "chg250d": 0.2, "chgYtd": 0.15, "high52": last * 1.1, "low52": last * 0.8, "fromHigh52": -0.09, "fromPeak": -0.09, "vol20": 0.2, "vol60": 0.22, "vol250": 0.21, "atr14": last * 0.02, "rsi14": 45.0, "ma25dev": -0.01, "ma75dev": 0.02, "ma200dev": 0.05, "maxDd250": -0.15},
                  "seasonality": [{"month": m, "avg": random.gauss(0.01, 0.02), "win": random.random(), "n": 6} for m in range(1, 13)],
                  "corr60": {"TPX": 0.9, "GSPC": 0.3}, "corr250": {"TPX": 0.88, "GSPC": 0.35}, "ai": {"note": "使わない"}})
w("index-pages", {"generatedAt": "2026-10-25T22:00:00+09:00", "pages": pages})
wk = [d for d in bdays(dt.date(2025, 9, 5), END) if d.weekday() == 4]
w("market", {"generatedAt": "2026-10-25T22:00:00+09:00",
             "breadth": {"date": "2026-10-23", "n": 12, "advancers": 5, "decliners": 7, "above25": 0.4, "above75": 0.5, "above200": 0.6, "newHigh52": 1, "newLow52": 0, "medianChg20d": -0.01},
             "sectors": [{"industry": ind, "n": 2, "chg1d": random.gauss(0, 0.01), "chg5d": random.gauss(0, 0.02), "chg20d": random.gauss(0, 0.05), "above25": random.random()} for ind in sorted({x[2] for x in STOCKS})],
             "credit": [{"date": d.isoformat(), "week": d.isoformat(), "buy": 1.5e9 + i * 1e6, "sell": 3e8 - i * 1e6, "ratio": (1.5e9 + i * 1e6) / (3e8 - i * 1e6), "n": 12} for i, d in enumerate(wk)],
             "creditDaily": [{"date": d.isoformat(), "buy": 1.6e9, "sell": 2.7e8, "ratio": 5.9, "n": 12} for d in bdays(dt.date(2026, 9, 25), END)],
             "flows": {"weeks": [{"weekEnd": "2026-10-09", "availableFrom": "2026-10-16", "foreigners": -1234.5, "individuals": 987.0, "proprietary": 100.0, "total": -50.0, "totalValue": 900000.0}], "unit": "億円(差引き=買い−売り)", "source": "JPX 投資部門別"}})
print(f"mock data: {len(STOCKS)} stocks → {out}")
