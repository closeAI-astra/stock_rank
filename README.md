# Stock Rank

stockAI(Future Sight)のデータを使った、TradingView 風のチャートと銘柄データのページ。GitHub Pages でそのまま動く静的サイトです(ビルド不要)。

## ページ

| 画面 | 内容 |
| --- | --- |
| チャート | TradingView の Lightweight Charts™ によるローソク足/平均足/バー/ライン。日足・週足・月足、移動平均・ボリンジャー・一目均衡表・出来高、RSI/MACD/ストキャス、**信用買残・売残/信用倍率/推定信用評価損益率/信用残の金額**のサブチャート、stockAI の AI 予測(期間 VWAP と 68%/90% 帯)、過去の予測、水平線・トレンドライン、ウォッチリスト(お気に入り)、画像保存 |
| チャート下段 | 信用残の全履歴(売残・買残・前回比・倍率・**売残/買残の金額**・**推定評価損益率**・推定取得単価・CSV 保存)、業績・四半期・財務・指標・株価指標・配当・セグメント・競合(株探・IRBANK 由来)、AI 予測の一覧と履歴、IRBANK 保存分 |
| ランキング・信用 | 全銘柄の信用倍率・買残/売残と金額・推定評価損益率・4週変化・買残の出来高比などを並び替え。対象銘柄合計の推定評価損益率(金額加重)の週次推移 |
| マクロ・貿易 | 財務省の貿易統計(輸出入・品目別・地域別・収支)、輸出・受注系の指標(韓国輸出・TSMC 月次など)、経済指標、市況・コモディティ |
| IRBANK 保存 | 下記ワークフローで保存した IRBANK データの取得状況 |

## データ

- **stockAI(Future Sight)**: `closeAI-astra/future.insight.stockAI.si` が公開している暗号化データ(`data/*.json.enc`)を、ブラウザ内で同じパスワードで復号して読みます。データはこのリポジトリに複製しません。同じ `*.github.io` で Future Sight を「この端末で覚える」で開いていれば、パスワード入力は省略されます。
- **IRBANK 保存データ**: `data/irbank/`(同じ鍵で暗号化)。

## 推定信用評価損益率

個別銘柄の信用評価損益率は公表されていないため、申込日ごとの残高と日足から推定します(`assets/js/credit.js`)。

1. 金額 = 残高(株)× 申込日の終値
2. 残高が増えた分は、前回の申込日からの期間 VWAP で建ったとみなして取得コストに積む
3. 減った分は先入れ先出し(既定。制度信用の期日 6 か月を過ぎた建玉は期日の終値で乗り換えとみなす)か移動平均法
4. 買い方 = 買残金額 ÷ 取得コスト − 1、売り方 = 1 − 売残金額 ÷ 取得コスト

最初の観測は「その日の終値で建てた」と置くため、履歴の最初の約半年は参考値です。株式分割は、分割日の前後の残高の跳びから信用残が未調整かを判定して揃えます。

## IRBANK の保存(GitHub Actions)

`.github/workflows/irbank-archive.yml`。IRBANK の個別ページ(信用残・空売り・貸借など、銘柄トップのリンクから自動で見つける)を取得し、

- ページごとの表と、正規化した信用残の履歴 → `data/irbank/stocks/{コード}.json.enc`
- 取得状況 → `data/irbank/index.json.enc`
- 生の HTML(暗号化 tar.gz)→ Release `irbank-raw-*`(復号は `scripts/decrypt_raw.py`)

を保存します。準備と実行:

1. Settings → Secrets and variables → Actions に `FS_PAGES_PASSWORD`(Future Sight のパスワード)を登録
2. Actions → **IRBANK archive** → Run workflow(コード指定なし=全銘柄)

1 回は最大約 5 時間で区切り、続きは次回(手動または毎日 03:17 JST の定期実行)に未取得の銘柄から再開します。取得に失敗した銘柄は、前回保存した良いデータを上書きしません。robots.txt に従い、間隔は既定 1.5 秒です。

## 公開(GitHub Pages)

Settings → Pages → Source を「Deploy from a branch」にして、このブランチの `/ (root)` を選びます。

## テスト

```sh
node tests/credit.test.js                  # 推定評価損益率の計算
python -m unittest tests/test_irbank_parse.py  # IRBANK の表の取り出し・暗号
python tests/make_mock.py OUT pass          # 偽の stockAI データ(画面の確認用)
python tests/fake_irbank.py 8765            # 偽の IRBANK(IRBANK_BASE で向ける)
```

チャート描画: [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts) v5.1.0(Apache-2.0, `assets/vendor/`)。表示内容は情報提供のためのもので、投資助言ではありません。
