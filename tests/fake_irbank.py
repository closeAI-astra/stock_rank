"""テスト用の偽 IRBANK(IRBANK_BASE=http://127.0.0.1:PORT で irbank_archive.py を向ける)。

  python tests/fake_irbank.py PORT
"""
import datetime as dt
import random
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def margin_rows(code, start, end):
    rnd = random.Random(code)
    d, rows, buy, sell = end, [], rnd.uniform(3e5, 3e6), rnd.uniform(5e4, 1e6)
    while d >= start:
        if d.weekday() == 4:
            buy *= rnd.uniform(0.9, 1.1); sell *= rnd.uniform(0.85, 1.15)
            rows.append(f"<tr><td>{d:%Y/%m/%d}</td><td>{round(sell):,}</td><td>▲{rnd.randint(1, 9999):,}</td><td>{round(buy):,}</td><td>+{rnd.randint(1, 9999):,}</td><td>{buy / sell:.2f}倍</td></tr>")
        d -= dt.timedelta(days=1)
    return "".join(rows)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, status, body):
        b = body.encode("utf-8")
        self.send_response(status); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path); parts = [p for p in u.path.split("/") if p]
        if u.path == "/robots.txt":
            return self.send(200, "User-agent: *\nDisallow: /login\n")
        if not parts or not parts[0].isdigit():
            return self.send(404, "not found")
        code = parts[0]
        if code == "9999":
            return self.send(404, "no such stock")
        if len(parts) == 1:
            return self.send(200, f"<html><head><title>{code} - IR BANK</title></head><body><h2>概要</h2><table><tr><th>項目</th><th>値</th></tr><tr><td>市場</td><td>プライム</td></tr></table>"
                             f"<a href='/{code}/margin'>信用残</a><a href='/{code}/short'>空売り</a><a href='/{code}/holder'>大株主</a><a href='/E01234/pl'>PL</a><a href='/login'>login</a></body></html>")
        page = parts[1]
        if page == "margin":
            p = parse_qs(u.query).get("p", ["1"])[0]
            if p == "1":
                rows = margin_rows(code, dt.date(2021, 1, 1), dt.date(2023, 12, 31))
                nav = f"<a href='/{code}/margin?p=2'>次へ</a>"
            else:
                rows = margin_rows(code + "old", dt.date(2018, 1, 1), dt.date(2020, 12, 31))
                nav = f"<a href='/{code}/margin?p=1'>前へ</a>"
            return self.send(200, f"<html><head><title>{code} 信用残 - IR BANK</title></head><body><h2>信用残の推移</h2><table><thead><tr><th>日付</th><th>売残</th><th>売残増減</th><th>買残</th><th>買残増減</th><th>信用倍率</th></tr></thead><tbody>{rows}</tbody></table>{nav}</body></html>")
        if page == "short":
            return self.send(200, f"<html><body><h2>空売り残高</h2><table><tr><th>計算日</th><th>機関</th><th>残高割合</th></tr><tr><td>2026/10/20</td><td>Goldman Sachs</td><td>0.62%</td></tr></table></body></html>")
        if page == "holder":
            return self.send(503, "busy")
        return self.send(404, "not found")


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
