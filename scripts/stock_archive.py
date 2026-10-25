"""株探・IRBANK の個別銘柄ページを取得して保存する(GitHub Actions 用)。

取得元(--source):
  kabutan … これからの定期取得の本線。毎週、信用残(https://kabutan.jp/stock/kabuka?code={コード}&ashi=shin)・
             決算(https://kabutan.jp/stock/finance?code={コード}、業績・配当)・銘柄トップを取り、信用残の履歴を週ごとに
             積み増す。--mode full で大株主など銘柄トップからリンクされたページと、
             信用残の過去ページ(ページ送り)もまとめて取る(初回の取り込み用)。
  irbank  … IRBANK が使えなくなる前の一度きりの保存。銘柄トップ(https://irbank.net/{コード})のリンクから
             信用残・空売り・貸借などの個別ページを自動で見つけて全部取る。全銘柄そろったら、それ以上は取りに行かない。

stockAI(Future Sight)の対象銘柄について、
  data/{source}/stocks/{コード}.json.enc … ページごとの表(見出し・行)と、信用残の正規化した履歴(date/buy/sell/ratio)
  data/{source}/index.json.enc           … 銘柄ごとの取得状況
を Future Sight と同じ鍵で暗号化して書く。生の HTML は --raw-out に暗号化した tar.gz でまとめる(Release に置く)。

・途中で止まっても、次の実行は未取得(または --refetch-days より古い)銘柄から再開する。
・信用残の履歴は前回までの保存分と日付で合わせて積み増す(週次の取得で 1 ページ目しか取らなくても履歴が伸びる)。
・取得に失敗した銘柄は、前回までに保存した良いデータを上書きしない(取得元が止まった後に実行しても壊れない)。
・robots.txt に従い、リクエストの間隔は --delay 秒(既定 1.5 秒)以上あける。

  FS_PAGES_PASSWORD=... python scripts/stock_archive.py --source kabutan [--mode weekly|full] [--codes 7203,6758]
  FS_PAGES_PASSWORD=... python scripts/stock_archive.py --source irbank
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

UA = "Mozilla/5.0 (compatible; stock-rank-archiver/1.0; +https://github.com/closeAI-astra/stock_rank)"
JST = dt.timezone(dt.timedelta(hours=9))
# 市場全体のページ(東証全体の信用残・空売り・投資部門別など)を、トップページのリンクの文字で探す
MARKET_RE = re.compile(r"信用(残|取引|倍率|評価)|空売り|貸借|裁定|投資部門|売買動向|騰落")
# ページ送りとみなすクエリ(これ以外が違うリンクは別ページ)
PAGING_KEYS = {"page", "p", "pg", "y", "year"}
GIVE_UP_AFTER = 3  # 見つからない銘柄(上場廃止など)は3回失敗したら定期実行では諦める


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
        self.anchors: list[tuple[str, str]] = []  # (href, リンクの文字)。市場全体のページを文字で探すのに使う
        self._anchor: list[str] | None = None
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
            self._anchor = [a["href"], ""]
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
        if tag == "a" and self._anchor is not None:
            self.anchors.append((self._anchor[0], clean(self._anchor[1])))
            self._anchor = None
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
        if self._anchor is not None:
            self._anchor[1] += data
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
    return {"title": clean(p.title), "tables": p.tables, "links": p.links, "anchors": p.anchors}


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
# 取得元ごとの違い(ページの場所・ページ送り)
# ---------------------------------------------------------------------------
class Source:
    name = ""
    label = ""
    default_base = ""
    labels: dict[str, str] = {}

    def __init__(self, base: str | None = None):
        self.base = (base or os.environ.get(f"{self.name.upper()}_BASE") or self.default_base).rstrip("/")
        self.host = urllib.parse.urlparse(self.base).netloc

    def top_url(self, code: str) -> str:
        raise NotImplementedError

    def subpages(self, code: str, links: list[str], mode: str) -> list[tuple[str, str]]:
        """[(ページ名, URL)]。先に取るべきもの(信用残)から並べる。"""
        raise NotImplementedError

    def market_pages(self, anchors: list[tuple[str, str]], limit: int) -> list[tuple[str, str, str]]:
        """[(名前, URL, リンクの文字)]。個別銘柄のページ(/7203/... や ?code=)は除く。"""
        out, seen = [], set()
        for href, text in anchors:
            if not MARKET_RE.search(text or ""):
                continue
            u = self.abs(href)
            if u.netloc and u.netloc != self.host or re.match(r"^/(\d{3}[0-9A-Z]|E\d{5})/", u.path) or "code=" in u.query:
                continue
            url = urllib.parse.urlunparse(u._replace(netloc=self.host, scheme=urllib.parse.urlparse(self.base).scheme, fragment=""))
            if url in seen:
                continue
            seen.add(url)
            name = re.sub(r"[^0-9A-Za-z_]+", "_", (u.path.strip("/") or "top") + (f"_{u.query}" if u.query else "")).strip("_")[:60]
            out.append((name, url, text))
        return out[:limit]

    def is_margin_page(self, name: str) -> bool:
        return name in ("margin", "zandaka", "shinyo")

    def abs(self, href: str, page_url: str | None = None) -> urllib.parse.ParseResult:
        return urllib.parse.urlparse(urllib.parse.urljoin(page_url or self.base + "/", href))

    def follow_links(self, links: list[str], page_url: str, seen: set[str]) -> list[str]:
        """同じページの続き(?page=2・?p=2・/margin/2019 のような年・ページ送り)の URL。"""
        base = urllib.parse.urlparse(page_url)
        bq = dict(urllib.parse.parse_qsl(base.query))
        out = []
        for href in links:
            u = self.abs(href, page_url)
            if u.netloc != self.host:
                continue
            q = dict(urllib.parse.parse_qsl(u.query))
            same_path = u.path.rstrip("/") == base.path.rstrip("/")
            changed = {k for k in set(q) | set(bq) if q.get(k) != bq.get(k)}
            query_page = same_path and changed and changed <= PAGING_KEYS
            sub_page = not u.query and re.match(rf"^{re.escape(base.path.rstrip('/'))}/[0-9A-Za-z_\-]+/?$", u.path) and not bq
            full = urllib.parse.urlunparse(u._replace(fragment=""))
            if (query_page or sub_page) and full not in seen:
                seen.add(full)
                out.append(full)
        return out


class IRBank(Source):
    name, label, default_base = "irbank", "IRBANK", "https://irbank.net"
    PRIORITY = ["margin", "short", "lending", "kashikabu", "zandaka", "shinyo", "holder", "shareholder", "dividend", "results", "value"]
    labels = {"margin": "信用残", "short": "空売り", "lending": "貸借取引", "holder": "大株主", "dividend": "配当", "results": "決算", "value": "株価指標", "top": "銘柄トップ",
              "pl": "損益計算書", "bs": "貸借対照表", "cf": "キャッシュフロー"}
    SKIP = {"login", "signup", "logout", "bookmark", "favorite", "rss", "search", "print"}

    def top_url(self, code):
        return f"{self.base}/{code}"

    def subpages(self, code, links, mode):
        names = []
        for href in links:
            u = self.abs(href)
            if u.netloc and u.netloc != self.host:
                continue
            m = re.match(rf"^/{re.escape(code)}/([A-Za-z0-9_\-]+)/?$", u.path)
            if m and m.group(1) not in self.SKIP and m.group(1) not in names:
                names.append(m.group(1))
        names.sort(key=lambda n: (self.PRIORITY.index(n) if n in self.PRIORITY else len(self.PRIORITY), n))
        pages = [(n, f"{self.base}/{code}/{n}") for n in names]
        # 決算・財務の長い履歴は EDINET コード(/E02144/pl など)の側にあるので、銘柄トップからリンクされたものも取る
        for href in links:
            u = self.abs(href)
            if u.netloc and u.netloc != self.host:
                continue
            m = re.match(r"^/(E\d{5})(?:/([A-Za-z0-9_\-]+))?/?$", u.path)
            if m:
                name = f"{m.group(1)}_{m.group(2) or 'top'}"
                if name not in {n for n, _ in pages}:
                    pages.append((name, f"{self.base}{u.path.rstrip('/')}"))
        return pages


class Kabutan(Source):
    name, label, default_base = "kabutan", "株探", "https://kabutan.jp"
    labels = {"top": "銘柄トップ", "margin": "信用残(週次)", "finance": "決算", "holder": "大株主", "kabuka_day": "株価(日足)", "kabuka_wek": "株価(週足)", "kabuka_mon": "株価(月足)"}
    SKIP_PATHS = {"/stock/news", "/stock/kabuka_chart", "/stock/chart"}

    def top_url(self, code):
        return f"{self.base}/stock/?code={code}"

    def margin_url(self, code):
        return f"{self.base}/stock/kabuka?code={code}&ashi=shin"

    def subpages(self, code, links, mode):
        # 毎週: 信用残と決算(通期・四半期の業績と配当)。決算は発表があった週に更新されるので毎週取り直す
        pages = [("margin", self.margin_url(code)), ("finance", f"{self.base}/stock/finance?code={code}")]
        if mode != "full":
            return pages
        pages += [("holder", f"{self.base}/stock/holder?code={code}")]
        known = {u for _, u in pages}
        # 銘柄トップにある、この銘柄の他のページ(/stock/xxx?code=コード)も取る
        for href in links:
            u = self.abs(href)
            if u.netloc and u.netloc != self.host or not u.path.startswith("/stock/") or u.path.rstrip("/") in self.SKIP_PATHS:
                continue
            q = dict(urllib.parse.parse_qsl(u.query))
            if q.get("code") != code or set(q) & PAGING_KEYS:
                continue
            extra = "_".join(v for k, v in sorted(q.items()) if k != "code")
            name = (u.path.rstrip("/").rsplit("/", 1)[-1] or "top") + (f"_{extra}" if extra else "")
            if name in ("top", "kabuka_shin"):
                continue
            url = urllib.parse.urlunparse(u._replace(netloc=self.host, scheme=urllib.parse.urlparse(self.base).scheme, fragment=""))
            if url not in known and name not in {n for n, _ in pages}:
                known.add(url)
                pages.append((name, url))
        return pages


SOURCES = {"irbank": IRBank, "kabutan": Kabutan}


# ---------------------------------------------------------------------------
# 取得
# ---------------------------------------------------------------------------
class Fetcher:
    def __init__(self, delay: float, base: str):
        self.delay = delay
        self.last = 0.0
        self.count = 0
        # robots.txt は RFC 9309 に沿って扱う: 200 なら中身に従う / 4xx(無い・拒否)は制限なし / 5xx・通信エラーは全部取らない。
        # (Python 標準の read() は 401/403 を「全部禁止」にするので、その場合に原因が分からなくなる。自分で取って判断し、ログに残す)
        self.robots = urllib.robotparser.RobotFileParser()
        self.robots_status, self.robots_note = None, ""
        try:
            req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode("utf-8", errors="replace")
                self.robots_status = r.status
            self.robots.parse(text.splitlines())
            lines = [l for l in text.splitlines() if l.strip() and not l.strip().startswith("#")]
            self.robots_note = f"robots.txt: HTTP 200 · {len(lines)} 行"
            print(self.robots_note + "\n  " + "\n  ".join(lines[:40]) + ("\n  …" if len(lines) > 40 else ""), flush=True)
        except urllib.error.HTTPError as e:
            self.robots_status = e.code
            if 400 <= e.code < 500:
                self.robots.parse([])  # 制限なし
                self.robots_note = f"robots.txt: HTTP {e.code}(無い/拒否 → RFC 9309 では制限なし。ページ自体が拒否されるかは各ページの応答で分かる)"
            else:
                self.robots.parse(["User-agent: *", "Disallow: /"])
                self.robots_note = f"robots.txt: HTTP {e.code}(サーバーエラー → 安全のため全部取らない)"
            print(self.robots_note, flush=True)
        except Exception as e:
            self.robots_status = 0
            self.robots.parse(["User-agent: *", "Disallow: /"])
            self.robots_note = f"robots.txt: 通信エラー {e}(安全のため全部取らない)"
            print(self.robots_note, flush=True)

    def allowed(self, url: str) -> bool:
        return self.robots is None or self.robots.can_fetch(UA, url)

    def get(self, url: str) -> tuple[int, str, str]:
        """(status, html, 最終URL)。404 などは status で返し、通信エラーは status=0、robots で禁止は 999。"""
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


def archive_stock(src: Source, f: Fetcher, code: str, opts, raw: dict[str, bytes], year_hint: int) -> dict:
    pages = []
    status, html, final = f.get(src.top_url(code))
    if status != 200:
        return {"status": f"http_{status}", "pages": []}
    raw[f"{code}/top.html"] = html.encode("utf-8")
    top = parse_html(html)
    pages.append({"name": "top", "label": src.labels.get("top", "top"), "url": final, "status": status, "title": top["title"], "tables": top["tables"]})
    margin_tables = []
    other_codes = sorted({m.group(1) for h in top["links"] for m in [re.match(r"^/(E\d{5})/", src.abs(h).path)] if m})
    follow = opts.max_follow if (src.name == "irbank" or opts.mode == "full") else 0
    for name, url in src.subpages(code, top["links"], opts.mode)[: opts.max_subpages]:
        st, body, fin = f.get(url)
        page = {"name": name, "label": src.labels.get(name, name), "url": fin, "status": st, "title": "", "tables": []}
        if st == 200:
            raw[f"{code}/{name}.html"] = body.encode("utf-8")
            parsed = parse_html(body)
            page["title"], page["tables"] = parsed["title"], parsed["tables"]
            seen = {url, fin}
            bodies = {hash(body)}  # ?p=1 のように最初のページと同じ中身は二重に持たない
            more = src.follow_links(parsed["links"], fin, seen)[:follow]
            for k, murl in enumerate(more):
                st2, body2, _ = f.get(murl)
                if st2 != 200 or hash(body2) in bodies:
                    continue
                bodies.add(hash(body2))
                raw[f"{code}/{name}__{k + 1}.html"] = body2.encode("utf-8")
                p2 = parse_html(body2)
                mu = urllib.parse.urlparse(murl)
                for t in p2["tables"]:
                    t["title"] = f"{t['title']} ({mu.query or mu.path.rsplit('/', 1)[-1]})".strip()
                page["tables"].extend(p2["tables"])
                more.extend(u for u in src.follow_links(p2["links"], murl, seen) if len(more) < follow)
            page["followed"] = len(more)
            if src.is_margin_page(name) or any("売残" in "".join(t.get("headers") or []) for t in page["tables"]):
                margin_tables.extend(page["tables"])
        pages.append(page)
    if not margin_tables:  # トップに信用残の表がある場合
        margin_tables = top["tables"]
    margin = extract_margin(margin_tables, year_hint)
    ok = any(p["status"] == 200 for p in pages)
    return {"status": "ok" if ok else "failed", "pages": pages, "margin": margin, "edinetCodes": other_codes}


def archive_market(src: Source, f: Fetcher, opts, raw: dict[str, bytes], year_hint: int, out: Path, key: bytes) -> dict | None:
    """市場全体のページ(東証全体の信用残など)を取って data/{source}/market.json.enc に積み増す。"""
    st, html, final = f.get(src.base + "/")
    if st != 200:
        print(f"[{src.label}] トップページを取得できませんでした({st})。市場全体のページは今回は取りません。", flush=True)
        return None
    top = parse_html(html)
    cands = src.market_pages(top["anchors"], 15)
    pages, margin_tables = [], []
    for name, url, text in cands:
        st, body, fin = f.get(url)
        page = {"name": name, "label": text[:40], "url": fin, "status": st, "title": "", "tables": []}
        if st == 200:
            raw[f"_market/{name}.html"] = body.encode("utf-8")
            parsed = parse_html(body)
            page["title"], page["tables"] = parsed["title"], parsed["tables"]
            seen, bodies = {url, fin}, {hash(body)}
            more = src.follow_links(parsed["links"], fin, seen)[: opts.max_follow]
            for k, murl in enumerate(more):
                st2, body2, _ = f.get(murl)
                if st2 != 200 or hash(body2) in bodies:
                    continue
                bodies.add(hash(body2))
                raw[f"_market/{name}__{k + 1}.html"] = body2.encode("utf-8")
                p2 = parse_html(body2)
                page["tables"].extend(p2["tables"])
                more.extend(u for u in src.follow_links(p2["links"], murl, seen) if len(more) < opts.max_follow)
            if any("残" in "".join(t.get("headers") or []) for t in page["tables"]):
                margin_tables.extend(page["tables"])
        pages.append(page)
    path = out / "market.json.enc"
    old = decrypt_json(path.read_bytes(), key) if path.exists() else {}
    margin = merge_margin(old.get("margin"), extract_margin(margin_tables, year_hint))
    fresh = {p["name"] for p in pages}
    doc = {"source": src.name, "fetchedAt": now_iso(), "pages": pages + [p for p in old.get("pages", []) if p.get("name") not in fresh], "margin": margin}
    path.write_bytes(encrypt_json(doc, key))
    print(f"[{src.label}] 市場全体: 候補 {len(cands)} ページ({', '.join(t for _, _, t in cands)[:200]})· 信用残 {len(margin)} 回", flush=True)
    return {"fetchedAt": doc["fetchedAt"], "pages": {p["name"]: p["status"] for p in doc["pages"]}, "marginRows": len(margin), "marginFrom": margin[0]["date"] if margin else None, "marginTo": margin[-1]["date"] if margin else None}


def merge_margin(old: list[dict], new: list[dict]) -> list[dict]:
    """日付で合わせる(同じ日付は新しい取得を優先)。週次の 1 ページ目だけでも履歴が積み上がる。"""
    by = {r["date"]: r for r in old or []}
    by.update({r["date"]: r for r in new or []})
    return [by[k] for k in sorted(by)]


# ---------------------------------------------------------------------------
# 本体
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=sorted(SOURCES), default="kabutan")
    ap.add_argument("--mode", choices=["weekly", "full"], default="weekly", help="株探: weekly=信用残の1ページ目・決算・トップ / full=大株主なども含めて全部・信用残の過去ページも")
    ap.add_argument("--codes", default="", help="カンマ区切りの銘柄コード(空=Future Sight の全銘柄)")
    ap.add_argument("--max-minutes", type=float, default=300)
    ap.add_argument("--delay", type=float, default=1.5, help="リクエスト間隔(秒)")
    ap.add_argument("--max-subpages", type=int, default=60)
    ap.add_argument("--max-follow", type=int, default=40, help="1ページあたりの続き(ページ送り)の上限")
    ap.add_argument("--refetch-days", type=float, default=0, help="この日数より古い取得済み銘柄も取り直す(0=未取得だけ)")
    ap.add_argument("--out", default="", help="既定は data/{source}")
    ap.add_argument("--raw-out", default="", help="生 HTML の暗号化 tar.gz の出力先")
    ap.add_argument("--release-tag", default="")
    ap.add_argument("--fs-base", default=os.environ.get("FS_BASE", ""), help="Future Sight の配信元(既定は GitHub raw)")
    ap.add_argument("--no-market", action="store_true", help="市場全体のページ(東証全体の信用残など)を取らない")
    opts = ap.parse_args()
    src: Source = SOURCES[opts.source]()

    password = os.environ.get("FS_PAGES_PASSWORD", "")
    if not password:
        print("::error::FS_PAGES_PASSWORD が未設定です。リポジトリの Settings → Secrets and variables → Actions に登録してください。")
        return 2
    fs = FSData(password, opts.fs_base) if opts.fs_base else FSData(password)
    key = fs.key
    out = Path(opts.out or f"data/{src.name}")
    (out / "stocks").mkdir(parents=True, exist_ok=True)
    index_path = out / "index.json.enc"
    index = decrypt_json(index_path.read_bytes(), key) if index_path.exists() else {}
    index.setdefault("source", src.name)
    index.setdefault("stocks", {})
    index.setdefault("releases", [])

    dash = fs.json("dashboard")
    names = {p["code"]: p.get("name", "") for p in dash.get("predictions", [])}
    explicit = bool(opts.codes.strip())
    if explicit:
        codes = [c.strip() for c in opts.codes.split(",") if c.strip()]
    else:
        codes = sorted(set(fs.json("stock-detail-index").keys()) | set(names))
    cutoff = dt.datetime.now(JST) - dt.timedelta(days=opts.refetch_days) if opts.refetch_days > 0 else None

    def due(c: str) -> bool:
        s = index["stocks"].get(c)
        if explicit or not s:
            return True
        if s.get("status") != "ok":
            return s.get("attempts", 1) < GIVE_UP_AFTER
        if cutoff and s.get("fetchedAt"):
            return dt.datetime.fromisoformat(s["fetchedAt"]) < cutoff
        return False

    todo = [c for c in codes if due(c)]
    # 未取得 → 失敗 → 古い順
    todo.sort(key=lambda c: (c in index["stocks"], index["stocks"].get(c, {}).get("status") == "ok", index["stocks"].get(c, {}).get("fetchedAt", "")))
    total_ok = sum(1 for s in index["stocks"].values() if s.get("status") == "ok")
    print(f"[{src.label}] 対象 {len(codes)} 銘柄 / 今回 {len(todo)} 銘柄(mode={opts.mode}・間隔 {opts.delay}s・上限 {opts.max_minutes}分)", flush=True)
    mk = index.get("market") or {}
    market_due = not opts.no_market and not explicit and (not mk.get("fetchedAt") or (cutoff is not None and dt.datetime.fromisoformat(mk["fetchedAt"]) < cutoff))
    if not todo and not market_due:
        print(f"取得するものはありません(取得済み {total_ok} 銘柄)。{src.label} には接続しません。", flush=True)
        return 0

    f = Fetcher(opts.delay, src.base)
    raw: dict[str, bytes] = {}
    year_hint = dt.datetime.now(JST).year
    if market_due:
        res_m = archive_market(src, f, opts, raw, year_hint, out, key)
        if res_m:
            index["market"] = res_m
    index["robots"] = {"status": f.robots_status, "note": f.robots_note, "checkedAt": now_iso()}
    if todo and not f.allowed(src.top_url(todo[0])):
        print(f"::warning::{src.label} の robots.txt が、このプログラム({UA})に銘柄ページ({src.top_url(todo[0])})の取得を許可していません。robots.txt に従い取得しません。{f.robots_note}")
        index["updatedAt"] = now_iso()
        index_path.write_bytes(encrypt_json(index, key))
        return 0
    deadline = time.time() + opts.max_minutes * 60
    done = failed = 0
    for i, code in enumerate(todo):
        if time.time() > deadline:
            print(f"時間切れ: 残り {len(todo) - i} 銘柄は次回", flush=True)
            break
        t0 = time.time()
        res = archive_stock(src, f, code, opts, raw, year_hint)
        prev = index["stocks"].get(code, {})
        doc_path = out / "stocks" / f"{code}.json.enc"
        if res["status"] == "ok":
            old = decrypt_json(doc_path.read_bytes(), key) if doc_path.exists() else {}
            fresh = {p["name"] for p in res["pages"]}
            margin = merge_margin(old.get("margin"), res["margin"])
            doc = {"code": code, "name": names.get(code, ""), "source": src.name, "fetchedAt": now_iso(), "mode": opts.mode,
                   # 今回取らなかったページ(週次では決算など)は前回の保存分を残す
                   "pages": res["pages"] + [p for p in old.get("pages", []) if p.get("name") not in fresh],
                   "margin": margin, "edinetCodes": res.get("edinetCodes", []) or old.get("edinetCodes", []), "release": opts.release_tag or old.get("release")}
            doc_path.write_bytes(encrypt_json(doc, key))
            index["stocks"][code] = {"status": "ok", "name": names.get(code, ""), "fetchedAt": doc["fetchedAt"], "marginRows": len(margin), "marginFrom": margin[0]["date"] if margin else None, "marginTo": margin[-1]["date"] if margin else None, "pages": {p["name"]: p["status"] for p in doc["pages"]}}
            done += 1
        else:
            failed += 1
            if prev.get("status") == "ok":
                prev["lastError"] = f"{res['status']} {now_iso()}"  # 良い保存データは残す
            else:
                # 「見つからない」(404)だけを諦める回数に数える。robots で止めた(999)・通信エラー・拒否は次回また試す
                index["stocks"][code] = {"status": res["status"], "name": names.get(code, ""), "fetchedAt": now_iso(), "pages": {}, "attempts": prev.get("attempts", 0) + (1 if res["status"] == "http_404" else 0)}
        m = res.get("margin") or []
        print(f"[{i + 1}/{len(todo)}] {code} {names.get(code, '')} {res['status']} pages={len(res['pages'])} 信用残(今回)={len(m)}回 {time.time() - t0:.0f}s", flush=True)
        if (i + 1) % 10 == 0:  # 途中経過も書いておく(強制終了に備える)
            index["updatedAt"] = now_iso()
            index_path.write_bytes(encrypt_json(index, key))
        # 最初から拒否・失敗が続くときは、相手に同じリクエストを繰り返さずにやめる
        if done == 0 and failed >= 3:
            st = res["status"]
            why = "アクセスを拒否しています(HTTP 403)。この実行環境(GitHub Actions など)からの取得を相手が許可していません。自分の PC から実行してください(README「自分の PC で実行」)" if st == "http_403" else f"応答しません({st})"
            print(f"::warning::{src.label} が{why}。中断します。")
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
    left = len([c for c in codes if index["stocks"].get(c, {}).get("status") != "ok"])
    print(f"完了: 今回 成功 {done} / 失敗 {failed} · 累計 {total_ok} 銘柄 · 未取得 {left} · リクエスト {f.count} 回", flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### {src.label} ({opts.mode})\n\n- 今回: 成功 {done} / 失敗 {failed}\n- 累計: {total_ok}/{len(codes)} 銘柄\n- 未取得: {left} 銘柄\n- リクエスト: {f.count} 回\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
