// Stock Rank — 信用評価損益率(買い方・2市場。日経などが毎週公表)を、個別銘柄の信用残から推定するモデル。画面に依存しない計算だけ
//
// 考え方
//   1. 銘柄ごとに、信用買残の増減から建玉の取得コストを追う(増えた分はその間の VWAP で建てたとみなす・先入れ先出し・6か月で期日)。
//      ただし実際の信用買いは同じ週の中でも売り買いが回転していて、残高が変わらなくても建て替えで取得単価が時価に近づく。
//      そこで毎週、建玉の取得単価を (時価 − 単価) × κ だけ時価に寄せる(含み益は κg、含み損は κl)。
//   2. 全銘柄を足して「時価 ÷ 取得コスト − 1」= 対象銘柄の推定評価損益率 x を出す。信用残の行は公表された日(availableFrom)以降だけ使い、
//      その日の終値で値洗いするので、毎営業日の値が出る。
//   3. 公表値 y とは水準が合わない(対象が約400銘柄だけ・回転の仕方が違う)ので、変化を当てる:
//        今週の y の推定 = 前回の公表値 + b × (今の x − 前回の公表日の x)
//      b は、それまでの公表値だけで(先を見ずに)最小二乗で決める。
//   4. 2026-11-11 追加: stockAI が JPX 銘柄別信用取引残高(東証・全銘柄・毎営業日)の PDF から作る合計(Future Sight の market.creditMarket)。
//      PDF の金額は約定ベースなので「Σ 買残株数 × 終値 ÷ Σ 買残金額 − 1」がそのまま評価損益率になる(株価のある銘柄だけ)。これを x にして 3 と同じ形で推定(fitX)。
//      株数の合計は公表値(2市場)と 0.1% 未満で一致するので、金曜申込分の信用倍率は公表(火曜)の前日に分かる(ratioCheck / ratioNowcast)。
(function (root) {
  "use strict";
  const DAY = 864e5;
  // 日付の文字列 → ミリ秒。同じ日付を何十万回も変換するので覚えておく
  const T_CACHE = new Map();
  const t = (d) => { let v = T_CACHE.get(d); if (v === undefined) { v = Date.parse(`${d}T00:00:00Z`); if (T_CACHE.size > 50000) T_CACHE.clear(); T_CACHE.set(d, v); } return v; };
  const fin = (x) => typeof x === "number" && Number.isFinite(x);
  const lastIdx = (rows, key, v) => { let lo = 0, hi = rows.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m][key] <= v) { a = m; lo = m + 1; } else hi = m - 1; } return a; };

  // ---------- 公表値 ----------
  // IRBANK の「信用取引」ページの表(保存した生の表)から [{date, y}]。表の先頭の「2026」のような年の行から、月日をさかのぼって年を決める
  function parseIrbank(pages) {
    const out = [];
    (pages || []).forEach((pg) => (pg.tables || []).forEach((tb) => {
      const h = tb.headers || []; const col = h.findIndex((x) => /損益率/.test(x)); if (col < 0) return;
      let year = null, prevM = null;
      (tb.rows || []).forEach((r) => {
        const c = String(r[0] || "").trim();
        if (/^(19|20)\d\d$/.test(c)) { year = Number(c); prevM = null; return; }
        const m = c.match(/^(\d{1,2})\/(\d{1,2})$/); if (!m || year === null) return;
        const mo = Number(m[1]), da = Number(m[2]); if (prevM !== null && mo > prevM) year--; prevM = mo;
        const y = Number(String(r[col]).replace(/[+%]/g, "")); if (!Number.isFinite(y)) return;
        out.push({ date: `${year}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, y, src: "IRBANK" });
      });
    }));
    return out;
  }
  // 優先度の高い順に並べたリストを重ねる(同じ日付は先のものを使う)
  function mergeTargets(...lists) {
    const by = new Map();
    lists.forEach((l) => (l || []).forEach((o) => { if (o && o.date && fin(o.y) && !by.has(o.date)) by.set(o.date, o); }));
    return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // ---------- 銘柄ごとの取得コスト ----------
  // rows: 推定信用の行(credit.js の estimateCredit の rows)。buy × splitFactor = 今の株数にそろえた買残、entryPrice = その間の VWAP
  function prepRows(estRows) {
    return (estRows || []).filter((r) => fin(r.buy) && fin(r.close)).map((r) => ({ date: r.date, av: r.availableFrom || r.date, n: r.buy * (r.splitFactor || 1), p: r.close, e: fin(r.entryPrice) ? r.entryPrice : r.close }));
  }
  function simulate(rows, kg = 0.1, kl = 0.1, expiryDays = 182) {
    let lots = []; const out = []; let prev = null;
    rows.forEach((r) => {
      const wk = prev ? (t(r.date) - t(prev.date)) / DAY / 7 : 0;
      // 建て替え: 1週あたり κ の割合で、取得単価が時価に近づく(日々の行なら週の割合に直す)
      if (wk > 0) lots.forEach((L) => { const g = r.p - L.c; L.c += (1 - (1 - (g > 0 ? kg : kl)) ** wk) * g; });
      lots = lots.filter((L) => t(r.date) - t(L.d) < expiryDays * DAY);
      let have = lots.reduce((a, L) => a + L.n, 0);
      if (r.n > have) lots.push({ d: r.date, n: r.n - have, c: prev ? r.e : r.p });
      else { let cut = have - r.n; while (cut > 1e-9 && lots.length) { const q = Math.min(lots[0].n, cut); lots[0].n -= q; cut -= q; if (lots[0].n <= 1e-9) lots.shift(); } }
      out.push({ date: r.date, av: r.av, n: r.n, cost: lots.reduce((a, L) => a + L.n * L.c, 0) });
      prev = r;
    });
    return out;
  }
  // stocks: [{code, rows: prepRows(...), prices: [{d, c}]}]
  function build(stocks, kg, kl) { return stocks.filter((s) => s.rows.length).map((s) => ({ code: s.code, prices: s.prices, start: s.rows[0].date, sim: simulate(s.rows, kg, kl) })); }
  // その日に公表済みの残高を、その日の終値で値洗いして合計する。履歴が warm 日に満たない銘柄は除く(最初の取得単価が当てにならない)
  function xAt(built, date, warm = 91) {
    let val = 0, cost = 0, n = 0;
    built.forEach((s) => {
      if (t(date) - t(s.start) < warm * DAY) return;
      let i = lastIdx(s.sim, "date", date); while (i >= 0 && s.sim[i].av > date) i--; if (i < 0 || !(s.sim[i].cost > 0)) return;
      const j = lastIdx(s.prices, "d", date); if (j < 0 || t(date) - t(s.prices[j].d) > 7 * DAY) return;
      val += s.sim[i].n * s.prices[j].c; cost += s.sim[i].cost; n++;
    });
    return cost ? { x: (val / cost - 1) * 100, n, val, cost } : null;
  }

  // ---------- 公表値への当てはめ ----------
  const slope0 = (xs, ys) => { let a = 0, b = 0; for (let i = 0; i < xs.length; i++) { a += xs[i] * ys[i]; b += xs[i] * xs[i]; } return b ? a / b : null; };
  // 先を見ない検証(ウォークフォワード): 各週の推定は、その週より前の公表値だけで b を決めて出す
  //   xOf(date) は、その日の説明変数 x(推定 x・全銘柄の約定金額ベースの評価損益率・TOPIX の対数 × 100 など)。無い日は null
  function fitX(targets, xOf, opts = {}) {
    const minTrain = opts.minTrain ?? 12;
    const w = targets.map((o) => { const a = xOf(o.date); return a && fin(a.x) ? { ...o, x: a.x, n: a.n } : null; }).filter(Boolean);
    const weekly = w.map((o, k) => {
      if (k < minTrain) return { ...o, pred: null, naive: k ? w[k - 1].y : null };
      const tr = w.slice(0, k); const b = slope0(tr.slice(1).map((p, i) => p.x - tr[i].x), tr.slice(1).map((p, i) => p.y - tr[i].y));
      const last = tr.at(-1); return { ...o, b, naive: last.y, pred: b === null ? null : last.y + b * (o.x - last.x) };
    });
    const b = w.length > 2 ? slope0(w.slice(1).map((p, i) => p.x - w[i].x), w.slice(1).map((p, i) => p.y - w[i].y)) : null;
    return { weekly, b, n: w.length, ...score(weekly) };
  }
  // 誤差の集計。weeks を渡すと、その申込日の週だけで比べる(モデルどうしを同じ週で比べるため)
  function score(weekly, weeks) {
    const ev = weekly.filter((o) => o.pred !== null && o.naive !== null && (!weeks || weeks.has(o.date)));
    const mae = (f) => (ev.length ? ev.reduce((a, o) => a + Math.abs(f(o) - o.y), 0) / ev.length : null);
    const rmse = (f) => (ev.length ? Math.sqrt(ev.reduce((a, o) => a + (f(o) - o.y) ** 2, 0) / ev.length) : null);
    return { nEval: ev.length, mae: mae((o) => o.pred), rmse: rmse((o) => o.pred), maeNaive: mae((o) => o.naive), rmseNaive: rmse((o) => o.naive),
      hit: ev.length ? ev.filter((o) => Math.sign(o.pred - o.naive) === Math.sign(o.y - o.naive)).length / ev.length : null };
  }
  function fit(targets, built, opts = {}) { const warm = opts.warm ?? 91; return fitX(targets, (d) => xAt(built, d, warm), opts); }
  // 最後の公表日より後の各営業日の推定。誤差の幅は、検証の誤差(1週先)を √(公表日からの週数) 倍に広げる
  function nowcastX(model, xOf, days) {
    const last = model.weekly.at(-1); if (!last || model.b === null) return [];
    const sd = model.rmse ?? model.rmseNaive ?? 2;
    return days.filter((d) => d > last.date).map((d) => {
      const a = xOf(d); if (!a || !fin(a.x)) return null;
      const wk = Math.max(1, (t(d) - t(last.date)) / DAY / 7);
      const y = last.y + model.b * (a.x - last.x); const half = 1.96 * sd * Math.sqrt(Math.ceil(wk - 1e-9));
      return { date: d, y, lo: y - half, hi: y + half, x: a.x, n: a.n, weeks: wk };
    }).filter(Boolean);
  }
  function nowcast(model, built, days, warm = 91) { return nowcastX(model, (d) => xAt(built, d, warm), days); }

  // ---------- 全銘柄の合計(JPX 銘柄別信用取引残高。stockAI の scripts/build_margin_market.py) ----------
  // daily: [{date, buy_sh, sell_sh, buy_val, ratio, pl_buy_link, suspect, ...}] / official: JPX 信用取引現在高(週次・2市場)[{date, buy, sell, buyAmount, ratio}]
  // ⚠ 毎日の PDF は東証だけ。公表値(東京+名古屋)との差は 0.1% 未満なので、比(公表値 ÷ 合計)をそれまでの週の中央値で掛けて合わせる
  const monday = (d) => { const x = new Date(t(d)); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const friday = (d) => { const m = new Date(t(monday(d))); m.setUTCDate(m.getUTCDate() + 4); return m.toISOString().slice(0, 10); };
  const median = (a) => { const s = a.filter(fin).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  function cleanDaily(daily) { return (daily || []).filter((r) => r && r.date && !r.suspect && fin(r.buy_sh) && fin(r.sell_sh) && r.sell_sh > 0).sort((a, b) => (a.date < b.date ? -1 : 1)); }
  // 週ごとの答え合わせ(先を見ない): 比は、その週より前の週だけの中央値(無ければ 1)
  function ratioCheck(official, daily) {
    const dm = new Map(cleanDaily(daily).map((r) => [r.date, r]));
    const off = (official || []).filter((r) => fin(r.buy) && fin(r.sell) && r.sell > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    const weeks = []; const kb = [], ks = [];
    off.forEach((o, i) => {
      const d = dm.get(o.date); if (!d) return;
      const fb = median(kb) ?? 1, fs = median(ks) ?? 1;
      const est = (d.buy_sh * fb) / (d.sell_sh * fs), offR = o.buy / o.sell, prev = i ? off[i - 1] : null;
      weeks.push({ date: o.date, off: offR, est, raw: d.buy_sh / d.sell_sh, naive: prev ? prev.buy / prev.sell : null, buyErr: (d.buy_sh * fb) / o.buy - 1, sellErr: (d.sell_sh * fs) / o.sell - 1 });
      kb.push(o.buy / d.buy_sh); ks.push(o.sell / d.sell_sh);
    });
    const mae = (f) => { const e = weeks.filter((w) => fin(f(w))); return e.length ? e.reduce((a, w) => a + Math.abs(f(w) - w.off), 0) / e.length : null; };
    return { weeks, fb: median(kb) ?? 1, fs: median(ks) ?? 1, mae: mae((w) => w.est), maeRaw: mae((w) => w.raw), maeNaive: mae((w) => w.naive) };
  }
  // 今週(最新の日の週。その週の公表値が出ていれば次の週)の金曜申込分の信用倍率の推定。
  //   最新の日が金曜なら、その日の合計 × 比(公表の前日に分かる)。週の途中なら「今の値のまま」とし、
  //   残りの営業日数ぶんの過去の動き(対数の変化の標準偏差)から 95% の幅を付ける
  function ratioNowcast(official, daily, check) {
    const dd = cleanDaily(daily); const L = dd.at(-1); if (!L) return null;
    const offWeeks = new Set((official || []).map((o) => monday(o.date)));
    let target = friday(L.date); if (offWeeks.has(monday(L.date))) { const n = new Date(t(target)); n.setUTCDate(n.getUTCDate() + 7); target = n.toISOString().slice(0, 10); }
    let rem = 0; for (let x = t(L.date) + DAY; x <= t(target); x += DAY) { const w = new Date(x).getUTCDay(); if (w > 0 && w < 6) rem++; }
    const lr = dd.map((r) => Math.log(r.buy_sh / r.sell_sh));
    // 幅は外れ値に強い MAD × 1.4826(権利付き最終日の前後は一般信用の売りが一時的に膨らみ、倍率が数日で 6 → 10 倍と動く。
    //   その数回で普通の週の幅まで広がらないように)。権利日の週は外れやすい
    const sdOf = (j) => { if (!j) return 0; const ch = []; for (let i = j; i < lr.length; i++) ch.push(lr[i] - lr[i - j]); if (ch.length < 5) return null; const md = median(ch); return 1.4826 * median(ch.map((x) => Math.abs(x - md))); };
    const fb = check?.fb ?? 1, fs = check?.fs ?? 1; const buy = L.buy_sh * fb, sell = L.sell_sh * fs, ratio = buy / sell;
    const sd = sdOf(rem); const half = sd === null ? null : 1.96 * sd;
    return { basis: L.date, target, remaining: rem, buy, sell, ratio, lo: half === null ? null : ratio * Math.exp(-half), hi: half === null ? null : ratio * Math.exp(half), sdLog: sd };
  }
  // 事前登録した推定(stockAI の market_nowcast_log)の答え合わせ。公表値は同じ週のもの
  function gradeNowcasts(log, official, targets) {
    const offBy = new Map((official || []).map((o) => [monday(o.date), o])); const plBy = new Map((targets || []).map((o) => [monday(o.date), o]));
    return (log || []).map((r) => {
      const o = offBy.get(monday(r.targetDate)), p = plBy.get(monday(r.targetDate));
      const offR = o && fin(o.buy) && fin(o.sell) && o.sell > 0 ? o.buy / o.sell : null;
      return { ...r, offDate: o?.date || p?.date || null, offRatio: offR, ratioErr: offR !== null && fin(r.ratio) ? r.ratio - offR : null, offPl: p ? p.y : null, plErr: p && fin(r.pl) ? r.pl - p.y : null };
    });
  }
  // 毎営業日の推定(公表の無い日のおおよその値)。各日について、その日より前に出ていた公表値だけを使う(先を見ない)。
  //   評価損益率 = 直近の公表値 + b × (その日の x − 公表日の x)。b はその時点までの公表値の週ごとの変化から(2組未満なら 1。週ごとの検証 fitX と同じ)
  //   信用倍率 = その日の全銘柄の合計 × 比(その日より前の週の 公表値 ÷ 合計 の中央値。無ければ 1)
  //   公表日そのものの行は、前の公表値からの推定と、公表値を並べる(答え合わせ)
  function dailyEstimates(daily, targets, official) {
    const dd = cleanDaily(daily); const tg = (targets || []).filter((o) => fin(o.y)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const xm = new Map(dd.filter((r) => fin(r.pl_buy_link)).map((r) => [r.date, r.pl_buy_link]));
    const off = (official || []).filter((o) => fin(o.buy) && fin(o.sell) && o.sell > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    const dm = new Map(dd.map((r) => [r.date, r]));
    return dd.map((r) => {
      const d = r.date;
      // 評価損益率
      const known = tg.filter((o) => o.date < d && xm.has(o.date));
      let pl = null, anchor = null, b = null;
      if (known.length && xm.has(d)) {
        const pairs = known.slice(1).map((o, i) => [xm.get(o.date) - xm.get(known[i].date), o.y - known[i].y]);
        const sxx = pairs.reduce((a, p) => a + p[0] * p[0], 0);
        b = pairs.length >= 2 && sxx > 0 ? pairs.reduce((a, p) => a + p[0] * p[1], 0) / sxx : 1;
        anchor = known.at(-1); pl = anchor.y + b * (xm.get(d) - xm.get(anchor.date));
      }
      // 信用倍率
      const prevW = off.filter((o) => o.date < d && dm.has(o.date));
      const fb = median(prevW.map((o) => o.buy / dm.get(o.date).buy_sh)) ?? 1, fs = median(prevW.map((o) => o.sell / dm.get(o.date).sell_sh)) ?? 1;
      const offT = tg.find((o) => o.date === d), offR = off.find((o) => o.date === d);
      return { date: d, ratio: (r.buy_sh * fb) / (r.sell_sh * fs), ratioOff: offR ? offR.buy / offR.sell : null, pl, plOff: offT ? offT.y : null, anchor: anchor?.date || null, anchorY: anchor ? anchor.y : null, b, x: xm.get(d) ?? null };
    });
  }
  // ---------- 信用倍率の「予測」と「実データ(先回り集計)」を分ける(2026-11-19) ----------
  // 公表のタイミング:
  //   ・日証金の貸借取引残高(銘柄ごとの融資残 ≒ 制度信用の買い・貸株残 ≒ 制度信用の売り)… 申込日 D の分は翌営業日の昼までに出る
  //   ・全銘柄の合計(JPX 銘柄別信用取引残高。一般信用も含む)… 申込日 D の分は翌営業日の 16時ごろ
  //   ・公表値(JPX 信用取引現在高・金曜申込分)… 2営業日後(火曜)の 16時半ごろ
  // 予測 = 申込日 D の制度信用(日証金)の値までと、前の営業日までの全銘柄の合計を使った値。D の全銘柄の合計が出る前(翌営業日の昼すぎ)に分かる。
  //   前の日の合計 × exp(β × 日証金の合計の変化(対数))。β は、それまでに分かっていた日どうしの関係から最小二乗で(原点を通る)。
  //   日証金の値がまだ無い日・β を決めるだけの日数が無い日は「前の日の合計のまま」。幅は当てはめの残差と、日証金の無い日数ぶんの過去の動きから。
  // 実データ = その日 D の全銘柄の合計 × 比(D の翌営業日 16時に分かる。金曜の分は月曜 = 公表値の前日に分かる「先回り集計」)。予測ではない
  // days: 予測を出す日(過去の営業日に加えて、今日・今週の金曜など)。jsf: inst/market の jsfTotals([{date, dLoan, dLend}])
  // isBiz: 休場日を知っている営業日の判定(app の SRCal.makeBizCal)。無ければ平日を営業日とする
  function ratioForecasts(daily, official, days, isBiz, jsf) {
    const all = (daily || []).filter((r) => r && r.date).map((r) => r.date).sort();
    const dd = cleanDaily(daily); const dm = new Map(dd.map((r) => [r.date, r]));
    const off = (official || []).filter((o) => fin(o.buy) && fin(o.sell) && o.sell > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    const offBy = new Map(off.map((o) => [o.date, o]));
    const js = (jsf || []).filter((r) => r && r.date).sort((a, b) => (a.date < b.date ? -1 : 1)); const jsDates = new Set(js.map((r) => r.date));
    const nextBd = (d, n = 1) => {
      let cur = d;
      for (let k = 0; k < n; k++) {
        const i = all.findIndex((x) => x > cur);
        if (i >= 0) { cur = all[i]; continue; }
        const biz = (ms) => (isBiz ? isBiz(new Date(ms).toISOString().slice(0, 10)) : ![0, 6].includes(new Date(ms).getUTCDay()));
        let x = t(cur) + DAY; while (!biz(x)) x += DAY; cur = new Date(x).toISOString().slice(0, 10);
      }
      return cur;
    };
    const bdBetween = (a, b) => { let n = 0, cur = a; while (cur < b && n < 400) { cur = nextBd(cur); n++; } return n; };
    const pubDaily = new Map(all.map((d) => [d, nextBd(d)]));     // 合計が分かる日(16時ごろ)
    const pubOff = (d) => nextBd(d, 2);                             // 公表値が出る日(16時半ごろ)
    const lr = dd.map((r) => ({ d: r.date, v: Math.log(r.buy_sh / r.sell_sh) }));
    // 比(公表値 ÷ 合計)。known を満たす週だけの中央値
    const factors = (known) => {
      const w = off.filter((o) => dm.has(o.date) && known(o.date));
      return { fb: median(w.map((o) => o.buy / dm.get(o.date).buy_sh)) ?? 1, fs: median(w.map((o) => o.sell / dm.get(o.date).sell_sh)) ?? 1, n: w.length };
    };
    const sdOf = (k, upto) => { if (!k) return 0; const s = lr.filter((x) => x.d <= upto); const ch = []; for (let i = k; i < s.length; i++) ch.push(s[i].v - s[i - k].v); if (ch.length < 5) return null; const md = median(ch); return 1.4826 * median(ch.map((x) => Math.abs(x - md))); };
    // a より後で b まで(a < 日付 ≤ b)の日証金の変化の合計。日証金に a の日があり、途中の変化がすべてそろっているときだけ
    const jsfChange = (a, b) => {
      if (!jsDates.has(a)) return null; const seg = js.filter((r) => r.date > a && r.date <= b); if (!seg.length) return null;
      if (seg.some((r) => !fin(r.dLoan) || !fin(r.dLend))) return null;
      return { xb: seg.reduce((p, r) => p + r.dLoan, 0), xs: seg.reduce((p, r) => p + r.dLend, 0), steps: seg.length, to: seg.at(-1).date };
    };
    // 当てはめの材料: 続いた2日の全銘柄の合計の変化と、その間の日証金の変化
    const pairs = [];
    for (let i = 1; i < dd.length; i++) {
      const P = dd[i - 1], Y = dd[i]; const c = jsfChange(P.date, Y.date); if (!c || c.to !== Y.date) continue;
      pairs.push({ d: Y.date, xb: c.xb, xs: c.xs, yb: Math.log(Y.buy_sh / P.buy_sh), ys: Math.log(Y.sell_sh / P.sell_sh) });
    }
    const fitBeta = (D) => {
      const tr = pairs.filter((p) => p.d < D); if (tr.length < 8) return null;
      const slope = (x, y) => { const sxx = tr.reduce((a, p) => a + p[x] ** 2, 0); return sxx > 0 ? tr.reduce((a, p) => a + p[x] * p[y], 0) / sxx : null; };
      const b = slope("xb", "yb"), s2 = slope("xs", "ys"); if (b === null || s2 === null) return null;
      const res = tr.map((p) => (p.yb - p.ys) - (b * p.xb - s2 * p.xs)); const md = median(res);
      return { b, s: s2, n: tr.length, sd: 1.4826 * median(res.map((e) => Math.abs(e - md))) };
    };
    const forecast = (D) => {
      const base = dd.filter((r) => r.date < D).at(-1); if (!base) return null;
      const f = factors((F) => pubOff(F) <= D);
      const naive = (base.buy_sh * f.fb) / (base.sell_sh * f.fs);
      const gap = bdBetween(base.date, D);
      const lastJ = js.filter((r) => r.date > base.date && r.date <= D).at(-1);
      const c = lastJ ? jsfChange(base.date, lastJ.date) : null; const beta = c ? fitBeta(D) : null;
      let v = naive, sd = sdOf(gap, base.date), used = "persist", jsfTo = null;
      if (c && beta) {
        v = Math.exp(Math.log(naive) + beta.b * c.xb - beta.s * c.xs); used = "jsf"; jsfTo = c.to;
        const rem = sdOf(bdBetween(c.to, D), base.date); sd = rem === null ? null : Math.sqrt(beta.sd ** 2 * c.steps + rem ** 2);
      }
      const half = sd === null ? null : 1.96 * sd;
      return { fc: v, lo: half === null ? null : v * Math.exp(-half), hi: half === null ? null : v * Math.exp(half), base: base.date, gap, used, jsfTo, beta, fcNaive: naive };
    };
    const set = [...new Set([...dd.map((r) => r.date), ...(days || [])])].sort();
    return set.map((D) => {
      const r = dm.get(D); const o = offBy.get(D);
      const fa = factors((F) => F < D); // 実データの比は、その週より前の週の公表値から(先を見ない。dailyEstimates と同じ)
      const actual = r ? (r.buy_sh * fa.fb) / (r.sell_sh * fa.fs) : null;
      return { date: D, ...(forecast(D) || { fc: null, lo: null, hi: null, base: null, gap: null, used: null, jsfTo: null, beta: null, fcNaive: null }), actual, actualAt: r ? pubDaily.get(D) : null, off: o ? o.buy / o.sell : null, offAt: o ? pubOff(D) : null, offDue: pubOff(D) };
    });
  }
  // 全銘柄の約定金額ベースの評価損益率(つないだ系列)を、日付 → {x} で引けるようにする
  function linkSeries(daily) { const m = new Map(cleanDaily(daily).filter((r) => fin(r.pl_buy_link)).map((r) => [r.date, { x: r.pl_buy_link, n: r.n_priced }])); return (d) => m.get(d) || null; }
  // 指数(TOPIX など)の対数 × 100。その日以前で7日以内の終値
  function logIndex(rows) { const r = (rows || []).filter((x) => fin(x.c) && x.c > 0).sort((a, b) => (a.d < b.d ? -1 : 1)); return (d) => { const j = lastIdx(r, "d", d); if (j < 0 || t(d) - t(r[j].d) > 7 * DAY) return null; return { x: 100 * Math.log(r[j].c) }; }; }

  const api = { parseIrbank, mergeTargets, prepRows, simulate, build, xAt, fit, fitX, score, nowcast, nowcastX, cleanDaily, ratioCheck, ratioNowcast, ratioForecasts, gradeNowcasts, dailyEstimates, linkSeries, logIndex, monday, friday };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRMargin = api;
})(typeof window !== "undefined" ? window : globalThis);
