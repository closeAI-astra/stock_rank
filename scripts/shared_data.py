"""stock_rank と stockAI(Future Sight)で取得済みのデータを共有して読む(同じものを二度取りに行かないため)。

どちらのデータも同じ形式で暗号化して GitHub に置いてある:
  鍵   = PBKDF2-SHA256(Future Sight のパスワード, enc-meta.json の salt, iter) → AES-256
  中身 = 先頭12バイトの IV + AES-GCM(gzip(JSON))
置き場所と中身の一覧は data/manifest.json(暗号化していない)。このファイルは単体で動く(必要なのは cryptography だけ)ので、
stockAI 側にそのまま写して使ってよい。

  export FS_PAGES_PASSWORD=...                       # パスワードは環境変数で渡す(コードやログに書かない)
  python scripts/shared_data.py --list               # 共有しているデータの一覧
  python scripts/shared_data.py inst/market --out inst_market.json
  python scripts/shared_data.py inst/stocks/7203     # 1銘柄の空売り残高報告・日証金の貸借・大量保有・自己株買付

  from shared_data import SharedData
  sd = SharedData()                 # 既定は GitHub 上の stock_rank(手元の作業コピーなら SharedData(base="file:///.../stock_rank/"))
  market = sd.load("inst/market")   # dict
  fs = SharedData(source="stockai") # stockAI(Future Sight)側のデータも同じ方法で読める: fs.load("market")
"""
from __future__ import annotations

import argparse
import base64
import gzip
import json
import os
import sys
import urllib.request

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

BASES = {
    "stock_rank": "https://raw.githubusercontent.com/closeAI-astra/stock_rank/claude/stockrank-page-dev-ndc53i/",
    "stockai": "https://raw.githubusercontent.com/closeAI-astra/future.insight.stockAI.si/main/",
}
# 鍵の材料(salt・回数)はどちらも Future Sight の enc-meta.json
META_URL = BASES["stockai"] + "enc-meta.json"
UA = "stock-rank-shared-data (+https://github.com/closeAI-astra/stock_rank)"


def _get(url: str) -> bytes:
    if url.startswith("file://"):
        with open(url[7:], "rb") as f:
            return f.read()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


class SharedData:
    def __init__(self, password: str | None = None, source: str = "stock_rank", base: str | None = None, meta_url: str | None = None):
        password = password if password is not None else os.environ.get("FS_PAGES_PASSWORD", "")
        if not password:
            raise SystemExit("FS_PAGES_PASSWORD(Future Sight のパスワード)を環境変数で渡してください")
        self.base = (base or BASES[source]).rstrip("/") + "/"
        meta_url = meta_url or os.environ.get("SHARED_META_URL") or (self.base + "enc-meta.json" if source == "stockai" else META_URL)
        meta = json.loads(_get(meta_url))
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(meta["salt"]), iterations=int(meta["iter"]))
        self.key = kdf.derive(password.encode("utf-8"))

    def raw(self, path: str) -> bytes:
        return _get(self.base + path)

    def load(self, name: str):
        """data/{name}.json.enc を復号して返す(name は "inst/market" のように拡張子なし)。"""
        blob = self.raw(f"data/{name}.json.enc")
        return json.loads(gzip.decompress(AESGCM(self.key).decrypt(blob[:12], blob[12:], None)))

    def manifest(self) -> dict:
        return json.loads(self.raw("data/manifest.json"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("name", nargs="?", help='例: inst/market, inst/stocks/7203, events は data/events/*.json を直接読む')
    ap.add_argument("--source", choices=sorted(BASES), default="stock_rank")
    ap.add_argument("--base", default="", help="置き場所を変える(file:///path/to/stock_rank/ など)")
    ap.add_argument("--list", action="store_true", help="data/manifest.json の一覧を表示")
    ap.add_argument("--out", default="", help="JSON の保存先(空なら先頭だけ表示)")
    a = ap.parse_args()
    if a.list:
        base = (a.base or BASES["stock_rank"]).rstrip("/") + "/"
        man = json.loads(_get(base + "data/manifest.json"))
        for side in ("provides", "consumes"):
            print(f"== {man[side]['title']}")
            for d in man[side]["datasets"]:
                print(f"  {d['name']:<28} {d['path']:<40} {d.get('updates', '')}")
        return 0
    if not a.name:
        ap.error("name か --list を指定してください")
    doc = SharedData(source=a.source, base=a.base or None).load(a.name)
    text = json.dumps(doc, ensure_ascii=False)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"{a.out} に保存しました({len(text):,} 文字)")
    else:
        print(text[:2000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
