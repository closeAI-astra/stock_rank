"""index.html の CSS・JS の URL に、ファイルの中身から作った版番号(?v=...)を付ける。

GitHub Pages はファイルを約10分キャッシュするので、更新直後に古い JS と新しい HTML が混ざって
画面が壊れることがある(例: 設定ページへのリンクを押しても開かない)。中身が変わったファイルだけ URL が変わる。

  python scripts/stamp_assets.py      # コミット前に実行
"""
import hashlib
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
index = root / "index.html"
html = index.read_text(encoding="utf-8")


def stamp(m):
    attr, path = m.group(1), m.group(2)
    f = root / path
    if not f.exists():
        return m.group(0)
    v = hashlib.sha1(f.read_bytes()).hexdigest()[:10]
    return f'{attr}="{path}?v={v}"'


new = re.sub(r'(src|href)="(assets/[^"?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"', stamp, html)
if new != html:
    index.write_text(new, encoding="utf-8")
    print("index.html の版番号を更新しました")
else:
    print("変更なし")
