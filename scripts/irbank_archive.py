"""IRBANK の個別銘柄ページを取得して保存する(GitHub Actions 用)。

IRBANK が使えなくなる前に、stockAI(Future Sight)の対象銘柄について
  https://irbank.net/{コード}            … 銘柄トップ(ここから個別ページのリンクを集める)
  https://irbank.net/{コード}/margin など … 信用残・空売り・貸借などの個別ページ(リンクから自動で見つける)
を取得し、
  data/irbank/stocks/{コード}.json.enc … ページごとの表(見出し・行)と、信用残の正規化した履歴(date/buy/sell/ratio)
  data/irbank/index.json.enc           … 銘柄ごとの取得状況
を Future Sight と同じ鍵で暗号化して書く。生の HTML は --raw-out に暗号化した tar.gz でまとめる(Release に置く)。

・途中で止まっても、次の実行は未取得(または --refetch-days より古い)銘柄から再開する。
・取得に失敗した銘柄は、前回までに保存した良いデータを上書きしない(IRBANK が止まった後に実行しても壊れない)。
・robots.txt に従い、リクエストの間隔は --delay 秒(既定 1.5 秒)以上あける。

  FS_PAGES_PASSWORD=... python scripts/irbank_archive.py [--codes 7203,6758] [--max-minutes 300]
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import random
import re
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fs_crypto import FSData, decrypt_json, encrypt_bytes, encrypt_json  # noqa: E402

BASE = os.environ.get("IRBANK_BASE", "https://irbank.net")  # テストではローカルの偽サーバーに向ける
BASE_HOST = urllib.parse.urlparse(BASE).netloc
UA = "Mozilla/5.0 (compatible; stock-rank-archiver/1.0; +https://github.com/closeAI-astra/stock_rank)"
JST = dt.timezone(dt.timedelta(hours=9))
# 先に取るページ(信用残まわり)。見つかったその他のページはこの後に取る
PRIORITY = ["margin", "short", "lending", "kashikabu", "zandaka", "shinyo", "holder", "shareholder", "dividend", "results", "value"]
LABELS = {"margin": "信用残", "short": "空売り", "lending": "貸借取引", "holder": "大株主", "dividend": "配当", "results": "決算", "value": "株価指標", "top": "銘柄トップ"}
SKIP = {"login", "signup", "logout", "bookmark", "favorite", "rss", "search", "print"}


def now_iso() -> str:
    return dt.datetime.now(JST).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# HTML の表を取り出す(標準ライブラリだけ)
# ---------------------------------------------------------------------------
class TableParser(HTMLParser):
    """<table> を [{title, headers, rows}] に。title は直前の見出し(h1〜h4)か <caption>。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[dict] = []
        self.links: list[str] = []
        self.title = ""
        self._stack: list[dict] = []  # 入れ子の表に対応
        self._cell: list[str] | None = None
        self._cell_is_head = False
        self._row: list[tuple[str, bool]] | None = None
        self._heading: list[str] | None = None
        self._last_heading = ""
        self._in_title = False
        self._caption: list[str] | None = None
        self._skip = 0  # script/style

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "title":
            self._in_title = True
        elif tag in ("h1", "h2", "h3", "h4"):
            self._heading = []
        elif tag == "table":
            self._stack.append({"title": self._last_heading, "rows": [], "head": []})
        elif tag == "caption" and self._stack:
            self._caption = []
        elif tag == "tr" and self._stack:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
            self._cell_is_head = tag == "th"
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._skip = max(0, self._skip - 1)
        elif tag == "title":
            self._in_title = False
        elif tag in ("h1", "h2", "h3", "h4") and self._heading is not None:
            self._last_heading = clean("".join(self._heading))
            self._heading = None
        elif tag == "caption" and self._caption is not None:
            if self._stack:
                self._stack[-1]["title"] = clean("".join(self._caption))
            self._caption = None
        elif tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append((clean("".join(self._cell)), self._cell_is_head))
            self._cell = None
        elif tag == "tr" and self._row is not None and self._stack:
            if self._row:
                self._stack[-1]["rows"].append(self._row)
            self._row = None
        elif tag == "table" and self._stack:
            t = self._stack.pop()
            rows = t["rows"]
            headers: list[str] = []
            # 先頭の「全部 th」の行を見出しにする
            if rows and all(h for _, h in rows[0]):
                headers = [c for c, _ in rows[0]]
                rows = rows[1:]
            body = [[c for c, _ in r] for r in rows if any(c for c, _ in r)]
            if body or headers:
                self.tables.append({"title": t["title"], "headers": headers, "rows": body})

    def handle_data(self, data):
        if self._skip:
            return
        if self._in_title:
            self.title += data
        if self._heading is not None:
            self._heading.append(data)
        if self._caption is not None:
            self._caption.append(data)
        if self._cell is not None:
            self._cell.append(data)


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def parse_html(html: str) -> dict:
    p = TableParser()
    p.feed(html)
    p.close()
    return {"title": clean(p.title), "tables": p.tables, "links": p.links}


# ---------------------------------------------------------------------------
# 数値・日付
# ---------------------------------------------------------------------------
def parse_num(s) -> float | None:
    if s is None:
        return None
    t = str(s).strip().replace(",", "").replace("，", "").replace(" ", "")
    if t in ("", "-", "—", "－", "‐", "N/A", "--"):
        return None
    neg = t.startswith(("▲", "△", "-", "−", "－"))
    t = t.lstrip("▲△-−－+＋")
    mult = 1.0
    for suf, m in (("億", 1e8), ("万", 1e4), ("千", 1e3)):
        if suf in t:
            mult = m
            t = t.replace(suf, "")
    t = re.sub(r"(倍|%|％|株|円|口)$", "", t)
    m = re.match(r"^\d+(\.\d+)?", t)
    if not m:
        return None
    v = float(m.group(0)) * mult
    return -v if neg else v


DATE_PATTERNS = [
    (re.compile(r"(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})"), "ymd"),
    (re.compile(r"^(\d{2})[/.](\d{1,2})[/.](\d{1,2})$"), "yy"),
    (re.compile(r"^(\d{1,2})[/.月](\d{1,2})日?$"), "md"),
]


def parse_dates(cells: list[str], year_hint: int) -> list[str | None]:
    """日付の列を ISO にする。月日だけの表は、新しい順に並んでいる前提で年をさかのぼって補う。"""
    out: list[str | None] = []
    year = year_hint
    prev_month = None
    for c in cells:
        c = (c or "").strip()
        iso = None
        for rx, kind in DATE_PATTERNS:
            m = rx.search(c) if kind == "ymd" else rx.match(c)
            if not m:
                continue
            if kind == "ymd":
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                year = y
            elif kind == "yy":
                y, mo, d = 2000 + int(m.group(1)), int(m.group(2)), int(m.group(3))
                year = y
            else:
                mo, d = int(m.group(1)), int(m.group(2))
                if prev_month is not None and mo > prev_month:
                    year -= 1
                y = year
            prev_month = mo
            try:
                iso = dt.date(y, mo, d).isoformat()
            except ValueError:
                iso = None
            break
        out.append(iso)
    return out


def find_col(headers: list[str], include: tuple[str, ...], exclude: tuple[str, ...] = ("増減", "前週比", "前日比", "比較", "差")) -> int | None:
    for i, h in enumerate(headers):
        hh = h.replace(" ", "")
        if all(k in hh for k in include) and not any(x in hh for x in exclude):
            return i
    return None


def extract_margin(tables: list[dict], year_hint: int) -> list[dict]:
    """信用残の表(見出しに 売残/買残 を含む)を [{date, sell, buy, ratio, ...}] に正規化する。"""
    out: dict[str, dict] = {}
    for t in tables:
        h = t.get("headers") or []
        if not h and t["rows"]:
            h = t["rows"][0]
        joined = "".join(h)
        if not (("売" in joined and "買" in joined and "残" in joined) or "信用" in joined):
            continue
        sell = find_col(h, ("売", "残"))
        buy = find_col(h, ("買", "残"))
        if sell is None or buy is None:
            continue
        ratio = find_col(h, ("倍率",), ())
        date_col = find_col(h, ("日",), ("売", "買", "比", "倍")) or 0
        rows = t["rows"] if t.get("headers") else t["rows"][1:]
        dates = parse_dates([r[date_col] if date_col < len(r) else "" for r in rows], year_hint)
        for r, d in zip(rows, dates):
            if not d:
                continue
            rec = {"date": d, "sell": parse_num(r[sell]) if sell < len(r) else None, "buy": parse_num(r[buy]) if buy < len(r) else None}
            if ratio is not None and ratio < len(r):
                rec["ratio"] = parse_num(r[ratio])
            if rec["sell"] is None and rec["buy"] is None:
                continue
            # その他の列(増減・貸借の残など)も名前つきで残す
            extra = {h[i]: r[i] for i in range(min(len(h), len(r))) if i not in (date_col, sell, buy, ratio) and r[i]}
            if extra:
                rec["extra"] = extra
            out[d] = rec
    return [out[k] for k in sorted(out)]


# ---------------------------------------------------------------------------
# 取得
# ---------------------------------------------------------------------------
class Fetcher:
    def __init__(self, delay: float):
        self.delay = delay
        self.last = 0.0
        self.count = 0
        self.robots = urllib.robotparser.RobotFileParser()
        try:
            self.robots.set_url(BASE + "/robots.txt")
            self.robots.read()
        except Exception as e:  # robots が読めないときは控えめに進める
            print(f"robots.txt を読めませんでした: {e}", flush=True)
            self.robots = None

    def allowed(self, url: str) -> bool:
        return self.robots is None or self.robots.can_fetch(UA, url)

    def get(self, url: str) -> tuple[int, str, str]:
        """(status, html, 最終URL)。404 などは status で返し、通信エラーは status=0。"""
        if not self.allowed(url):
            return 999, "", url
        for attempt in range(4):
            wait = self.delay - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait + random.uniform(0, self.delay * 0.3))
            self.last = time.time()
            self.count += 1
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja,en;q=0.8"})
                with urllib.request.urlopen(req, timeout=40) as r:
                    raw = r.read()
                    charset = r.headers.get_content_charset() or "utf-8"
                    return r.status, raw.decode(charset, errors="replace"), r.geturl()
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                    retry = e.headers.get("Retry-After")
                    time.sleep(float(retry) if retry and retry.isdigit() else 10 * (attempt + 1))
                    continue
                return e.code, "", url
            except Exception as e:  # 通信エラー
                if attempt < 3:
                    time.sleep(5 * (attempt + 1))
                    continue
                print(f"  通信エラー {url}: {e}", flush=True)
                return 0, "", url
        return 0, "", url


def subpage_links(links: list[str], code: str) -> list[str]:
    names = []
    for href in links:
        u = urllib.parse.urlparse(urllib.parse.urljoin(BASE + "/", href))
        if u.netloc and u.netloc != BASE_HOST:
            continue
        m = re.match(rf"^/{re.escape(code)}/([A-Za-z0-9_\-]+)/?$", u.path)
        if m and m.group(1) not in SKIP and m.group(1) not in names:
            names.append(m.group(1))
    return sorted(names, key=lambda n: (PRIORITY.index(n) if n in PRIORITY else len(PRIORITY), n))


def follow_links(links: list[str], code: str, name: str, seen: set[str]) -> list[str]:
    """同じページの続き(?p=2 や /margin/2019 のような年・ページ送り)の URL。"""
    out = []
    for href in links:
        full = urllib.parse.urljoin(f"{BASE}/{code}/{name}", href)
        u = urllib.parse.urlparse(full)
        if u.netloc != BASE_HOST:
            continue
        path_ok = u.path.rstrip("/") == f"/{code}/{name}" and u.query
        sub_ok = re.match(rf"^/{re.escape(code)}/{re.escape(name)}/[0-9A-Za-z_\-]+/?$", u.path)
        if (path_ok or sub_ok) and full not in seen:
            seen.add(full)
            out.append(full)
    return out


def archive_stock(f: Fetcher, code: str, opts, raw: dict[str, bytes], year_hint: int) -> dict:
    pages = []
    status, html, final = f.get(f"{BASE}/{code}")
    if status != 200:
        return {"status": f"http_{status}", "pages": []}
    raw[f"{code}/top.html"] = html.encode("utf-8")
    top = parse_html(html)
    pages.append({"name": "top", "label": LABELS["top"], "url": final, "status": status, "title": top["title"], "tables": top["tables"]})
    names = subpage_links(top["links"], code)[: opts.max_subpages]
    margin_tables = []
    other_codes = sorted({m.group(1) for h in top["links"] for m in [re.match(r"^/(E\d{5})/", urllib.parse.urlparse(urllib.parse.urljoin(BASE + "/", h)).path)] if m})
    for name in names:
        url = f"{BASE}/{code}/{name}"
        st, body, fin = f.get(url)
        page = {"name": name, "label": LABELS.get(name, name), "url": fin, "status": st, "title": "", "tables": []}
        if st == 200:
            raw[f"{code}/{name}.html"] = body.encode("utf-8")
            parsed = parse_html(body)
            page["title"], page["tables"] = parsed["title"], parsed["tables"]
            seen = {url, fin}
            bodies = {hash(body)}  # ?p=1 のように最初のページと同じ中身は二重に持たない
            more = follow_links(parsed["links"], code, name, seen)[: opts.max_follow]
            for k, murl in enumerate(more):
                st2, body2, _ = f.get(murl)
                if st2 != 200 or hash(body2) in bodies:
                    continue
                bodies.add(hash(body2))
                raw[f"{code}/{name}__{k + 1}.html"] = body2.encode("utf-8")
                p2 = parse_html(body2)
                for t in p2["tables"]:
                    t["title"] = f"{t['title']} ({urllib.parse.urlparse(murl).query or urllib.parse.urlparse(murl).path.rsplit('/', 1)[-1]})".strip()
                page["tables"].extend(p2["tables"])
                more.extend(u for u in follow_links(p2["links"], code, name, seen) if len(more) < opts.max_follow)
            page["followed"] = len(more)
            if name in ("margin", "zandaka", "shinyo") or any("売残" in "".join(t.get("headers") or []) for t in page["tables"]):
                margin_tables.extend(page["tables"])
        pages.append(page)
    if not margin_tables:  # トップに信用残の表がある場合
        margin_tables = top["tables"]
    margin = extract_margin(margin_tables, year_hint)
    ok = any(p["status"] == 200 for p in pages)
    return {"status": "ok" if ok else "failed", "pages": pages, "margin": margin, "edinetCodes": other_codes}


# ---------------------------------------------------------------------------
# 本体
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--codes", default="", help="カンマ区切りの銘柄コード(空=Future Sight の全銘柄)")
    ap.add_argument("--max-minutes", type=float, default=300)
    ap.add_argument("--delay", type=float, default=1.5, help="リクエスト間隔(秒)")
    ap.add_argument("--max-subpages", type=int, default=40)
    ap.add_argument("--max-follow", type=int, default=40, help="1ページあたりの続き(ページ送り)の上限")
    ap.add_argument("--refetch-days", type=float, default=0, help="この日数より古い取得済み銘柄も取り直す(0=未取得だけ)")
    ap.add_argument("--out", default="data/irbank")
    ap.add_argument("--raw-out", default="", help="生 HTML の暗号化 tar.gz の出力先")
    ap.add_argument("--release-tag", default="")
    ap.add_argument("--fs-base", default=os.environ.get("FS_BASE", ""), help="Future Sight の配信元(既定は GitHub raw)")
    opts = ap.parse_args()

    password = os.environ.get("FS_PAGES_PASSWORD", "")
    if not password:
        print("::error::FS_PAGES_PASSWORD が未設定です。リポジトリの Settings → Secrets and variables → Actions に登録してください。")
        return 2
    fs = FSData(password, opts.fs_base) if opts.fs_base else FSData(password)
    key = fs.key
    out = Path(opts.out)
    (out / "stocks").mkdir(parents=True, exist_ok=True)
    index_path = out / "index.json.enc"
    index = decrypt_json(index_path.read_bytes(), key) if index_path.exists() else {"stocks": {}, "releases": []}
    index.setdefault("stocks", {})
    index.setdefault("releases", [])

    dash = fs.json("dashboard")
    names = {p["code"]: p.get("name", "") for p in dash.get("predictions", [])}
    if opts.codes.strip():
        codes = [c.strip() for c in opts.codes.split(",") if c.strip()]
    else:
        codes = sorted(set(fs.json("stock-detail-index").keys()) | set(names))
    cutoff = dt.datetime.now(JST) - dt.timedelta(days=opts.refetch_days) if opts.refetch_days > 0 else None

    def due(c: str) -> bool:
        s = index["stocks"].get(c)
        if not s or s.get("status") != "ok":
            return True
        if cutoff and s.get("fetchedAt"):
            return dt.datetime.fromisoformat(s["fetchedAt"]) < cutoff
        return bool(opts.codes.strip())  # 明示した銘柄は取り直す

    todo = [c for c in codes if due(c)]
    # 未取得 → 失敗 → 古い順
    todo.sort(key=lambda c: (c in index["stocks"], index["stocks"].get(c, {}).get("status") == "ok", index["stocks"].get(c, {}).get("fetchedAt", "")))
    print(f"対象 {len(codes)} 銘柄 / 今回 {len(todo)} 銘柄(間隔 {opts.delay}s・上限 {opts.max_minutes}分)", flush=True)

    f = Fetcher(opts.delay)
    if not f.allowed(f"{BASE}/7203/margin"):
        print("::warning::robots.txt が個別ページの取得を許可していません。取得できるページだけ進めます。")
    deadline = time.time() + opts.max_minutes * 60
    raw: dict[str, bytes] = {}
    year_hint = dt.datetime.now(JST).year
    done = failed = 0
    for i, code in enumerate(todo):
        if time.time() > deadline:
            print(f"時間切れ: 残り {len(todo) - i} 銘柄は次回", flush=True)
            break
        t0 = time.time()
        res = archive_stock(f, code, opts, raw, year_hint)
        prev = index["stocks"].get(code, {})
        if res["status"] == "ok":
            doc = {"code": code, "name": names.get(code, ""), "fetchedAt": now_iso(), "pages": res["pages"], "margin": res["margin"], "edinetCodes": res.get("edinetCodes", []), "release": opts.release_tag or None}
            (out / "stocks" / f"{code}.json.enc").write_bytes(encrypt_json(doc, key))
            m = res["margin"]
            index["stocks"][code] = {"status": "ok", "name": names.get(code, ""), "fetchedAt": doc["fetchedAt"], "marginRows": len(m), "marginFrom": m[0]["date"] if m else None, "marginTo": m[-1]["date"] if m else None, "pages": {p["name"]: p["status"] for p in res["pages"]}}
            done += 1
        else:
            failed += 1
            if prev.get("status") == "ok":
                prev["lastError"] = f"{res['status']} {now_iso()}"  # 良い保存データは残す
            else:
                index["stocks"][code] = {"status": res["status"], "name": names.get(code, ""), "fetchedAt": now_iso(), "pages": {}}
        m = res.get("margin") or []
        print(f"[{i + 1}/{len(todo)}] {code} {names.get(code, '')} {res['status']} pages={len(res['pages'])} 信用残={len(m)}回 {time.time() - t0:.0f}s", flush=True)
        if (i + 1) % 10 == 0:  # 途中経過も書いておく(強制終了に備える)
            index["updatedAt"] = now_iso()
            index_path.write_bytes(encrypt_json(index, key))
        if failed >= 15 and done == 0:
            print("::warning::連続して取得に失敗しています(IRBANK が応答しない可能性)。中断します。")
            break

    if raw and opts.raw_out:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for name, data in sorted(raw.items()):
                ti = tarfile.TarInfo(name)
                ti.size = len(data)
                ti.mtime = int(time.time())
                tar.addfile(ti, io.BytesIO(data))
        # tar.gz をさらに gzip+AES(ブラウザの復号と同じ形式。展開は scripts/decrypt_raw.py)
        Path(opts.raw_out).write_bytes(encrypt_bytes(buf.getvalue(), key))
        if opts.release_tag:
            index["releases"].append({"tag": opts.release_tag, "createdAt": now_iso(), "files": len(raw), "stocks": done})
    index["updatedAt"] = now_iso()
    index["requests"] = index.get("requests", 0) + f.count
    index_path.write_bytes(encrypt_json(index, key))
    total_ok = sum(1 for s in index["stocks"].values() if s.get("status") == "ok")
    print(f"完了: 今回 成功 {done} / 失敗 {failed} · 累計 {total_ok} 銘柄 · リクエスト {f.count} 回", flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### IRBANK archive\n\n- 今回: 成功 {done} / 失敗 {failed}\n- 累計: {total_ok}/{len(codes)} 銘柄\n- リクエスト: {f.count} 回\n- 未取得: {len([c for c in codes if index['stocks'].get(c, {}).get('status') != 'ok'])} 銘柄\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
