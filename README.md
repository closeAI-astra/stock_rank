# Stock Rank

stockAI(Future Sight)が集めた実データ(株価・決算・配当・財務・有報・信用残・貿易統計など)を、TradingView 風のチャートと表で自分で確認するためのページ。AI の予測株価は表示しません。見た目(Light / Dark / Prototype / Earth のテーマ、サイドバー、表)は Future Sight から移植しており、テーマの選択は Future Sight と共有します。GitHub Pages でそのまま動く静的サイトです(ビルド不要)。

## ページ

| 画面 | 内容 |
| --- | --- |
| チャート | TradingView 風の画面(Lightweight Charts™)。上のツールバー(銘柄・比較・日/週/月・チャートの種類・インジケーター・元に戻す/やり直し・全体表示・画像保存・全画面)、左の描画ツール(トレンドライン・水平レイ・水平線・垂直線・フィボナッチ・長方形・計測・テキスト、マグネット、描画の非表示・全削除)、下の期間バー(1か月〜全期間・日付へ移動・% / log / auto)、右のウォッチリストと銘柄詳細。サブチャートに**信用買残・売残/信用倍率/推定信用評価損益率/信用残の金額**、RSI/MACD/ストキャス。凡例の 👁 で表示切替・✕ で削除。描画は銘柄ごとにこの端末に保存 |
| チャート下段 | 信用残の全履歴(売残・買残・前回比・倍率・**売残/買残の金額**・**推定評価損益率**・推定取得単価・CSV 保存)、業績・四半期・財務・指標・株価指標・配当・セグメント・競合(株探・IRBANK 由来)、決算発表の履歴(前年同期比・発表後の値動き)、有価証券報告書(EDINET XBRL)の全項目、人的資本、会社情報(開示ベースの取引関係・関連ニュース)、株探・IRBANK の保存分 |
| 指数 | 日経平均・TOPIX・NASDAQ・S&P500・VIX・米10年債・ドル円の日足チャート(2020年〜)。日本株の指数には市場の信用残(株探・IRBANK から保存した東証全体、無ければ stockAI 対象銘柄の合計)、指数の統計・季節性・相関、投資部門別売買、騰落・業種 |
| ランキング・信用 | 全銘柄の信用倍率・買残/売残と金額・推定評価損益率・4週変化・買残の出来高比などを並び替え。対象銘柄合計の推定評価損益率(金額加重)の週次推移 |
| マクロ・貿易 | 財務省の貿易統計(輸出入・品目別・地域別・収支)、輸出・受注系の指標(韓国輸出・TSMC 月次など)、経済指標、市況・コモディティ |
| 保存データ | 下記ワークフローで保存した株探・IRBANK データの取得状況 |

### 操作(チャート)

| キー | 動作 |
| --- | --- |
| 文字を打つ | 銘柄検索 |
| `/` | インジケーター |
| Alt+T / H / J / V / F | トレンドライン / 水平線 / 水平レイ / 垂直線 / フィボナッチ |
| Shift+クリック | 計測 |
| Ctrl+Z / Ctrl+Y | 元に戻す / やり直し |
| Delete | 選んだ描画を削除 |
| Esc | ツールを解除 |
| ← → / + − | 移動 / 拡大縮小 |
| Alt+R | 表示をリセット |
| Ctrl+B | 左のサイドバーを隠す/出す(左上のボタンでも) |

## データ

- **stockAI(Future Sight)**: `closeAI-astra/future.insight.stockAI.si` が公開している暗号化データ(`data/*.json.enc`)を、ブラウザ内で同じパスワードで復号して読みます。データはこのリポジトリに複製しません。同じ `*.github.io` で Future Sight を「この端末で覚える」で開いていれば、パスワード入力は省略されます。
- **保存データ**: `data/kabutan/`(毎週の定期取得)と `data/irbank/`(一度きり)。同じ鍵で暗号化。信用残は stockAI に無い日付だけを 株探保存 → IRBANK保存 の順でつなぎます。

## 分析(手元のデータから計算)

| どこ | 内容 |
| --- | --- |
| チャートのインジケーター | 信用買い方・売り方の推定平均単価の線、価格帯別出来高(表示範囲・POC と出来高 70% の帯)、アンカード VWAP(直近の決算発表・52週高値・52週安値から。左の描画ツールで任意の足からも)、PER・PBR バンド(実績 EPS・BPS × 過去の倍率の 10/50/90% 点) |
| 信用残タブ | 信用期日の到来予定(推定)。先入れ先出しで残った建玉の「建てた日 + 6か月」を月・週ごとに集計 |
| 感応度・リスク | TOPIX・ドル円・米10年債への重回帰(ドル円・米金利は当日 + 前日の係数の和)、期間別と推移、ボラティリティ・最大下落、TOPIX との相対力、RS スコア(全銘柄の中の順位) |
| 決算進捗 | 四半期の累計 ÷ 通期(今期は会社予想)と、過去の同じ時期の自社平均。会社予想のクセ(IRBANK) |
| 財務の質 | F スコア・Z スコア・Zmijewski・清原式ネットキャッシュ比率・Sloan 比率・ROIC・CCC・グレアム数 |
| 配当タブ | 権利落ちの値動き(権利付き最終日までの上昇、落ち日の TOPIX 比、配当との差、落ちた後) |
| 指数 → 市場の需給 | NT 倍率、騰落レシオ(25日)、移動平均線より上の割合、52週新高値・新安値、信用買残の時価総額比(対象銘柄から) |
| ランキング | 期日 3か月内の買残比、RS 順位、為替感応度、β |

## 機関の需給データ(JPX・日証金・EDINET)

GitHub Actions の **Institutional data**(`scripts/inst_data.py`)が平日の 08:43 と 19:13(日本時間)に取得し、暗号化して `data/inst/` に積み増します。JPX は直近約3週間分、日証金はその日の分しか置かれないため、毎日取って履歴を作ります(JPX・日証金は GitHub Actions から取得できることを確認済み)。

| 取得元 | 内容 | 画面 |
| --- | --- | --- |
| JPX 空売り残高情報 | 発行済の 0.5% 以上の空売りポジションの報告(報告者・割合・株数・前回) | 銘柄の「空売り・貸借・大量保有」タブ |
| JPX 空売り集計 | 東証の空売り比率(価格規制あり/なし)・業種別 | 指数 → 市場の需給 |
| JPX 裁定取引 | 裁定取引に係る現物ポジション(買い・売り、千株) | 指数 → 市場の需給 |
| 日本証券金融 | 銘柄別の融資・貸株残高、貸借倍率、品貸料(逆日歩)、制限措置 | 銘柄の「空売り・貸借・大量保有」タブ |
| EDINET API v2 | 大量保有報告書(提出者・保有割合・前回の割合・保有目的)、自己株券買付状況報告書 | 同上 |

EDINET は API キーが要ります。EDINET の API 利用登録で発行したキーを、Settings → Secrets and variables → Actions に `EDINET_API_KEY` として登録すると、次の実行から取得します(初回は 365 日さかのぼる)。キーが無い間は EDINET だけ飛ばします。

形式が変わったときは、Actions → Institutional data → Run workflow で `mode=probe` を選ぶと、各ページのファイルの一覧と中身の先頭を表示します。

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
| `kabutan-weekly.yml`(**Kabutan weekly**)/ PC の `register_weekly_task.ps1` | これからの定期取得 | `mode=weekly`: 信用残(`/stock/kabuka?code=…&ashi=shin` の1ページ目)・決算(`/stock/finance?code=…`、業績・配当)・銘柄トップ。信用残の履歴は日付で合わせて積み増す<br>`mode=full`: 上に加えて信用残の過去ページ・大株主など銘柄トップからリンクされたページ | PC のタスク スケジューラで毎週水曜 07:23(信用残は火曜夕方に前週金曜申込分が出る)。初回は `-Mode full` |
| `irbank-archive.yml`(**IRBANK archive**)/ PC の `run_local.ps1` | 使えなくなる前の一度きりの保存 | 銘柄トップのリンクから見つけた個別ページ(信用残・空売り・貸借など)すべて | PC で実行。途中で止めても続きから。そろった後は接続しない |

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

### 自分の PC で実行(株探・IRBANK とも)

2026-10-26 に確認したところ、**株探(HTTP 405)も IRBANK(HTTP 403)も GitHub Actions からの接続を拒否**します(IRBANK は robots.txt の取得も拒否)。そのため取得は自分の PC で行います。拒否を回避するような細工(ブラウザを装う・別の経路を使う)はしていません。PC からも拒否される場合は、相手が許可していないということなので、そこで止めます。2つのワークフローは手動実行だけ残しています。

```powershell
git clone https://github.com/closeAI-astra/stock_rank.git   # 初回だけ
cd stock_rank
git switch claude/stockrank-page-dev-ndc53i

# IRBANK(今のうちに一度だけ全部)。まず1銘柄で試してから全銘柄
powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1 -Codes 7203
powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1

# 株探: 初回は過去ページまで取り込み → 以後は毎週水曜 07:23 にタスク スケジューラで自動実行
powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1 -Source kabutan -Mode full
powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1
```

- パスワードは実行時に聞かれます(画面に表示されません)。定期実行のために `register_weekly_task.ps1` が保存する場合は、Windows の DPAPI で暗号化して `%LOCALAPPDATA%\stock_rank\fs-password.txt` に置きます(その PC・そのユーザーでしか読めません)。
- 取得した表は暗号化して `data/irbank/`・`data/kabutan/` に保存し、GitHub に送ります。生の HTML は暗号化した `*-raw-*.tar.gz.enc` として PC に残ります(GitHub には送りません)。
- 途中で止めても、次の実行は未取得の銘柄から続けます。

## 公開(GitHub Pages)

Settings → Pages → Source を「Deploy from a branch」にして、このブランチの `/ (root)` を選びます。

更新後に古い JS が残らないよう、`index.html` の JS/CSS には中身のハッシュを `?v=` で付けています。JS/CSS を変えたらコミット前に `python scripts/stamp_assets.py` を実行してください。

## テスト

```sh
node tests/credit.test.js                  # 推定評価損益率の計算
node tests/analytics.test.js               # VWAP・価格帯別出来高・進捗率・回帰・権利落ち・信用期日
python -m unittest tests/test_archive.py   # 株探・IRBANK の表の取り出し・ページ送り・暗号
python -m unittest tests/test_inst.py      # JPX・日証金・EDINET のファイルの取り出し
python tests/make_mock.py OUT pass          # 偽の stockAI データ(画面の確認用)
python tests/fake_sites.py 8765             # 偽の株探・IRBANK(KABUTAN_BASE / IRBANK_BASE で向ける)
```

チャート描画: [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts) v5.1.0(Apache-2.0, `assets/vendor/`)。表示内容は情報提供のためのもので、投資助言ではありません。
