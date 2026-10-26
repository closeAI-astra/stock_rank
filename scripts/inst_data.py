"""公的な需給データを取得して、暗号化して data/inst/ に保存する(Future Sight と同じ鍵)。

  JPX          空売り残高の報告(発行済の 0.5% 以上)・業種別空売り比率・裁定取引残高・信用取引残高(東証全体)
  日本証券金融 貸借取引残高(融資・貸株)・品貸料(逆日歩)
  EDINET       大量保有報告書(5% ルール)・自己株券買付状況報告書(API キー EDINET_API_KEY が要る)

保存先:
  data/inst/stocks/{コード}.json.enc  {shorts, lending, large, buyback, updatedAt}
  data/inst/market.json.enc           {shortRatio, arbitrage, margin, updatedAt}
  data/inst/index.json.enc            取得済みのファイル・日付(続きから取るため)

対象は Future Sight(stockAI)の銘柄。robots.txt(RFC 9309)に従い、リクエストの間隔を空ける。

  FS_PAGES_PASSWORD=... EDINET_API_KEY=... python scripts/inst_data.py [--only jpx,jsf,edinet] [--edinet-days 365]
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fs_crypto import FSData, decrypt_json, encrypt_json  # noqa: E402
from stock_archive import UA, Fetcher  # noqa: E402

JST = dt.timezone(dt.timedelta(hours=9))


def now_iso() -> str:
    return dt.datetime.now(JST).isoformat(timespec="seconds")


def num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)
    s = str(v).strip().replace(",", "").replace("，", "").replace("▲", "-").replace("△", "-").replace("%", "").replace("％", "")
    if s in ("", "-", "－", "—", "nan", "None"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def iso(v) -> str | None:
    """日付らしい値を YYYY-MM-DD に(Excel の日付・2026/10/23・20261023・令和なし)。"""
    if v is None:
        return None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.strftime("%Y-%m-%d")
    if hasattr(v, "strftime"):
        try:
            return v.strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            pass
    s = str(v).strip()
    m = re.match(r"^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", s.split(".")[0])
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


class Store:
    """暗号化した JSON の読み書き(無ければ既定値)。"""

    def __init__(self, root: Path, key: bytes):
        self.root, self.key = root, key
        self.dirty: dict[str, object] = {}

    def load(self, name: str, default):
        if name in self.dirty:
            return self.dirty[name]
        p = self.root / f"{name}.json.enc"
        val = decrypt_json(p.read_bytes(), self.key) if p.exists() else default
        self.dirty[name] = val
        return val

    def save_all(self) -> int:
        for name, val in self.dirty.items():
            p = self.root / f"{name}.json.enc"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(encrypt_json(val, self.key))
        n = len(self.dirty)
        self.dirty = {}
        return n


def stock_doc(store: Store, code: str) -> dict:
    return store.load(f"stocks/{code}", {"shorts": [], "lending": [], "large": [], "buyback": []})


def merge_rows(old: list[dict], new: list[dict], key) -> list[dict]:
    """同じ key の行は新しい方で置き換え、日付順に並べる。"""
    by = {key(r): r for r in old}
    for r in new:
        by[key(r)] = r
    return sorted(by.values(), key=lambda r: (r.get("date") or "", json.dumps(r, ensure_ascii=False)))


# =====================================================================
# EDINET(API v2)
# =====================================================================
EDINET_API = "https://api.edinet-fsa.go.jp/api/v2"
DOC_LARGE = {"350", "360"}   # 大量保有報告書・その訂正
DOC_BUYBACK = {"220", "230"}  # 自己株券買付状況報告書・その訂正


def edinet_get(path: str, key: str, params: dict, binary: bool = False, tries: int = 4):
    q = urllib.parse.urlencode({**params, "Subscription-Key": key})
    url = f"{EDINET_API}/{path}?{q}"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read()
                return raw if binary else json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(10 * (i + 1))
                continue
            raise
        except Exception:  # noqa: BLE001
            if i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise
    return None


def parse_large_csv(raw: bytes) -> dict:
    """大量保有報告書の XBRL を CSV にしたもの(type=5)から、保有割合・直前の割合・保有目的を取り出す。"""
    out = {"ratio": None, "prevRatio": None, "purpose": None}
    z = zipfile.ZipFile(io.BytesIO(raw))
    ratios, prevs = [], []
    for name in z.namelist():
        if not name.lower().endswith(".csv"):
            continue
        text = z.read(name).decode("utf-16", errors="replace")
        for line in text.splitlines():
            cells = [c.strip().strip('"') for c in line.split("\t")]
            if len(cells) < 9:
                continue
            elem, value = cells[0], cells[-1]
            if elem.endswith("HoldingRatioOfShareCertificatesEtcPerLastReport"):
                v = num(value)
                if v is not None:
                    prevs.append(v)
            elif elem.endswith("HoldingRatioOfShareCertificatesEtc") or elem.endswith("TotalHoldingRatioOfShareCertificatesEtc"):
                v = num(value)
                if v is not None:
                    ratios.append((elem.endswith("TotalHoldingRatioOfShareCertificatesEtc"), v))
            elif elem.endswith("PurposeOfHolding") and value and not out["purpose"]:
                out["purpose"] = value[:120]
    pct = lambda v: v * 100 if v is not None and v <= 1 else v  # noqa: E731
    if ratios:
        total = [v for is_total, v in ratios if is_total]
        out["ratio"] = pct(max(total) if total else max(v for _, v in ratios))
    if prevs:
        out["prevRatio"] = pct(max(prevs))
    return out


def run_edinet(store: Store, index: dict, universe: dict, opts) -> dict:
    key = os.environ.get("EDINET_API_KEY", "").strip()
    if not key:
        print("EDINET: EDINET_API_KEY が無いので飛ばします(EDINET の API キーを Secrets に登録すると取得します)")
        return {"status": "skipped", "reason": "no key"}
    by_edinet = {v["edinet"]: code for code, v in universe.items() if v.get("edinet")}
    by_sec = {code + "0": code for code in universe}  # EDINET の証券コードは 5 桁(末尾 0)
    today = dt.datetime.now(JST).date()
    last = index.get("edinetLastDate")
    start = (dt.date.fromisoformat(last) - dt.timedelta(days=3)) if last else today - dt.timedelta(days=opts.edinet_days)
    days = [start + dt.timedelta(days=i) for i in range((today - start).days + 1)]
    n_large = n_bb = 0
    deadline = time.time() + opts.max_minutes * 60
    for day in days:
        if time.time() > deadline:
            print("EDINET: 時間切れ。続きは次回")
            break
        try:
            data = edinet_get("documents.json", key, {"date": day.isoformat(), "type": 2})
        except Exception as e:  # noqa: BLE001
            print(f"EDINET {day}: 一覧の取得に失敗 {e}")
            break
        if str((data or {}).get("metadata", {}).get("status")) not in ("200", "None"):
            print(f"EDINET {day}: {data.get('metadata')}")
            if str(data.get("metadata", {}).get("status")) in ("401", "403"):
                return {"status": "failed", "reason": "API キーが無効"}
        res = (data or {}).get("results") or []
        for x in res:
            t = x.get("docTypeCode")
            if x.get("withdrawalStatus") not in (None, "0") or x.get("disclosureStatus") not in (None, "0"):
                continue
            date = (x.get("submitDateTime") or day.isoformat())[:10]
            if t in DOC_LARGE:
                code = by_edinet.get(x.get("issuerEdinetCode") or "")
                if not code:
                    continue
                row = {"date": date, "filer": x.get("filerName"), "docID": x.get("docID"), "desc": x.get("docDescription"), "ratio": None, "prevRatio": None, "purpose": None}
                if x.get("csvFlag") == "1":
                    try:
                        time.sleep(0.6)
                        row.update(parse_large_csv(edinet_get(f"documents/{x['docID']}", key, {"type": 5}, binary=True)))
                    except Exception as e:  # noqa: BLE001
                        print(f"  {x.get('docID')}: CSV の取得に失敗 {e}")
                doc = stock_doc(store, code)
                doc["large"] = merge_rows(doc["large"], [row], lambda r: r.get("docID"))
                n_large += 1
            elif t in DOC_BUYBACK:
                code = by_sec.get(x.get("secCode") or "") or by_edinet.get(x.get("edinetCode") or "")
                if not code:
                    continue
                doc = stock_doc(store, code)
                doc["buyback"] = merge_rows(doc["buyback"], [{"date": date, "docID": x.get("docID"), "desc": x.get("docDescription"), "filer": x.get("filerName")}], lambda r: r.get("docID"))
                n_bb += 1
        index["edinetLastDate"] = day.isoformat()
        time.sleep(0.4)
    print(f"EDINET: 大量保有 {n_large}件 · 自己株買付 {n_bb}件({days[0]}〜{index.get('edinetLastDate')})")
    return {"status": "ok", "large": n_large, "buyback": n_bb}


# =====================================================================
# JPX・日証金(ページのリンクからファイルを探して読む)
# =====================================================================
def page_files(f: Fetcher, url: str, pattern: str) -> list[tuple[str, str]]:
    st, html, final = f.get(url)
    if st != 200:
        print(f"  {url}: HTTP {st}")
        return []
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"#]+)"[^>]*>(.*?)</a>', html, re.I | re.S):
        href = urllib.parse.urljoin(final, m.group(1))
        if re.search(pattern, href, re.I):
            out.append((href, re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip()))
    return list(dict.fromkeys(out))


def fetch_bytes(f: Fetcher, url: str) -> bytes | None:
    if not f.allowed(url):
        print(f"  robots.txt で禁止: {url}")
        return None
    wait = f.delay - (time.time() - f.last)
    if wait > 0:
        time.sleep(wait)
    f.last = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.read()
    except Exception as e:  # noqa: BLE001
        print(f"  取得失敗 {url}: {e}")
        return None


def read_table(raw: bytes, url: str) -> list[list]:
    """Excel・CSV を行のリストに(シートは全部つなぐ)。"""
    ext = url.lower().split("?")[0].rsplit(".", 1)[-1]
    if ext in ("csv", "txt"):
        for enc in ("utf-8-sig", "cp932", "shift_jis"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        import csv
        return [row for row in csv.reader(io.StringIO(text))]
    import pandas as pd
    sheets = pd.read_excel(io.BytesIO(raw), sheet_name=None, header=None, engine="xlrd" if ext == "xls" else None)
    rows = []
    for df in sheets.values():
        for r in df.itertuples(index=False):
            rows.append([None if (isinstance(c, float) and c != c) else c for c in r])
    return rows


def find_header(rows: list[list], *must: str) -> tuple[int, list[str]] | None:
    for i, r in enumerate(rows[:40]):
        cells = [re.sub(r"\s+", "", str(c or "")) for c in r]
        joined = "|".join(cells)
        if all(m in joined for m in must):
            return i, cells
    return None


def col(headers: list[str], *keys: str, exclude: tuple[str, ...] = ()) -> int | None:
    for k in keys:
        for i, h in enumerate(headers):
            if k in h and not any(x in h for x in exclude):
                return i
    return None


# ---------- JPX: 空売り残高の報告(日次の Excel。一覧ページに直近約3週間分) ----------
JPX = "https://www.jpx.co.jp"
JPX_SHORT_PAGE = JPX + "/markets/public/short-selling/index.html"
JPX_PROGRAM_PAGE = JPX + "/markets/statistics-equities/program/index.html"
JPX_SHORT_RATIO_PAGE = JPX + "/markets/statistics-equities/short-selling/index.html"


def parse_short_positions(rows: list[list]) -> list[dict]:
    h = find_header(rows, "計算年月日", "銘柄コード")
    if not h:
        raise ValueError("空売り残高のファイルに見出し(計算年月日・銘柄コード)がありません")
    i0, head = h
    c_date, c_code = col(head, "計算年月日"), col(head, "銘柄コード")
    c_holder = col(head, "商号・名称・氏名")
    c_client = col(head, "委託者・投資一任契約の相手方の商号", exclude=("住所",))
    c_fund = col(head, "信託財産・運用財産の名称")
    c_ratio, c_qty = col(head, "空売り残高割合", exclude=("直近",)), col(head, "空売り残高数量")
    c_prev_date, c_prev_ratio = col(head, "直近計算年月日"), col(head, "直近空売り残高割合")
    out = []
    for r in rows[i0 + 1:]:
        if c_code is None or c_code >= len(r):
            continue
        code = str(r[c_code] or "").strip().split(".")[0]
        date = iso(r[c_date]) if c_date is not None else None
        if not re.match(r"^[0-9][0-9A-Z]{3}$", code) or not date:
            continue
        cell = lambda c: (str(r[c]).strip() if c is not None and c < len(r) and r[c] is not None else "")  # noqa: E731
        ratio, prev = num(r[c_ratio]) if c_ratio is not None else None, num(r[c_prev_ratio]) if c_prev_ratio is not None else None
        out.append({
            "code": code, "date": date, "holder": cell(c_holder), "client": cell(c_client) or None, "fund": cell(c_fund) or None,
            "ratio": None if ratio is None else round(ratio * 100, 4), "shares": num(r[c_qty]) if c_qty is not None else None,
            "prevDate": iso(r[c_prev_date]) if c_prev_date is not None else None, "prevRatio": None if prev is None else round(prev * 100, 4),
        })
    return out


def run_jpx_short(f: Fetcher, store: Store, index: dict, universe: dict) -> dict:
    files = [u for u, _ in page_files(f, JPX_SHORT_PAGE, r"_Short_Positions\.xlsx?$")]
    done = set(index.get("jpxShortFiles", []))
    new = [u for u in files if u not in done]
    n = 0
    for u in sorted(new):
        raw = fetch_bytes(f, u)
        if raw is None:
            continue
        try:
            rows = parse_short_positions(read_table(raw, u))
        except Exception as e:  # noqa: BLE001
            print(f"  {u}: 読めませんでした {e}")
            continue
        by = {}
        for r in rows:
            if r["code"] in universe:
                by.setdefault(r.pop("code"), []).append(r)
        for code, items in by.items():
            doc = stock_doc(store, code)
            doc["shorts"] = merge_rows(doc["shorts"], items, lambda r: (r["date"], r["holder"], r.get("client") or "", r.get("fund") or ""))
            n += len(items)
        done.add(u)
        print(f"  {u.rsplit('/', 1)[-1]}: {len(rows)}行(対象銘柄 {sum(len(v) for v in by.values())}行)")
    index["jpxShortFiles"] = sorted(done)[-400:]
    return {"status": "ok", "files": len(new), "rows": n}


# ---------- JPX: 空売り比率(日次の PDF)・裁定取引残高(日次の Excel) ----------
SR_LINE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日\s+([\d,]+)\s+([\d.]+)%\s+([\d,]+)\s+([\d.]+)%\s+([\d,]+)\s+([\d.]+)%\s+([\d,]+)")
SECTOR_LINE = re.compile(r"^(\S+?)\s+([\d,]+)\s+([\d.]+)%\s+([\d,]+)\s+([\d.]+)%\s+([\d,]+)\s+([\d.]+)%\s+([\d,]+)\s*$")


def pdf_text(raw: bytes) -> str:
    from pypdf import PdfReader
    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages)


def parse_short_ratio(text: str) -> list[dict]:
    """空売り集計(日次)の PDF: 年月日 実注文 比率 空売り(価格規制あり) 比率 空売り(価格規制なし) 比率 合計(百万円)"""
    out = []
    for m in SR_LINE.finditer(text):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        real, restricted, unrestricted, total = (num(m.group(i)) for i in (4, 6, 8, 10))
        if not total:
            continue
        out.append({"date": f"{y}-{mo:02d}-{d:02d}", "ratio": round((restricted + unrestricted) / total, 5), "restrictedShare": round(restricted / total, 5),
                    "real": real, "restricted": restricted, "unrestricted": unrestricted, "total": total})
    return out


def parse_short_sectors(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        m = SECTOR_LINE.match(line.strip())
        if m and not re.match(r"^\d{4}年", m.group(1)):
            restricted, unrestricted, total = num(m.group(4)), num(m.group(6)), num(m.group(8))
            if total:
                out.append({"sector": m.group(1), "ratio": round((restricted + unrestricted) / total, 5), "total": total})
    return out


def parse_arbitrage(rows: list[list]) -> dict | None:
    """裁定取引に係る現物ポジション(千株・百万円)。売り・買いそれぞれの合計を取る。"""
    pub = None
    for r in rows[:8]:
        for c in r:
            m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", str(c or ""))
            if m:
                pub = (int(m.group(1)), int(m.group(2)))
                break
        if pub:
            break
    out = {"date": None, "sell": None, "buy": None, "sellAmount": None, "buyAmount": None}
    in_pos = False
    for r in rows:
        line = "".join(str(c or "") for c in r)
        if "現物ポジション" in line and "（" in line:
            m = re.search(r"(\d{1,2})月(\d{1,2})日現在", line)
            if m and pub:
                y = pub[0] - (1 if int(m.group(1)) > pub[1] else 0)
                out["date"] = f"{y}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
            in_pos = True
            continue
        if not in_pos:
            continue
        label = re.sub(r"\s|　", "", "".join(str(c or "") for c in r[:4]))
        nums = [num(c) for c in r[3:] if num(c) is not None]
        if "前日比" in line or len(nums) < 6:
            continue
        if label.startswith("株数") and out["buy"] is None:
            out["sell"], out["buy"] = nums[2], nums[5]
        elif label.startswith("金額") and out["buyAmount"] is None:
            out["sellAmount"], out["buyAmount"] = nums[2], nums[5]
        if re.match(r"^[３3]．", label):
            break
    return out if out["date"] and out["buy"] is not None else None


def run_jpx_market(f: Fetcher, store: Store, index: dict) -> dict:
    market = store.load("market", {})
    res = {}
    # 空売り比率(-m.pdf = 市場全体、-g.pdf = 業種別)
    done = set(index.get("jpxShortRatioFiles", []))
    files = [u for u, _ in page_files(f, JPX_SHORT_RATIO_PAGE, r"/\d{6}-[mg]\.pdf$")]
    sr, sectors = market.get("shortRatio", []), market.get("shortSectors", {})
    for u in sorted(x for x in files if x not in done):
        raw = fetch_bytes(f, u)
        if raw is None:
            continue
        try:
            text = pdf_text(raw)
        except Exception as e:  # noqa: BLE001
            print(f"  {u}: PDF を読めませんでした {e}")
            continue
        if u.endswith("-m.pdf"):
            rows = parse_short_ratio(text)
            sr = merge_rows(sr, rows, lambda r: r["date"])
            got = ", ".join("{} {:.1%}".format(r["date"], r["ratio"]) for r in rows) or "読み取れず"
            print(f"  {u.rsplit('/', 1)[-1]}: {got}")
        else:
            m = re.search(r"/(\d{2})(\d{2})(\d{2})-g\.pdf$", u)
            rows = parse_short_sectors(text)
            if m and rows:
                sectors[f"20{m.group(1)}-{m.group(2)}-{m.group(3)}"] = {r["sector"]: r["ratio"] for r in rows}
            print(f"  {u.rsplit('/', 1)[-1]}: 業種 {len(rows)}")
        done.add(u)
    market["shortRatio"] = sr
    market["shortSectors"] = dict(sorted(sectors.items())[-260:])
    index["jpxShortRatioFiles"] = sorted(done)[-800:]
    res["shortRatio"] = len(sr)
    # 裁定取引残高
    done = set(index.get("jpxArbFiles", []))
    files = [u for u, _ in page_files(f, JPX_PROGRAM_PAGE, r"/\d{6}\.xlsx?$")]
    arb = market.get("arbitrage", [])
    for u in sorted(x for x in files if x not in done):
        raw = fetch_bytes(f, u)
        if raw is None:
            continue
        try:
            row = parse_arbitrage(read_table(raw, u))
        except Exception as e:  # noqa: BLE001
            print(f"  {u}: 読めませんでした {e}")
            continue
        if row:
            arb = merge_rows(arb, [row], lambda r: r["date"])
            print(f"  {u.rsplit('/', 1)[-1]}: {row['date']} 買い {row['buy']} / 売り {row['sell']}(千株)")
        else:
            print(f"  {u.rsplit('/', 1)[-1]}: 現物ポジションを読み取れませんでした")
        done.add(u)
    market["arbitrage"] = arb
    market["arbitrageUnit"] = "千株"
    index["jpxArbFiles"] = sorted(done)[-800:]
    market["updatedAt"] = now_iso()
    res["arbitrage"] = len(arb)
    return {"status": "ok", **res}


# ---------- JPX: 投資部門別 株式売買状況(週次の Excel。一覧には直近約5週分) ----------
JPX_INVESTOR_PAGE = JPX + "/markets/statistics-equities/investor-type/index.html"


def _ja(label) -> str:
    """「海外投資家 Foreigners」→「海外投資家」"""
    s = str(label or "").replace("\n", " ").strip()
    return re.split(r"\s+[A-Za-z]", s)[0].strip() if s else ""


def parse_investor(rows: list[list], week_end: str) -> dict | None:
    """週の投資部門別売買(二市場 = 東証 + 名証)の金額。各部門の 売り・買い・差引(億円)。"""
    h = next((i for i, r in enumerate(rows[:30]) if "年月週" in str(r[0] if r else "")), None)
    if h is None or h < 4:
        return None
    width = max(len(r) for r in rows[h - 4:h + 1])
    def ffill(r):
        out, cur = [], ""
        for i in range(width):
            v = r[i] if i < len(r) else None
            if v not in (None, "") and str(v).strip():
                cur = str(v)
            out.append(cur)
        return out
    # 見出しは4段: 自己/委託 → 部門(個人・海外投資家・法人…)→ 内訳 → 内訳の内訳(法人の金融機関など)
    top_kind, top, mid, sub = ffill(rows[h - 4]), ffill(rows[h - 3]), ffill(rows[h - 2]), ffill(rows[h - 1])
    # 二市場の金額の行
    target = None
    for i in range(h + 1, len(rows)):
        r = rows[i]
        if any("二市場" in str(c or "") for c in r[:3]):
            for j in range(i, min(i + 3, len(rows))):
                if "金額" in str(rows[j][2] if len(rows[j]) > 2 else ""):
                    target = rows[j]
                    break
            break
    if not target:
        return None
    groups = []
    for start in range(3, width - 2, 4):
        sell, buy, net = (num(target[start + k]) if start + k < len(target) else None for k in range(3))
        if sell is None and buy is None:
            continue
        groups.append({"kind": _ja(top_kind[start]), "top": _ja(top[start]), "mid": _ja(mid[start]), "sub": _ja(sub[start]), "sell": None if sell is None else round(sell / 1e5, 2),
                       "buy": None if buy is None else round(buy / 1e5, 2), "net": None if net is None else round(net / 1e5, 2)})
    if not groups:
        return None
    # 部門ごとの差引。法人は内訳に小計が混ざることがあるので足さず、内訳(投資信託・事業法人・信託銀行…)を別に持つ
    totals, subs = {}, {}
    for g in groups:
        if g["net"] is None or not g["top"]:
            continue
        if g["top"] == "法人":
            subs.setdefault(g["sub"] or g["mid"], g["net"])
        elif g["top"] not in ("合計", "総計", "委託計"):
            totals[g["top"]] = round(totals.get(g["top"], 0) + g["net"], 2)
            if g["top"] == "個人" and g["sub"]:
                subs.setdefault(f"個人({g['sub'].replace('取引', '')})", g["net"])
    return {"weekEnd": week_end, "unit": "億円", "groups": groups, "totals": totals, "subs": subs}


def run_jpx_investor(f: Fetcher, store: Store, index: dict) -> dict:
    market = store.load("market", {})
    done = set(index.get("jpxInvestorFiles", []))
    files = [u for u, _ in page_files(f, JPX_INVESTOR_PAGE, r"stock_1_w_\d{8}_\d{8}\.xlsx?$")]
    weeks = market.get("investor", [])
    for u in sorted(x for x in files if x not in done):
        m = re.search(r"_(\d{4})(\d{2})(\d{2})\.xlsx?$", u)
        raw = fetch_bytes(f, u)
        if raw is None or not m:
            continue
        try:
            row = parse_investor(read_table(raw, u), f"{m.group(1)}-{m.group(2)}-{m.group(3)}")
        except Exception as e:  # noqa: BLE001
            print(f"  {u}: 読めませんでした {e}")
            continue
        if row:
            weeks = merge_rows(weeks, [row], lambda r: r["weekEnd"])
            print(f"  {u.rsplit('/', 1)[-1]}: " + ", ".join(f"{k} {v:+.0f}" for k, v in row["totals"].items()))
        else:
            print(f"  {u.rsplit('/', 1)[-1]}: 読み取れませんでした")
        done.add(u)
    market["investor"] = sorted(weeks, key=lambda r: r["weekEnd"])
    index["jpxInvestorFiles"] = sorted(done)[-600:]
    return {"status": "ok", "weeks": len(market["investor"])}


# ---------- JPX: 信用取引現在高(東証・名証の全体。過去推移表は 2002 年から週次、04.html は直近の週) ----------
JPX_MARGIN_NOW_PAGE = JPX + "/markets/statistics-equities/margin/04.html"
JPX_MARGIN_HIST_PAGE = JPX + "/markets/statistics-equities/margin/05.html"


def _margin_row(date: str, sell, buy, sell_amt=None, buy_amt=None, **extra) -> dict:
    k = lambda v, m: None if v is None else round(v * m)  # noqa: E731
    row = {"date": date, "sell": k(sell, 1000), "buy": k(buy, 1000), "sellAmount": k(sell_amt, 1e6), "buyAmount": k(buy_amt, 1e6)}
    row.update({key: k(v, 1000 if key.endswith("Shares") else 1e6) for key, v in extra.items()})
    row["ratio"] = round(row["buy"] / row["sell"], 4) if row["buy"] and row["sell"] else None
    return row


def parse_margin_history(rows: list[list]) -> list[dict]:
    """信用取引現在高(一般信用取引・制度信用取引別)の過去推移。[東京・名古屋] の段の週ごとの行(千株・百万円)。"""
    out, on = [], False
    for r in rows:
        first = str(r[0] if r else "")
        if first.startswith("["):
            on = "東京・名古屋" in first or "Tokyo & Nagoya" in first
            continue
        date = iso(r[0]) if on and r else None
        if not date:
            continue
        v = [num(c) for c in r[1:13]] + [None] * 12
        if v[0] is None and v[2] is None:
            continue
        out.append(_margin_row(date, v[0], v[2], v[1], v[3], sellNegShares=v[4], sellStdShares=v[6], buyNegShares=v[8], buyStdShares=v[10],
                               buyNegAmount=v[9], buyStdAmount=v[11]))
    return out


def parse_margin_current(rows: list[list]) -> dict | None:
    """週の信用取引現在高(二市場)。制度(自己・委託)・一般(委託)の株数と金額、合計の株数。"""
    date = None
    for r in rows[:4]:
        for c in r:
            if iso(c):
                date = iso(c)
                break
        if date:
            break
    if not date:
        return None
    section = ""
    sh = {"buy": 0.0, "sell": 0.0}; amt = {"buy": 0.0, "sell": 0.0}; std_buy = neg_buy = 0.0
    total = None
    for r in rows:
        cells = [str(c or "") for c in r]
        if len(cells) < 8:
            continue
        if cells[1].strip():
            section = cells[1]
        kind = cells[3] or cells[2]
        sell, buy = num(r[4]), num(r[6])
        if sell is None and buy is None:
            continue
        if "合計" in section:
            if "株数" in kind:
                total = (sell, buy)
                break  # 合計より下は別の表(貸借取引など)なので足さない
            continue
        if "制度" not in section and "一般" not in section:
            continue
        if "株数" in kind:
            sh["sell"] += sell or 0; sh["buy"] += buy or 0
            if "制度" in section:
                std_buy += buy or 0
            elif "一般" in section:
                neg_buy += buy or 0
        elif "金額" in kind:
            amt["sell"] += sell or 0; amt["buy"] += buy or 0
    if not total and not sh["buy"]:
        return None
    sell, buy = total if total else (sh["sell"], sh["buy"])
    return _margin_row(date, sell, buy, amt["sell"] or None, amt["buy"] or None, buyStdShares=std_buy or None, buyNegShares=neg_buy or None)


def run_jpx_margin(f: Fetcher, store: Store, index: dict) -> dict:
    market = store.load("market", {})
    rows = market.get("margin", [])
    done = set(index.get("jpxMarginFiles", []))
    if index.get("jpxMarginVersion") != 2:
        # v1 は週次ファイルの金額に別の表の行まで足していたので、全部読み直す
        rows, done = [], set()
        index["jpxMarginVersion"] = 2
    for page, pat, parser in ((JPX_MARGIN_HIST_PAGE, r"_mtgk\.xlsx?$", parse_margin_history), (JPX_MARGIN_NOW_PAGE, r"_mtcurrent\.xlsx?$", parse_margin_current)):
        for u in sorted(x for x, _ in page_files(f, page, pat) if x not in done):
            raw = fetch_bytes(f, u)
            if raw is None:
                continue
            try:
                got = parser(read_table(raw, u))
            except Exception as e:  # noqa: BLE001
                print(f"  {u}: 読めませんでした {e}")
                continue
            got = got if isinstance(got, list) else ([got] if got else [])
            # 週次の速報(mtcurrent)は過去推移表より新しいので後から重ねる。同じ日は値のある項目だけ上書き
            by = {r["date"]: r for r in rows}
            for r in got:
                old = by.get(r["date"], {})
                by[r["date"]] = {**old, **{k: v for k, v in r.items() if v is not None}}
            rows = sorted(by.values(), key=lambda r: r["date"])
            print(f"  {u.rsplit('/', 1)[-1]}: {len(got)}週" + (f"({got[0]['date']}〜{got[-1]['date']})" if got else ""))
            done.add(u)
    market["margin"] = rows
    market["marginSource"] = "JPX 信用取引現在高(東京・名古屋)"
    index["jpxMarginFiles"] = sorted(done)[-400:]
    return {"status": "ok", "weeks": len(rows)}


# ---------- 日証金: 貸借取引残高・品貸料・制限措置(その日の CSV。毎日取って積み増す) ----------
JSF = "https://www.taisyaku.jp"


def csv_rows(raw: bytes) -> list[list[str]]:
    import csv
    for enc in ("cp932", "utf-8-sig", "shift_jis"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return [row for row in csv.reader(io.StringIO(text))]


def parse_zandaka(rows: list[list[str]]) -> list[dict]:
    h = find_header(rows, "申込日", "銘柄コード", "融資残高株数")
    if not h:
        raise ValueError("zandaka.csv に見出しがありません")
    i0, head = h
    c = {k: col(head, k) for k in ("申込日", "銘柄コード", "取引所区分名", "速報／確報", "融資新規株数", "融資返済株数", "融資残高株数", "貸株新規株数", "貸株返済株数", "貸株残高株数", "差引残高株数")}
    out = []
    for r in rows[i0 + 1:]:
        g = lambda k: (r[c[k]] if c[k] is not None and c[k] < len(r) else None)  # noqa: E731
        code, date = str(g("銘柄コード") or "").strip(), iso(g("申込日"))
        if not code or not date or "東証" not in str(g("取引所区分名") or "東証"):
            continue
        loan, lend = num(g("融資残高株数")), num(g("貸株残高株数"))
        out.append({"code": code, "date": date, "kind": (g("速報／確報") or "").strip() or None, "loan": loan, "lend": lend, "net": num(g("差引残高株数")),
                    "loanNew": num(g("融資新規株数")), "loanRepay": num(g("融資返済株数")), "lendNew": num(g("貸株新規株数")), "lendRepay": num(g("貸株返済株数")),
                    "ratio": None if not loan or not lend else round(loan / lend, 4)})
    return out


def parse_shina(rows: list[list[str]]) -> list[dict]:
    h = find_header(rows, "貸借申込日", "コード", "当日品貸料率")
    if not h:
        raise ValueError("shina.csv に見出しがありません")
    i0, head = h
    c = {k: col(head, k) for k in ("貸借申込日", "コード", "取引所区分", "貸株超過株数", "最高料率", "当日品貸料率", "当日品貸日数", "前日品貸料率", "制限", "応札倍率ランク")}
    out = []
    for r in rows[i0 + 1:]:
        g = lambda k: (r[c[k]] if c[k] is not None and c[k] < len(r) else None)  # noqa: E731
        code, date = str(g("コード") or "").strip(), iso(g("貸借申込日"))
        if not code or not date or "東証" not in str(g("取引所区分") or "東証"):
            continue
        out.append({"code": code, "date": date, "excess": num(g("貸株超過株数")), "maxFee": num(g("最高料率")), "fee": num(g("当日品貸料率")),
                    "feeDays": num(g("当日品貸日数")), "prevFee": num(g("前日品貸料率")), "restrict": (g("制限") or "").strip() or None, "rank": (g("応札倍率ランク") or "").strip() or None})
    return out


def parse_seigen(rows: list[list[str]]) -> list[dict]:
    h = find_header(rows, "銘柄コード", "実施措置")
    if not h:
        return []
    i0, head = h
    c = {k: col(head, k) for k in ("銘柄コード", "実施措置", "実施内容", "通知日・実施日")}
    out = []
    for r in rows[i0 + 1:]:
        g = lambda k: (r[c[k]] if c[k] is not None and c[k] < len(r) else None)  # noqa: E731
        code = str(g("銘柄コード") or "").strip()
        if code:
            out.append({"code": code, "measure": g("実施措置"), "content": g("実施内容"), "date": iso(g("通知日・実施日"))})
    return out


def run_jsf(f: Fetcher, store: Store, index: dict, universe: dict) -> dict:
    got = {}
    for name in ("zandaka", "shina", "seigenichiran"):
        raw = fetch_bytes(f, f"{JSF}/data/{name}.csv")
        if raw is None:
            continue
        try:
            got[name] = {"zandaka": parse_zandaka, "shina": parse_shina, "seigenichiran": parse_seigen}[name](csv_rows(raw))
            print(f"  日証金 {name}.csv: {len(got[name])}行")
        except Exception as e:  # noqa: BLE001
            print(f"  日証金 {name}.csv: 読めませんでした {e}")
    if not got.get("zandaka"):
        return {"status": "failed"}
    fees = {(r["code"], r["date"]): r for r in got.get("shina", [])}
    restrict = {}
    for r in got.get("seigenichiran", []):
        restrict.setdefault(r.pop("code"), []).append(r)
    n = 0
    for r in got["zandaka"]:
        code = r.pop("code")
        if code not in universe:
            continue
        fee = fees.get((code, r["date"]))
        if fee:
            r.update({k: v for k, v in fee.items() if k not in ("code", "date")})
        doc = stock_doc(store, code)
        old = {x["date"]: x for x in doc["lending"]}
        if r["date"] in old and old[r["date"]].get("kind") == "確報" and r.get("kind") == "速報":
            continue  # 確報を速報で上書きしない
        doc["lending"] = merge_rows(doc["lending"], [r], lambda x: x["date"])
        doc["jsfRestrict"] = restrict.get(code, [])
        n += 1
    index["jsfLastDate"] = max(r["date"] for r in got["zandaka"]) if got["zandaka"] else index.get("jsfLastDate")
    return {"status": "ok", "rows": n, "date": index.get("jsfLastDate")}


# =====================================================================
def load_universe(fs: FSData) -> dict:
    """Future Sight の銘柄: {コード: {name, edinet}}"""
    dash = fs.json("dashboard")
    uni = {p["code"]: {"name": p.get("name"), "edinet": None} for p in dash.get("predictions", [])}
    idx = fs.json("stock-detail-index")
    for chunk in sorted(set(idx.values())):
        try:
            bundle = fs.json(f"stock-detail/{urllib.parse.quote(chunk)}")
        except Exception as e:  # noqa: BLE001
            print(f"  stock-detail/{chunk}: {e}")
            continue
        for code, d in bundle.items():
            sec = (d or {}).get("irbank", {}).get("security") or {}
            uni.setdefault(code, {"name": sec.get("name"), "edinet": None})["edinet"] = sec.get("edinet_code")
    return uni


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="jpx,jsf,edinet(空=全部)")
    ap.add_argument("--edinet-days", type=int, default=365, help="EDINET の初回にさかのぼる日数")
    ap.add_argument("--max-minutes", type=float, default=90)
    ap.add_argument("--delay", type=float, default=1.5)
    ap.add_argument("--out", default="data/inst")
    ap.add_argument("--fs-base", default="")
    opts = ap.parse_args()
    password = os.environ.get("FS_PAGES_PASSWORD", "")
    if not password:
        raise SystemExit("FS_PAGES_PASSWORD がありません")
    fs = FSData(password, opts.fs_base) if opts.fs_base else FSData(password)
    store = Store(Path(opts.out), fs.key)
    index = store.load("index", {})
    universe = load_universe(fs)
    print(f"対象 {len(universe)}銘柄(EDINET コードあり {sum(1 for v in universe.values() if v.get('edinet'))})")
    only = set(x for x in opts.only.split(",") if x)
    report = index.setdefault("runs", [])
    res = {"at": now_iso()}
    if not only or "jpx" in only:
        print("\n== JPX 空売り残高")
        f = Fetcher(opts.delay, JPX)
        res["jpxShort"] = run_jpx_short(f, store, index, universe)
        print("\n== JPX 市場(空売り比率・裁定取引)")
        res["jpxMarket"] = run_jpx_market(f, store, index)
        print("\n== JPX 信用取引現在高(市場全体)")
        res["jpxMargin"] = run_jpx_margin(f, store, index)
        print("\n== JPX 投資部門別売買")
        res["jpxInvestor"] = run_jpx_investor(f, store, index)
    if not only or "jsf" in only:
        print("\n== 日証金")
        res["jsf"] = run_jsf(Fetcher(opts.delay, JSF), store, index, universe)
    if not only or "edinet" in only:
        print("\n== EDINET")
        res["edinet"] = run_edinet(store, index, universe, opts)
    # 触った銘柄の更新時刻
    for name, val in list(store.dirty.items()):
        if name.startswith("stocks/") and isinstance(val, dict):
            val["updatedAt"] = res["at"]
    report.append(res)
    index["runs"] = report[-60:]
    index["updatedAt"] = res["at"]
    n = store.save_all()
    print(f"\n保存 {n}ファイル: {json.dumps(res, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
