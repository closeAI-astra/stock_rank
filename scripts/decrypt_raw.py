"""Release に置いた生 HTML(irbank-raw-*.tar.gz.enc)を復号して tar.gz に戻す。

  FS_PAGES_PASSWORD=... python scripts/decrypt_raw.py raw.tar.gz.enc raw.tar.gz
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fs_crypto import FSData, decrypt_bytes  # noqa: E402

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
fs = FSData(os.environ["FS_PAGES_PASSWORD"])
Path(sys.argv[2]).write_bytes(decrypt_bytes(Path(sys.argv[1]).read_bytes(), fs.key))
print(f"{sys.argv[2]} を書きました(tar -xzf で展開)")
