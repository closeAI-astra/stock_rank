"""テスト用の偽 IRBANK・株探。

  python tests/fake_sites.py PORT
  IRBANK_BASE=http://127.0.0.1:PORT または KABUTAN_BASE=http://127.0.0.1:PORT で stock_archive.py を向ける
  (株探は /stock/... のパス、IRBANK は /{コード}/... のパス)
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

    def kabutan(self, u):
        q = {k: v[0] for k, v in parse_qs(u.query).items()}; code = q.get("code", "")
        if code == "9999":
            return self.send(404, "no such stock")
        if u.path in ("/stock/", "/stock"):
            return self.send(200, f"<html><head><title>{code} 株探</title></head><body><h2>株価指標</h2><table><tr><th>PER</th><th>PBR</th><th>利回り</th><th>信用倍率</th></tr><tr><td>12.3倍</td><td>1.1倍</td><td>2.5%</td><td>4.2倍</td></tr></table>"
                             f"<a href='/stock/kabuka?code={code}&ashi=shin'>信用残</a><a href='/stock/finance?code={code}'>決算</a><a href='/stock/kabuka?code={code}&ashi=day'>時系列</a><a href='/stock/news?code={code}'>ニュース</a><a href='/themes/?theme=x'>テーマ</a></body></html>")
        if u.path == "/stock/kabuka" and q.get("ashi") == "shin":
            page = int(q.get("page", "1"))
            end = dt.date(2026, 10, 16) - dt.timedelta(weeks=20 * (page - 1))
            rnd = random.Random(code + str(page)); rows = []; d = end
            for _ in range(20):
                b, s_ = rnd.randint(100000, 3000000), rnd.randint(10000, 900000)
                rows.append(f"<tr><th>{d:%y/%m/%d}</th><td>1,234.5</td><td>+1.2%</td><td>{s_:,}</td><td>▲1,000</td><td>{b:,}</td><td>+2,000</td><td>{b / s_:.2f}</td></tr>")
                d -= dt.timedelta(weeks=1)
            nav = "".join(f"<a href='?code={code}&ashi=shin&page={p}'>{p}</a>" for p in range(1, 4))
            return self.send(200, f"<html><body><h2>信用残推移</h2><table><thead><tr><th>日付</th><th>終値</th><th>前週比</th><th>売り残</th><th>前週比</th><th>買い残</th><th>前週比</th><th>倍率</th></tr></thead><tbody>{''.join(rows)}</tbody></table>{nav}</body></html>")
        if u.path == "/stock/kabuka":
            return self.send(200, "<html><body><table><tr><th>日付</th><th>終値</th></tr><tr><td>26/10/23</td><td>1,234</td></tr></table></body></html>")
        if u.path == "/stock/finance":
            return self.send(200, "<html><body><h2>通期</h2><table><tr><th>決算期</th><th>売上高</th><th>営業益</th></tr><tr><td>2026.03</td><td>48,036,704</td><td>4,795,586</td></tr></table></body></html>")
        return self.send(404, "not found")

    def do_GET(self):
        u = urlparse(self.path); parts = [p for p in u.path.split("/") if p]
        if u.path == "/robots.txt":
            return self.send(200, "User-agent: *\nDisallow: /login\n")
        if u.path.startswith("/stock"):
            return self.kabutan(u)
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
