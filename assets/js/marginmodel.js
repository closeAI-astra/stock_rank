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
(function (root) {
  "use strict";
  const DAY = 864e5;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
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
  function fit(targets, built, opts = {}) {
    const minTrain = opts.minTrain ?? 12, warm = opts.warm ?? 91;
    const w = targets.map((o) => { const a = xAt(built, o.date, warm); return a ? { ...o, x: a.x, n: a.n } : null; }).filter(Boolean);
    const weekly = w.map((o, k) => {
      if (k < minTrain) return { ...o, pred: null, naive: k ? w[k - 1].y : null };
      const tr = w.slice(0, k); const b = slope0(tr.slice(1).map((p, i) => p.x - tr[i].x), tr.slice(1).map((p, i) => p.y - tr[i].y));
      const last = tr.at(-1); return { ...o, b, naive: last.y, pred: last.y + b * (o.x - last.x) };
    });
    const ev = weekly.filter((o) => o.pred !== null);
    const mae = (f) => (ev.length ? ev.reduce((a, o) => a + Math.abs(f(o) - o.y), 0) / ev.length : null);
    const rmse = (f) => (ev.length ? Math.sqrt(ev.reduce((a, o) => a + (f(o) - o.y) ** 2, 0) / ev.length) : null);
    const b = w.length > 2 ? slope0(w.slice(1).map((p, i) => p.x - w[i].x), w.slice(1).map((p, i) => p.y - w[i].y)) : null;
    return { weekly, b, n: w.length, nEval: ev.length, mae: mae((o) => o.pred), rmse: rmse((o) => o.pred), maeNaive: mae((o) => o.naive), rmseNaive: rmse((o) => o.naive), hit: ev.length ? ev.filter((o) => Math.sign(o.pred - o.naive) === Math.sign(o.y - o.naive)).length / ev.length : null };
  }
  // 最後の公表日より後の各営業日の推定。誤差の幅は、検証の誤差(1週先)を √(公表日からの週数) 倍に広げる
  function nowcast(model, built, days, warm = 91) {
    const last = model.weekly.at(-1); if (!last || model.b === null) return [];
    const sd = model.rmse ?? model.rmseNaive ?? 2;
    return days.filter((d) => d > last.date).map((d) => {
      const a = xAt(built, d, warm); if (!a) return null;
      const wk = Math.max(1, (t(d) - t(last.date)) / DAY / 7);
      const y = last.y + model.b * (a.x - last.x); const half = 1.96 * sd * Math.sqrt(Math.ceil(wk - 1e-9));
      return { date: d, y, lo: y - half, hi: y + half, x: a.x, n: a.n, weeks: wk };
    }).filter(Boolean);
  }

  const api = { parseIrbank, mergeTargets, prepRows, simulate, build, xAt, fit, nowcast };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRMargin = api;
})(typeof window !== "undefined" ? window : globalThis);
