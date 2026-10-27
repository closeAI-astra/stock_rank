// Stock Rank — 相関を探す(全銘柄の2つの指標の散布図と相関)。画面に依存しない計算だけ(node でもテストできる)
//
// 銘柄データ: {code, prices: [{d, h, l, c, v}](古い順。dailyFrom より前は週足), dailyFrom, credit: 推定信用のrows, shares}
// 基準日 T の「過去の指標」は T までの値だけで、「先の指標」は T の翌日から m か月後までの値で計算する(先を見て過去を決めない)
(function (root) {
  "use strict";
  const DAY = 864e5, MONTH = 30.44 * DAY;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const fin = (x) => typeof x === "number" && Number.isFinite(x);

  function lastIdx(rows, date) { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].d <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
  // 週足の出来高は1日あたりに直す(日足と並べて平均するため)
  const vDay = (s, r) => (fin(r.v) ? (r.d < s.dailyFrom ? r.v / 5 : r.v) : null);

  // ---------- 指標 ----------
  // ctx: {s: 銘柄, T: 基準日, iT: T の足の位置, n: 過去の月数, m: 先の月数}
  const past = (ctx) => { const from = iso(t(ctx.T) - ctx.n * MONTH); const i0 = lastIdx(ctx.s.prices, from); return i0 < 0 || t(from) - t(ctx.s.prices[i0].d) > 10 * DAY ? null : i0; };
  const future = (ctx) => { const end = iso(t(ctx.T) + ctx.m * MONTH); const p = ctx.s.prices; if (!p.length || t(p.at(-1).d) < t(end) - 5 * DAY) return null; return lastIdx(p, end); };
  // 信用残は申込日の行。基準日より前で一番新しい行(3週より古ければ無し)
  const credit = (ctx, back = 0) => { const s = ctx.s; if (!s._cd) s._cd = (s.credit || []).map((r) => ({ d: r.date })); const lim = iso(t(ctx.T) - back * DAY); const r = s.credit?.[lastIdx(s._cd, lim)]; return r && t(lim) - t(r.date) <= 21 * DAY ? r : null; };
  // 分割の前後で比べられるように、今の株数にそろえた残高
  const adj = (r, k) => (r && fin(r[k]) ? r[k] * (r.splitFactor || 1) : null);
  const avgV = (ctx, days) => { const p = ctx.s.prices; const lim = iso(t(ctx.T) - days * DAY); let s = 0, k = 0; for (let i = ctx.iT; i >= 0 && p[i].d > lim; i--) { const v = vDay(ctx.s, p[i]); if (v !== null) { s += v * (p[i].d < ctx.s.dailyFrom ? 5 : 1); k += p[i].d < ctx.s.dailyFrom ? 5 : 1; } } return k ? s / k : null; };

  const METRICS = [
    // 値動き(過去)
    { key: "ret", label: "過去 n か月の騰落率", group: "値動き(過去)", pct: true, f: (c) => { const i0 = past(c); return i0 === null ? null : c.s.prices[c.iT].c / c.s.prices[i0].c - 1; } },
    { key: "dd", label: "過去 n か月の最大の下げ(高値からの調整の深さ)", group: "値動き(過去)", pct: true, f: (c) => { const i0 = past(c); if (i0 === null) return null; let mx = -Infinity, dd = 0; for (let i = i0; i <= c.iT; i++) { const x = c.s.prices[i].c; mx = Math.max(mx, x); dd = Math.min(dd, x / mx - 1); } return dd; } },
    { key: "fromHigh", label: "n か月の高値からの位置(今どれだけ下か)", group: "値動き(過去)", pct: true, f: (c) => { const i0 = past(c); if (i0 === null) return null; let mx = -Infinity; for (let i = i0; i <= c.iT; i++) mx = Math.max(mx, c.s.prices[i].h ?? c.s.prices[i].c); return c.s.prices[c.iT].c / mx - 1; } },
    { key: "rebound", label: "n か月の安値からの戻り", group: "値動き(過去)", pct: true, f: (c) => { const i0 = past(c); if (i0 === null) return null; let mn = Infinity; for (let i = i0; i <= c.iT; i++) mn = Math.min(mn, c.s.prices[i].l ?? c.s.prices[i].c); return c.s.prices[c.iT].c / mn - 1; } },
    { key: "ma25dev", label: "25日線からの乖離", group: "値動き(過去)", pct: true, f: (c) => { const p = c.s.prices; if (c.iT < 25 || p[c.iT - 24].d < c.s.dailyFrom) return null; let s = 0; for (let i = c.iT - 24; i <= c.iT; i++) s += p[i].c; return p[c.iT].c / (s / 25) - 1; } },
    { key: "vol", label: "ボラティリティ(年率・直近3か月)", group: "値動き(過去)", pct: true, f: (c) => { const p = c.s.prices; const lim = iso(t(c.T) - 92 * DAY); const r = []; let gap = 0; for (let i = c.iT; i > 0 && p[i - 1].d >= lim; i--) { r.push(Math.log(p[i].c / p[i - 1].c)); gap += (t(p[i].d) - t(p[i - 1].d)) / DAY; } if (r.length < 8) return null; const m = r.reduce((a, b) => a + b, 0) / r.length; const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1); return Math.sqrt(v * 365 / (gap / r.length)); } },
    // 出来高
    { key: "volRatio", label: "出来高の増え方(直近1か月 ÷ 過去6か月)", group: "出来高", f: (c) => { const a = avgV(c, 31), b = avgV(c, 183); return a && b ? a / b : null; } },
    { key: "volRatio5", label: "出来高の増え方(直近1週 ÷ 過去3か月)", group: "出来高", f: (c) => { const a = avgV(c, 7), b = avgV(c, 92); return a && b ? a / b : null; } },
    { key: "turnover", label: "売買代金(直近1か月の1日平均・億円)", group: "出来高", log: true, f: (c) => { const a = avgV(c, 31); return a ? a * c.s.prices[c.iT].c / 1e8 : null; } },
    // 信用
    { key: "ratio", label: "信用倍率", group: "信用残", log: true, f: (c) => { const r = credit(c); return r && r.ratio > 0 ? r.ratio : null; } },
    { key: "buyToShares", label: "買残 ÷ 発行済株式", group: "信用残", pct: true, f: (c) => { const b = adj(credit(c), "buy"); return b !== null && c.s.shares ? b / c.s.shares : null; } },
    { key: "sellToShares", label: "売残 ÷ 発行済株式", group: "信用残", pct: true, f: (c) => { const b = adj(credit(c), "sell"); return b !== null && c.s.shares ? b / c.s.shares : null; } },
    { key: "buyDays", label: "買残 ÷ 20日平均出来高(日数)", group: "信用残", log: true, f: (c) => { const r = credit(c); return r && r.buyDays > 0 ? r.buyDays : null; } },
    { key: "buyChg", label: "買残の4週の増減率", group: "信用残", pct: true, f: (c) => { const a = adj(credit(c), "buy"), b = adj(credit(c, 28), "buy"); return a !== null && b > 0 ? a / b - 1 : null; } },
    { key: "sellChg", label: "売残の4週の増減率", group: "信用残", pct: true, f: (c) => { const a = adj(credit(c), "sell"), b = adj(credit(c, 28), "sell"); return a !== null && b > 0 ? a / b - 1 : null; } },
    { key: "buyPnl", label: "推定 買い方評価損益率", group: "信用残", pct: true, f: (c) => { const r = credit(c); return r && !r.warmup && fin(r.buyPnl) ? r.buyPnl : null; } },
    // 規模
    { key: "mcap", label: "時価総額(億円)", group: "規模", log: true, f: (c) => (c.s.shares ? c.s.shares * c.s.prices[c.iT].c / 1e8 : null) },
    // その後(基準日の翌日から m か月)
    { key: "fret", label: "その後 m か月の騰落率", group: "その後(先の値動き)", pct: true, future: true, f: (c) => { const j = future(c); return j === null ? null : c.s.prices[j].c / c.s.prices[c.iT].c - 1; } },
    { key: "fdd", label: "その後 m か月の最大の下げ", group: "その後(先の値動き)", pct: true, future: true, f: (c) => { const j = future(c); if (j === null) return null; let mx = c.s.prices[c.iT].c, dd = 0; for (let i = c.iT + 1; i <= j; i++) { const x = c.s.prices[i].c; mx = Math.max(mx, x); dd = Math.min(dd, x / mx - 1); } return dd; } },
    { key: "fup", label: "その後 m か月の最大の上げ", group: "その後(先の値動き)", pct: true, future: true, f: (c) => { const j = future(c); if (j === null) return null; let mx = c.s.prices[c.iT].c; for (let i = c.iT + 1; i <= j; i++) mx = Math.max(mx, c.s.prices[i].h ?? c.s.prices[i].c); return mx / c.s.prices[c.iT].c - 1; } },
  ];
  const byKey = Object.fromEntries(METRICS.map((m) => [m.key, m]));

  // 1つの基準日で全銘柄の2つの指標を計算する
  function points(stocks, T, xKey, yKey, n, m) {
    const out = []; const X = byKey[xKey], Y = byKey[yKey];
    stocks.forEach((s) => {
      const iT = lastIdx(s.prices, T); if (iT < 0 || t(T) - t(s.prices[iT].d) > 7 * DAY) return;
      const ctx = { s, T, iT, n, m }; const x = X.f(ctx), y = Y.f(ctx);
      if (!fin(x) || !fin(y)) return;
      out.push({ code: s.code, name: s.name, industry: s.industry, T, x: X.log ? Math.log10(x) : x, y: Y.log ? Math.log10(y) : y, rawX: x, rawY: y });
    });
    return out;
  }
  // 基準日の列(毎月末に近い営業日)。from〜to
  function monthlyDates(lastDate, months) { const out = []; const end = new Date(t(lastDate)); for (let k = months; k >= 0; k--) { const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - k + 1, 0)); out.push(iso(Math.min(d.getTime(), t(lastDate)))); } return [...new Set(out)]; }

  // 1銘柄の時系列で見るときの基準日(日足のある期間の毎週末)
  function weeklyDates(s) { const out = []; let last = null; s.prices.forEach((r) => { if (r.d < s.dailyFrom) return; const wk = Math.floor((t(r.d) / DAY + 3) / 7); if (wk !== last) { out.push(r.d); last = wk; } else out[out.length - 1] = r.d; }); return out; }

  // ---------- 統計 ----------
  // 外れ値の影響を抑えるため、上下 1% で切り詰めてからピアソンの相関を取る。順位(スピアマン)は外れ値に強い
  function winsor(a, p = 0.01) { const s = a.slice().sort((x, y) => x - y); const lo = s[Math.floor(p * (s.length - 1))], hi = s[Math.ceil((1 - p) * (s.length - 1))]; return a.map((x) => Math.min(hi, Math.max(lo, x))); }
  function pearson(x, y) { const n = x.length; if (n < 3) return null; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; }
  function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
  function stats(pts) {
    const n = pts.length; if (n < 10) return { n };
    const x = winsor(pts.map((p) => p.x)), y = winsor(pts.map((p) => p.y));
    const r = pearson(x, y), rho = pearson(ranks(pts.map((p) => p.x)), ranks(pts.map((p) => p.y)));
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : null;
    // 相関が 0 なら |t| が 2 を超えるのは 5% 程度(同じ基準日に銘柄どうしが似た動きをするので、本当はもっと甘めに見る)
    const tval = rho === null || Math.abs(rho) >= 1 ? null : rho * Math.sqrt((n - 2) / (1 - rho * rho));
    // X の5分位ごとの Y
    const order = pts.map((p, i) => i).sort((a, b) => pts[a].x - pts[b].x);
    const q = [0, 1, 2, 3, 4].map((k) => { const ids = order.slice(Math.floor(k * n / 5), Math.floor((k + 1) * n / 5)); const ys = ids.map((i) => pts[i].y).sort((a, b) => a - b); const xs = ids.map((i) => pts[i].x); return { k: k + 1, n: ids.length, xMin: Math.min(...xs), xMax: Math.max(...xs), mean: ys.reduce((a, b) => a + b, 0) / ys.length, median: ys[Math.floor(ys.length / 2)], pos: ys.filter((v) => v > 0).length / ys.length }; });
    // X を10等分した区間ごとの中央値(直線でない関係の形を見る)
    const med = (a) => { const v = a.slice().sort((u, w) => u - w); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
    const bins = Array.from({ length: 10 }, (_, k) => order.slice(Math.floor(k * n / 10), Math.floor((k + 1) * n / 10))).filter((ids) => ids.length).map((ids) => ({ x: med(ids.map((i) => pts[i].x)), y: med(ids.map((i) => pts[i].y)) }));
    return { n, r, rho, slope, intercept: slope === null ? null : my - slope * mx, t: tval, quintiles: q, bins };
  }
  // ある Y に対して、ほかの全部の指標の相関(順位)を並べる
  function scan(stocks, dates, yKey, n, m) {
    return METRICS.filter((X) => X.key !== yKey && !X.future).map((X) => {
      const pts = dates.flatMap((T) => points(stocks, T, X.key, yKey, n, m));
      const s = stats(pts); return { key: X.key, label: X.label, group: X.group, n: s.n, rho: s.rho ?? null, r: s.r ?? null, t: s.t ?? null };
    }).sort((a, b) => Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0));
  }

  const api = { METRICS, byKey, points, monthlyDates, weeklyDates, stats, scan, pearson, ranks, winsor, lastIdx };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRExplore = api;
})(typeof window !== "undefined" ? window : globalThis);
