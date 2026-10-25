"""公的な需給データ(JPX・日証金・EDINET)の置き場所と形式を調べる(取得の前の下調べ)。

ページのリンクを読み、Excel・CSV・PDF などのファイルの URL とリンクの文字を一覧にして出す。
robots.txt(RFC 9309)に従い、1.5 秒以上の間隔を空ける。保存はしない。

  python scripts/inst_probe.py            # 一覧を出す
  python scripts/inst_probe.py --sample   # 見つけたファイルを各1つ取り、先頭の行を表示する
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stock_archive import Fetcher  # noqa: E402

START = {
    "jpx": ("https://www.jpx.co.jp", [
        "/markets/public/short-selling/index.html",            # 空売り残高(0.5% 以上の報告)
        "/markets/statistics-equities/short-selling/index.html",  # 業種別 空売り比率
        "/markets/statistics-equities/arbitrage/index.html",   # 裁定取引残高
        "/markets/statistics-equities/margin/index.html",      # 信用取引残高(市場全体・週次)
    ]),
    "jsf": ("https://www.taisyaku.jp", ["/", "/data/", "/search/"]),  # 日本証券金融(貸借残高・品貸料)
}
FILE_RE = re.compile(r"\.(xls|xlsx|csv|zip|pdf|txt)(\?|$)", re.I)
SUB_RE = re.compile(r"short|karauri|arbitrage|margin|zandaka|taisyaku|hinkashi|shina|balance|data|download|list|search|statistics|00-archives", re.I)


def links(html: str, base: str) -> list[tuple[str, str]]:
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"#]+)"[^>]*>(.*?)</a>', html, re.I | re.S):
        href = urllib.parse.urljoin(base, m.group(1))
        text = re.sub(r"<[^>]+>", " ", m.group(2))
        out.append((href, re.sub(r"\s+", " ", text).strip()[:80]))
    return out


def sample_file(f: Fetcher, url: str) -> None:
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "stock-rank-archiver (+https://github.com/closeAI-astra/stock_rank)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            print(f"    -> HTTP {r.status} {len(raw)} bytes {r.headers.get('Content-Type')}")
    except Exception as e:  # noqa: BLE001
        print(f"    -> 取得失敗 {e}")
        return
    ext = url.lower().split("?")[0].rsplit(".", 1)[-1]
    try:
        if ext == "csv" or ext == "txt":
            for enc in ("utf-8-sig", "cp932"):
                try:
                    text = raw.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue
            for line in text.splitlines()[:12]:
                print("      |", line[:200])
        elif ext in ("xls", "xlsx"):
            import pandas as pd
            sheets = pd.read_excel(io.BytesIO(raw), sheet_name=None, header=None, engine=None if ext == "xlsx" else "xlrd")
            for name, df in list(sheets.items())[:3]:
                print(f"      [sheet {name}] {df.shape}")
                for row in df.head(14).itertuples(index=False):
                    cells = ["" if (isinstance(c, float) and c != c) else str(c) for c in row]
                    print("      |", " | ".join(cells)[:240])
        elif ext == "zip":
            import zipfile
            z = zipfile.ZipFile(io.BytesIO(raw))
            print("      zip:", z.namelist()[:10])
    except Exception as e:  # noqa: BLE001
        print(f"      読めませんでした: {e}")


def probe_edinet(key: str, sample: bool) -> None:
    import urllib.request
    import datetime as dt
    print("\n===== EDINET API v2")
    day = dt.date.today()
    for back in range(1, 8):
        d = day - dt.timedelta(days=back)
        url = f"https://api.edinet-fsa.go.jp/api/v2/documents.json?date={d}&type=2&Subscription-Key={urllib.parse.quote(key)}"
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"  {d}: 失敗 {e}")
            continue
        res = data.get("results") or []
        print(f"  {d}: {data.get('metadata', {}).get('status')} {len(res)}件")
        by = {}
        for x in res:
            by.setdefault(x.get("docTypeCode"), []).append(x)
        for code in ("350", "360", "220", "230"):
            for x in by.get(code, [])[:2]:
                print("   ", code, json.dumps({k: x.get(k) for k in ("docID", "secCode", "edinetCode", "filerName", "issuerEdinetCode", "subjectEdinetCode", "docDescription", "submitDateTime", "csvFlag", "xbrlFlag")}, ensure_ascii=False))
        if sample and by.get("350"):
            x = by["350"][0]
            url = f"https://api.edinet-fsa.go.jp/api/v2/documents/{x['docID']}?type=5&Subscription-Key={urllib.parse.quote(key)}"
            try:
                import zipfile
                with urllib.request.urlopen(url, timeout=60) as r:
                    z = zipfile.ZipFile(io.BytesIO(r.read()))
                print("    csv zip:", z.namelist())
                for n in z.namelist():
                    if n.endswith(".csv"):
                        text = z.read(n).decode("utf-16", errors="replace")
                        for line in text.splitlines()[:60]:
                            if re.search(r"Holding|Ratio|保有|割合|株券|Name|氏名|名称|Issuer|発行者", line):
                                print("      |", line[:220])
                        break
            except Exception as e:  # noqa: BLE001
                print("    csv 取得失敗", e)
        if res:
            break


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", action="store_true")
    ap.add_argument("--only", default="")
    opts = ap.parse_args()
    for name, (base, paths) in START.items():
        if opts.only and name not in opts.only.split(","):
            continue
        print(f"\n===== {name} {base}")
        f = Fetcher(1.5, base)
        seen_pages, files = set(), {}
        queue = [(base + p, 0) for p in paths]
        while queue and len(seen_pages) < 25:
            url, depth = queue.pop(0)
            if url in seen_pages:
                continue
            seen_pages.add(url)
            st, html, final = f.get(url)
            print(f"\n--- {url} -> HTTP {st} {len(html)} chars")
            if st != 200:
                continue
            title = re.search(r"<title>(.*?)</title>", html, re.S)
            print("    title:", re.sub(r"\s+", " ", title.group(1)).strip()[:100] if title else "")
            for href, text in links(html, final):
                if not href.startswith(base):
                    continue
                if FILE_RE.search(href):
                    if href not in files:
                        files[href] = text
                        print(f"    FILE {href}  [{text}]")
                elif depth < 1 and SUB_RE.search(href) and href not in seen_pages and len(queue) < 40:
                    queue.append((href, depth + 1))
        print(f"\n  {name}: ページ {len(seen_pages)} / ファイル {len(files)}")
        if opts.sample:
            done = set()
            for href in files:
                ext = href.lower().split("?")[0].rsplit(".", 1)[-1]
                key = (re.sub(r"\d{6,8}", "N", href.rsplit("/", 1)[-1]), ext)
                if key in done or ext == "pdf" or len(done) >= 8:
                    continue
                done.add(key)
                print(f"\n  SAMPLE {href}")
                sample_file(f, href)
    key = os.environ.get("EDINET_API_KEY", "").strip()
    if key and (not opts.only or "edinet" in opts.only):
        probe_edinet(key, opts.sample)
    elif not key:
        print("\n===== EDINET API v2: EDINET_API_KEY が無いので飛ばしました")
    return 0


if __name__ == "__main__":
    sys.exit(main())
