// Stock Rank — 手元のデータから一手間で出す分析(価格帯別出来高・アンカード VWAP・決算進捗・バリュエーションの帯・
// 為替/金利感応度・相対力・騰落レシオ・財務の質・権利落ち)。画面に依存しない計算だけを置く(node でもテストできる)。
(function (root) {
  "use strict";
  const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const DAY = 864e5;
  const toTime = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
  const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
  const tp = (r) => ((num(r.h) ?? r.c) + (num(r.l) ?? r.c) + r.c) / 3; // 典型価格

  // ---------- アンカード VWAP ----------
  // bars[i0] から先の VWAP(典型価格を出来高で加重)。i0 より前は NaN
  function anchoredVwap(bars, i0) {
    const out = new Array(bars.length).fill(NaN); let pv = 0, v = 0, sp = 0, n = 0;
    for (let i = Math.max(0, i0); i < bars.length; i++) {
      const vol = num(bars[i].v) || 0; const p = tp(bars[i]);
      pv += p * vol; v += vol; sp += p; n++;
      out[i] = v > 0 ? pv / v : sp / n;
    }
    return out;
  }

  // ---------- 価格帯別出来高 ----------
  // bars[from..to] の出来高を、各足の安値〜高値に均等に配って価格帯ごとに集計する。
  // POC = 一番出来高の多い価格帯、バリューエリア = POC から広げて出来高の 70% を含む範囲
  function volumeProfile(bars, from, to, bins = 30) {
    const list = bars.slice(Math.max(0, from), Math.min(bars.length, to + 1)).filter((r) => num(r.c) !== null);
    if (!list.length) return null;
    const lo = Math.min(...list.map((r) => num(r.l) ?? r.c)), hi = Math.max(...list.map((r) => num(r.h) ?? r.c));
    if (!(hi > lo)) return null;
    const step = (hi - lo) / bins;
    const out = Array.from({ length: bins }, (_, k) => ({ lo: lo + k * step, hi: lo + (k + 1) * step, vol: 0, up: 0, down: 0 }));
    list.forEach((r) => {
      const v = num(r.v) || 0; if (!v) return;
      const a = num(r.l) ?? r.c, b = num(r.h) ?? r.c; const isUp = r.c >= (num(r.o) ?? r.c);
      const k0 = Math.min(bins - 1, Math.floor((a - lo) / step)), k1 = Math.min(bins - 1, Math.floor((b - lo) / step));
      const share = v / (k1 - k0 + 1);
      for (let k = k0; k <= k1; k++) { out[k].vol += share; if (isUp) out[k].up += share; else out[k].down += share; }
    });
    const total = out.reduce((s, x) => s + x.vol, 0); if (!total) return null;
    let poc = 0; out.forEach((x, k) => { if (x.vol > out[poc].vol) poc = k; });
    let a = poc, b = poc, acc = out[poc].vol;
    while (acc < total * 0.7 && (a > 0 || b < bins - 1)) {
      const va = a > 0 ? out[a - 1].vol : -1, vb = b < bins - 1 ? out[b + 1].vol : -1;
      if (vb >= va) { b++; acc += out[b].vol; } else { a--; acc += out[a].vol; }
    }
    return { bins: out, poc, val: out[a].lo, vah: out[b].hi, pocPrice: (out[poc].lo + out[poc].hi) / 2, total, max: out[poc].vol };
  }

  // ---------- 決算の進捗率 ----------
  // 株探の四半期(3か月ごと)を会計年度ごとに累計し、通期(実績、今期は会社予想)に対する割合を出す。
  // 同じ四半期の過去の進捗率の平均と比べる(季節性のある会社は 25/50/75% の目安より過去の自社平均が当てになる)
  const PROGRESS_KEYS = [["sales", "売上高"], ["op", "営業利益"], ["ord", "経常利益"], ["net", "純利益"]];
  function progressTable(kabutan) {
    const annual = (kabutan?.annual || []).filter((r) => r.start && r.end && !r.irregular);
    const quarters = (kabutan?.quarter || []).filter((r) => r.start && r.end).sort((a, b) => (a.end < b.end ? -1 : 1));
    const years = [];
    annual.forEach((fy) => {
      const qs = quarters.filter((q) => q.start >= fy.start && q.end <= fy.end);
      if (!qs.length) return;
      const cum = {}; const steps = qs.map((q, i) => {
        const o = { period: q.period, end: q.end, announce: q.announce || null, n: Math.round((toTime(q.end) - toTime(fy.start)) / (91.3 * DAY)) || i + 1 };
        PROGRESS_KEYS.forEach(([k]) => { const v = num(q[k]); if (cum[k] === undefined) cum[k] = 0; cum[k] = cum[k] === null || v === null ? null : cum[k] + v; o[k] = cum[k]; o[`${k}P`] = cum[k] === null || !num(fy[k]) || num(fy[k]) <= 0 ? null : cum[k] / num(fy[k]); });
        return o;
      });
      years.push({ period: fy.period, start: fy.start, end: fy.end, forecast: !!fy.forecast, full: fy, steps });
    });
    // 過去の同じ四半期の進捗率の平均(実績の年度だけ)
    const avg = {};
    years.filter((y) => !y.forecast).forEach((y) => y.steps.forEach((s) => PROGRESS_KEYS.forEach(([k]) => { const v = s[`${k}P`]; if (v === null) return; const key = `${s.n}:${k}`; (avg[key] = avg[key] || []).push(v); })));
    const pastAvg = (n, k) => { const a = avg[`${n}:${k}`]; return a?.length ? { mean: a.reduce((x, y) => x + y, 0) / a.length, n: a.length } : null; };
    return { years: years.sort((a, b) => (a.start < b.start ? -1 : 1)), pastAvg };
  }

  // ---------- バリュエーションの帯(PER・PBR) ----------
  // perShare: [{from: 有効になる日, value: 1株あたり(分割調整済み)}] を日足に当てはめ、終値 ÷ 値 の分布(10/50/90%)で帯を引く
  // hist(省略可): 分布を取る足 [{d, c}](日足の画面でも、週足を含む全期間で分布を取るため)
  function valuationBand(bars, perShare, qs = [0.1, 0.5, 0.9], hist = null) {
    const list = (perShare || []).filter((x) => x.from && num(x.value) > 0).sort((a, b) => (a.from < b.from ? -1 : 1));
    if (!list.length) return null;
    const valuesOn = (rows, dateOf) => { let j = -1; return rows.map((r) => { while (j + 1 < list.length && list[j + 1].from <= dateOf(r)) j++; return j >= 0 ? list[j].value : null; }); };
    const vals = valuesOn(bars, (r) => r.end);
    const hrows = hist || bars; const hv = hist ? valuesOn(hist, (r) => r.d) : vals;
    const mult = hrows.map((r, i) => (hv[i] ? r.c / hv[i] : null)).filter((x) => x !== null && x > 0 && x < 1000).sort((a, b) => a - b);
    if (mult.length < 20) return null;
    const q = (p) => mult[Math.min(mult.length - 1, Math.max(0, Math.round(p * (mult.length - 1))))];
    const levels = qs.map((p) => ({ p, mult: q(p) }));
    const lastV = vals.at(-1); const lastM = lastV ? bars.at(-1).c / lastV : null;
    const rank = lastM === null ? null : mult.filter((x) => x <= lastM).length / mult.length;
    return { values: vals, levels, current: lastM, percentile: rank, n: mult.length };
  }

  // ---------- 回帰(最小二乗) ----------
  function invert(m) {
    const n = m.length; const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-14) return null; [a[c], a[p]] = [a[p], a[c]];
      const d = a[c][c]; for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k]; }
    }
    return a.map((row) => row.slice(n));
  }
  // y = X b + e。X の先頭列は定数 1。係数・共分散行列・決定係数を返す
  function ols(y, X) {
    const n = y.length, k = X[0]?.length || 0; if (n <= k + 2) return null;
    const xtx = Array.from({ length: k }, () => new Array(k).fill(0)); const xty = new Array(k).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) xtx[a][b] += X[i][a] * X[i][b]; }
    const inv = invert(xtx); if (!inv) return null;
    const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
    let sse = 0, sst = 0; const my = y.reduce((s, v) => s + v, 0) / n;
    for (let i = 0; i < n; i++) { const f = X[i].reduce((s, v, j) => s + v * beta[j], 0); sse += (y[i] - f) ** 2; sst += (y[i] - my) ** 2; }
    const s2 = sse / (n - k);
    return { beta, cov: inv.map((row) => row.map((v) => v * s2)), r2: sst ? 1 - sse / sst : null, n };
  }
  // 係数の和(例: 当日 + 前日)とその標準誤差
  function combo(fit, idx) {
    const b = idx.reduce((s, i) => s + fit.beta[i], 0); let v = 0;
    idx.forEach((i) => idx.forEach((j) => { v += fit.cov[i][j]; }));
    return { b, se: Math.sqrt(Math.max(v, 0)), t: v > 0 ? b / Math.sqrt(v) : null };
  }

  // ---------- 感応度(TOPIX・ドル円・米10年債) ----------
  // 東証の引け(15:30)の後に米国市場・ロンドン/NY の為替が動くので、ドル円と米金利は「当日+前日」の2本を入れて
  // 係数を足し合わせる(非同期取引の補正。Dimson のベータと同じ考え方)。TOPIX は同じ時間帯なので当日だけ。
  //   株価の日次リターン = a + β_TOPIX × TOPIX + β_fx0 × ドル円(当日) + β_fx1 × ドル円(前日) + γ0 × Δ金利(当日) + γ1 × Δ金利(前日)
  function seriesMap(rows) { const m = new Map(); (rows || []).forEach((r) => { if (num(r.c) !== null) m.set(r.d, r.c); }); return m; }
  function sensitivity(stock, factors, window = 250, opts = {}) {
    const s = (stock || []).filter((r) => num(r.c) !== null);
    const tpx = seriesMap(factors.tpx), fx = seriesMap(factors.fx), tnx = seriesMap(factors.tnx);
    // 各因子は「その日以前で最後の値」を使う(休日のずれ)
    const lastOn = (m) => { const keys = [...m.keys()].sort(); return (d) => { let lo = 0, hi = keys.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (keys[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans < 0 ? null : { i: ans, v: m.get(keys[ans]), keys }; }; };
    const fTpx = lastOn(tpx), fFx = lastOn(fx), fTnx = lastOn(tnx);
    const rows = [];
    for (let i = 2; i < s.length; i++) {
      const d = s[i].d, dp = s[i - 1].d;
      const a = fTpx(d), ap = fTpx(dp), b = fFx(d), bp = fFx(dp), c = fTnx(d), cp = fTnx(dp);
      if (!a || !ap || !b || !bp || !c || !cp || a.keys[a.i] !== d) continue; // TOPIX が同じ日に無い日(祝日のずれ)は除く
      const bpp = bp.i > 0 ? b.keys[bp.i - 1] : null, cpp = cp.i > 0 ? c.keys[cp.i - 1] : null;
      if (!bpp || !cpp) continue;
      const r = Math.log(s[i].c / s[i - 1].c), rm = Math.log(a.v / ap.v);
      const fx0 = Math.log(b.v / bp.v), fx1 = Math.log(bp.v / fx.get(bpp));
      const y0 = c.v - cp.v, y1 = cp.v - tnx.get(cpp);
      if (![r, rm, fx0, fx1, y0, y1].every(Number.isFinite) || Math.abs(r) > 0.4) continue;
      rows.push({ d, r, rm, fx0, fx1, y0, y1 });
    }
    const fit = (list) => {
      if (list.length < 40) return null;
      const f = ols(list.map((x) => x.r), list.map((x) => [1, x.rm, x.fx0, x.fx1, x.y0, x.y1])); if (!f) return null;
      const corr = (key) => { const xs = list.map((x) => x[key]), ys = list.map((x) => x.r); const mx = xs.reduce((p, v) => p + v, 0) / xs.length, my = ys.reduce((p, v) => p + v, 0) / ys.length; let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; }); return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; };
      return { n: list.length, from: list[0].d, to: list.at(-1).d, r2: f.r2, beta: combo(f, [1]), fx: combo(f, [2, 3]), rate: combo(f, [4, 5]), corrTpx: corr("rm"), corrFx: corr("fx1"), vol: Math.sqrt(list.reduce((p, x) => p + x.r * x.r, 0) / list.length * 250) };
    };
    const windows = (opts.windows || [60, 120, 250, Infinity]).map((w) => ({ w, fit: fit(rows.slice(-w)) }));
    // 為替感応度の推移(250日の窓を 20日ずつずらす)
    const roll = []; if (opts.roll !== false) for (let e = rows.length; e >= 250; e -= 20) { const f = fit(rows.slice(e - 250, e)); if (f) roll.unshift({ d: rows[e - 1].d, fx: f.fx.b, beta: f.beta.b, rate: f.rate.b }); }
    return { windows, roll, n: rows.length, main: windows.find((x) => x.w === window)?.fit || null };
  }

  // ---------- 相対力・リスク ----------
  function retOver(rows, days) { const n = rows.length; if (n <= days) return null; const a = rows[n - 1 - days].c, b = rows[n - 1].c; return a > 0 ? b / a - 1 : null; }
  // IBD の RS レーティングと同じ重み(直近3か月を2倍)
  function rsScore(rows) { const r3 = retOver(rows, 63), r6 = retOver(rows, 126), r9 = retOver(rows, 189), r12 = retOver(rows, 250); if ([r3, r6, r9, r12].some((x) => x === null)) return null; return 0.4 * r3 + 0.2 * r6 + 0.2 * r9 + 0.2 * r12; }
  function riskStats(rows) {
    const s = rows.filter((r) => num(r.c) !== null); const n = s.length; if (n < 30) return null;
    const rets = []; for (let i = 1; i < n; i++) rets.push(Math.log(s[i].c / s[i - 1].c));
    const vol = (k) => { const a = rets.slice(-k); if (a.length < 10) return null; const m = a.reduce((p, v) => p + v, 0) / a.length; return Math.sqrt(a.reduce((p, v) => p + (v - m) ** 2, 0) / (a.length - 1) * 250); };
    const last = s.slice(-250); let peak = -Infinity, mdd = 0; last.forEach((r) => { peak = Math.max(peak, r.h ?? r.c); mdd = Math.min(mdd, r.c / peak - 1); });
    const hi52 = Math.max(...last.map((r) => r.h ?? r.c)), lo52 = Math.min(...last.map((r) => r.l ?? r.c));
    const down = rets.slice(-250).filter((v) => v < 0); const dd = down.length ? Math.sqrt(down.reduce((p, v) => p + v * v, 0) / down.length * 250) : null;
    return { vol20: vol(20), vol60: vol(60), vol250: vol(250), downVol: dd, mdd250: mdd, fromHigh: s.at(-1).c / hi52 - 1, fromLow: s.at(-1).c / lo52 - 1, hi52, lo52 };
  }

  // ---------- 市場の騰落(対象銘柄の日足から) ----------
  // prices: {code: [{d, c}]}。日ごとの値上がり・値下がり銘柄数、騰落レシオ(25日)、新高値・新安値、25/200日線より上の割合
  function breadthSeries(prices, from = null) {
    const byDate = new Map();
    Object.values(prices).forEach((rows) => {
      const s = (rows || []).filter((r) => num(r.c) !== null); let s25 = 0, s200 = 0;
      // 直前 250 本の最高値・最安値(単調キューで O(n))
      const hiQ = [], loQ = [];
      const push = (i) => { while (hiQ.length && s[hiQ.at(-1)].c <= s[i].c) hiQ.pop(); hiQ.push(i); while (loQ.length && s[loQ.at(-1)].c >= s[i].c) loQ.pop(); loQ.push(i); };
      for (let i = 0; i < s.length; i++) {
        const c = s[i].c; s25 += c; s200 += c; if (i >= 25) s25 -= s[i - 25].c; if (i >= 200) s200 -= s[i - 200].c;
        while (hiQ.length && hiQ[0] < i - 250) hiQ.shift(); while (loQ.length && loQ[0] < i - 250) loQ.shift();
        const h = hiQ.length ? s[hiQ[0]].c : null, l = loQ.length ? s[loQ[0]].c : null;
        push(i);
        if (i === 0 || (from && s[i].d < from)) continue;
        const o = byDate.get(s[i].d) || { d: s[i].d, adv: 0, dec: 0, n: 0, above25: 0, above200: 0, n25: 0, n200: 0, hi: 0, lo: 0 };
        const p = s[i - 1].c; o.n++; if (c > p) o.adv++; else if (c < p) o.dec++;
        if (i >= 24) { o.n25++; if (c > s25 / 25) o.above25++; } if (i >= 199) { o.n200++; if (c > s200 / 200) o.above200++; }
        if (i >= 250) { if (c > h) o.hi++; if (c < l) o.lo++; }
        byDate.set(s[i].d, o);
      }
    });
    const days = [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
    const maxN = Math.max(0, ...days.map((x) => x.n)); const full = days.filter((x) => x.n >= maxN * 0.8);
    full.forEach((x, i) => { if (i < 24) { x.adRatio = null; return; } const w = full.slice(i - 24, i + 1); const a = w.reduce((p, y) => p + y.adv, 0), b = w.reduce((p, y) => p + y.dec, 0); x.adRatio = b ? a / b * 100 : null; });
    return full;
  }

  // ---------- 財務の質 ----------
  // IRBANK の通期(fin: periods × values)から期ごとに計算する。price(期末日) は期末の株価(分割調整前の実際の株価)
  function qualityTable(fin, ind, priceAtRaw) {
    if (!fin?.periods?.length) return [];
    const v = (blk, k, i) => num(blk?.values?.[k]?.[i]);
    return fin.periods.map((p, i) => {
      const end = `${String(p).replace("/", "-")}-28`;
      const ta = v(fin, "total_assets", i), tl = v(fin, "total_liabilities", i), ca = v(fin, "current_assets", i), cl = v(fin, "current_liabilities", i);
      const wc = v(fin, "working_capital", i) ?? (ca !== null && cl !== null ? ca - cl : null);
      const re = v(fin, "retained_earnings", i), ebit = v(fin, "ebit", i) ?? v(fin, "operating_profit", i), sales = v(fin, "sales", i);
      const shares = v(fin, "shares_outstanding", i), treasury = v(fin, "treasury_shares", i) || 0;
      const price = priceAtRaw ? priceAtRaw(end) : null;
      const mcap = price !== null && shares ? price * (shares - treasury) : null;
      const cash = v(fin, "cash_and_equivalents", i), debt = v(fin, "interest_bearing_debt", i);
      // アルトマンの Z スコア(製造業向けの原型)。1.81 未満は危険域、2.99 超は安全域とされる
      const z = ta && tl && wc !== null && re !== null && ebit !== null && sales !== null && mcap !== null ? 1.2 * wc / ta + 1.4 * re / ta + 3.3 * ebit / ta + 0.6 * mcap / tl + 1.0 * sales / ta : null;
      // 清原式ネットキャッシュ比率 = (流動資産 + 投資有価証券 × 70% − 負債合計) ÷ 時価総額。投資有価証券はデータが無いので 0 として控えめに出す
      const ncr = ca !== null && tl !== null && mcap ? (ca - tl) / mcap : null;
      return {
        period: p, mcap, z, ncr, netCash: cash !== null && debt !== null ? cash - debt : null, netCashToMcap: cash !== null && debt !== null && mcap ? (cash - debt) / mcap : null,
        fscore: v(ind, "piotroski_f_score", i), sloan: v(ind, "sloan_ratio", i), roic: v(ind, "roic", i), roe: v(ind, "roe", i) ?? v(fin, "roe", i), roa: v(ind, "roa", i),
        ccc: v(ind, "ccc", i), zmij: v(ind, "zmijewski_score", i), graham: v(ind, "graham_number", i), equityRatio: v(fin, "equity_ratio", i),
        fcf: v(fin, "fcf", i), ocf: v(fin, "operating_cf", i), net: v(fin, "net_income", i), accrualCf: v(fin, "net_income", i) !== null && v(fin, "operating_cf", i) !== null && ta ? (v(fin, "net_income", i) - v(fin, "operating_cf", i)) / ta : null,
      };
    });
  }

  // ---------- 権利落ち ----------
  // 権利確定日 = その月の最終営業日、権利付き最終日 = その 2 営業日前(2019年7月以降の T+2)、権利落ち日 = その翌営業日。
  // 日足の最後の営業日を数えて求める(祝日は日足に無いので自然に飛ぶ)
  function exDividendEvents(daily, months, before = 20, after = 20) {
    const s = (daily || []).filter((r) => num(r.c) !== null); const out = [];
    const byMonth = new Map(); s.forEach((r, i) => { const ym = r.d.slice(0, 7); byMonth.set(ym, i); }); // その月の最後の足
    const lastIdx = s.length - 1;
    [...byMonth.entries()].forEach(([ym, iLast]) => {
      const m = Number(ym.slice(5, 7)); if (!months.includes(m)) return;
      if (ym === s.at(-1).d.slice(0, 7) && iLast === lastIdx) return; // 月の途中(まだ月末が来ていない)
      const iCum = iLast - 2, iEx = iLast - 1; if (iCum < before || iEx > lastIdx) return;
      const pre = s[iCum - before].c, cum = s[iCum].c, ex = s[iEx].c, post = iEx + after <= lastIdx ? s[iEx + after].c : null;
      out.push({ month: ym, cumDate: s[iCum].d, exDate: s[iEx].d, runUp: cum / pre - 1, exDrop: ex / cum - 1, after: post === null ? null : post / ex - 1, cumClose: cum });
    });
    return out;
  }

  const api = { anchoredVwap, volumeProfile, progressTable, PROGRESS_KEYS, valuationBand, ols, sensitivity, retOver, rsScore, riskStats, breadthSeries, qualityTable, exDividendEvents };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRAna = api;
})(typeof window !== "undefined" ? window : globalThis);
