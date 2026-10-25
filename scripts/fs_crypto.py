"""Future Sight(stockAI)の公開データと同じ暗号形式。

  鍵   = PBKDF2-SHA256(パスワード, enc-meta.json の salt, iter) → AES-256
  中身 = 先頭12バイトの IV + AES-GCM(gzip(JSON))

ブラウザ側(assets/js/data.js と Future Sight の gate.js)が同じ鍵で復号する。
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import urllib.request

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

CHECK_TEXT = b"future-sight-ok"
FS_RAW_BASE = "https://raw.githubusercontent.com/closeAI-astra/future.insight.stockAI.si/main/"


def derive_key(password: str, salt_b64: str, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(salt_b64), iterations=iterations)
    return kdf.derive(password.encode("utf-8"))


def decrypt_bytes(blob: bytes, key: bytes) -> bytes:
    return gzip.decompress(AESGCM(key).decrypt(blob[:12], blob[12:], None))


def encrypt_bytes(plain: bytes, key: bytes) -> bytes:
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, gzip.compress(plain, mtime=0), None)


def encrypt_json(obj, key: bytes) -> bytes:
    return encrypt_bytes(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), key)


def decrypt_json(blob: bytes, key: bytes):
    return json.loads(decrypt_bytes(blob, key).decode("utf-8"))


def make_meta(password: str, salt_b64: str | None = None, iterations: int = 310000) -> tuple[dict, bytes]:
    """テスト用: enc-meta.json と鍵を作る(本番の meta は Future Sight 側が作る)。"""
    salt_b64 = salt_b64 or base64.b64encode(os.urandom(16)).decode()
    key = derive_key(password, salt_b64, iterations)
    check = base64.b64encode(encrypt_bytes(CHECK_TEXT, key)).decode()
    return {"salt": salt_b64, "iter": iterations, "check": check}, key


def check_key(meta: dict, key: bytes) -> bool:
    try:
        return decrypt_bytes(base64.b64decode(meta["check"]), key) == CHECK_TEXT
    except Exception:
        return False


def http_get(url: str, timeout: float = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "stock-rank-archiver"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


class FSData:
    """Future Sight の暗号化データを読む(既定は GitHub の raw)。"""

    def __init__(self, password: str, base: str = FS_RAW_BASE):
        self.base = base if base.endswith("/") else base + "/"
        self.meta = json.loads(http_get(self.base + "enc-meta.json"))
        self.key = derive_key(password, self.meta["salt"], int(self.meta["iter"]))
        if not check_key(self.meta, self.key):
            raise SystemExit("FS_PAGES_PASSWORD が Future Sight のパスワードと一致しません(enc-meta.json の check を復号できない)。")

    def json(self, name: str):
        return decrypt_json(http_get(f"{self.base}data/{name}.json.enc"), self.key)
