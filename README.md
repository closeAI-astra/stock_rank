# Stock Rank

stockAI(Future Sight)が集めた実データ(株価・決算・配当・財務・有報・信用残・貿易統計など)を、TradingView 風のチャートと表で自分で確認するためのページ。AI の予測株価は表示しません。見た目(Light / Dark / Prototype / Earth のテーマ、サイドバー、表)は Future Sight から移植しており、テーマの選択は Future Sight と共有します。GitHub Pages でそのまま動く静的サイトです(ビルド不要)。

## ページ

| 画面 | 内容 |
| --- | --- |
| チャート | TradingView の Lightweight Charts™ によるローソク足/平均足/バー/ライン。日足・週足・月足、移動平均・ボリンジャー・一目均衡表・出来高、RSI/MACD/ストキャス、**信用買残・売残/信用倍率/推定信用評価損益率/信用残の金額**のサブチャート、決算発表日の印、水平線・トレンドライン、ウォッチリスト(お気に入り)、画像保存 |
| チャート下段 | 信用残の全履歴(売残・買残・前回比・倍率・**売残/買残の金額**・**推定評価損益率**・推定取得単価・CSV 保存)、業績・四半期・財務・指標・株価指標・配当・セグメント・競合(株探・IRBANK 由来)、決算発表の履歴(前年同期比・発表後の値動き)、有価証券報告書(EDINET XBRL)の全項目、人的資本、会社情報(開示ベースの取引関係・関連ニュース)、株探・IRBANK の保存分 |
| 指数 | 日経平均・TOPIX・NASDAQ・S&P500・VIX・米10年債・ドル円の日足チャート(2020年〜)。日本株の指数には市場の信用残(株探・IRBANK から保存した東証全体、無ければ stockAI 対象銘柄の合計)、指数の統計・季節性・相関、投資部門別売買、騰落・業種 |
| ランキング・信用 | 全銘柄の信用倍率・買残/売残と金額・推定評価損益率・4週変化・買残の出来高比などを並び替え。対象銘柄合計の推定評価損益率(金額加重)の週次推移 |
| マクロ・貿易 | 財務省の貿易統計(輸出入・品目別・地域別・収支)、輸出・受注系の指標(韓国輸出・TSMC 月次など)、経済指標、市況・コモディティ |
| 保存データ | 下記ワークフローで保存した株探・IRBANK データの取得状況 |

## データ

- **stockAI(Future Sight)**: `closeAI-astra/future.insight.stockAI.si` が公開している暗号化データ(`data/*.json.enc`)を、ブラウザ内で同じパスワードで復号して読みます。データはこのリポジトリに複製しません。同じ `*.github.io` で Future Sight を「この端末で覚える」で開いていれば、パスワード入力は省略されます。
- **保存データ**: `data/kabutan/`(毎週の定期取得)と `data/irbank/`(一度きり)。同じ鍵で暗号化。信用残は stockAI に無い日付だけを 株探保存 → IRBANK保存 の順でつなぎます。

## 推定信用評価損益率

個別銘柄の信用評価損益率は公表されていないため、申込日ごとの残高と日足から推定します(`assets/js/credit.js`)。

1. 金額 = 残高(株)× 申込日の終値
2. 残高が増えた分は、前回の申込日からの期間 VWAP で建ったとみなして取得コストに積む
3. 減った分は先入れ先出し(既定。制度信用の期日 6 か月を過ぎた建玉は期日の終値で乗り換えとみなす)か移動平均法
4. 買い方 = 買残金額 ÷ 取得コスト − 1、売り方 = 1 − 売残金額 ÷ 取得コスト

最初の観測は「その日の終値で建てた」と置くため、履歴の最初の約半年は参考値です。株式分割は、分割日の前後の残高の跳びから信用残が未調整かを判定して揃えます。

## 株探・IRBANK の保存(GitHub Actions)

取得は `scripts/stock_archive.py --source kabutan|irbank` の1本で、取得元ごとにページの場所とページ送りだけが違います。

| ワークフロー | 役割 | 取るもの | 頻度 |
| --- | --- | --- | --- |
| `kabutan-weekly.yml`(**Kabutan weekly**) | これからの定期取得 | `mode=weekly`: 信用残(`/stock/kabuka?code=…&ashi=shin` の1ページ目)・決算(`/stock/finance?code=…`、業績・配当)・銘柄トップ。信用残の履歴は日付で合わせて積み増す<br>`mode=full`: 上に加えて信用残の過去ページ・大株主など銘柄トップからリンクされたページ | 毎週水曜 06:23 JST(信用残は火曜夕方に前週金曜申込分が出る)。初回は手動で `mode=full` |
| `irbank-archive.yml`(**IRBANK archive**) | 使えなくなる前の一度きりの保存 | 銘柄トップのリンクから見つけた個別ページ(信用残・空売り・貸借など)すべて | 全銘柄そろうまで毎日続きを取り、そろった後は接続しない |

保存先:

- ページごとの表と、正規化した信用残の履歴 → `data/{kabutan,irbank}/stocks/{コード}.json.enc`
- 取得状況 → `data/{kabutan,irbank}/index.json.enc`
- 生の HTML(暗号化 tar.gz)→ Release `kabutan-raw-*`(full のとき)・`irbank-raw-*`(復号は `scripts/decrypt_raw.py`)

どちらも最初に取得元のトップページから「信用残・空売り・貸借・投資部門」などの文字のリンクを探し、市場全体のページを `data/{kabutan,irbank}/market.json.enc` に積み増します(指数のチャートの東証全体の信用残に使う)。IRBANK は EDINET コード側のページ(`/E02144/pl` など、財務の長い履歴)も取ります。

準備と実行:

1. Settings → Secrets and variables → Actions に `FS_PAGES_PASSWORD`(Future Sight のパスワード)を登録
2. Actions → **IRBANK archive** → Run workflow(今のうちに一度)
3. Actions → **Kabutan weekly** → Run workflow で `mode=full`(初回の取り込み)。以後は毎週自動

1 回は最大約 5 時間で区切り、続きは次回に未取得の銘柄から再開します。取得に失敗した銘柄は、前回保存した良いデータを上書きしません。見つからない銘柄は 3 回失敗すると定期実行では諦めます。robots.txt に従い、間隔は既定 1.5 秒です。

## 公開(GitHub Pages)

Settings → Pages → Source を「Deploy from a branch」にして、このブランチの `/ (root)` を選びます。

## テスト

```sh
node tests/credit.test.js                  # 推定評価損益率の計算
python -m unittest tests/test_archive.py   # 株探・IRBANK の表の取り出し・ページ送り・暗号
python tests/make_mock.py OUT pass          # 偽の stockAI データ(画面の確認用)
python tests/fake_sites.py 8765             # 偽の株探・IRBANK(KABUTAN_BASE / IRBANK_BASE で向ける)
```

チャート描画: [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts) v5.1.0(Apache-2.0, `assets/vendor/`)。表示内容は情報提供のためのもので、投資助言ではありません。
