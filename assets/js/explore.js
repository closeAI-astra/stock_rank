// Stock Rank — 相関を探す(全銘柄の2つの指標の散布図と相関)。画面に依存しない計算だけ(node でもテストできる)
//
// 銘柄データ s: {code, name, industry, prices: [{d, h, l, c, v}](古い順。dailyFrom より前は週足。分割調整済み), dailyFrom,
//   credit: 推定信用の rows, shares: 発行済株式数, fund: 株探の業績 {annual, balance, quarter}, inst: {shorts, lending, buyback, large}}
// 市場 mkt: TOPIX の日足 [{d, c}]
// 基準日 T の「過去の指標」は T までに公表された値だけで、「先の指標」は T の翌日から m か月後までの値で計算する(先を見て過去を決めない)
(function (root) {
  "use strict";
  const DAY = 864e5, MONTH = 30.44 * DAY;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const fin = (x) => typeof x === "number" && Number.isFinite(x);
  const pos = (x) => fin(x) && x > 0;

  function lastIdx(rows, date) { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].d <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
  // 週足の出来高は1日あたりに直す(日足と並べて平均するため)
  const vDay = (s, r) => (fin(r.v) ? (r.d < s.dailyFrom ? r.v / 5 : r.v) : null);
  // 期間の呼び名(0.25 = 1週)
  const periodLabel = (v) => (v === 0.25 ? "1週" : v === 0.5 ? "2週" : `${v}か月`);

  // ---------- 共通の部品 ----------
  // ctx: {s: 銘柄, T: 基準日, iT: T の足の位置, n: 過去の月数, m: 先の月数, mkt: TOPIX}
  const backIdx = (ctx, months) => { const from = iso(t(ctx.T) - months * MONTH); const i0 = lastIdx(ctx.s.prices, from); return i0 < 0 || t(from) - t(ctx.s.prices[i0].d) > 10 * DAY ? null : i0; };
  const past = (ctx) => backIdx(ctx, ctx.n);
  const future = (ctx) => { const end = iso(t(ctx.T) + ctx.m * MONTH); const p = ctx.s.prices; if (!p.length || t(p.at(-1).d) < t(end) - 5 * DAY) return null; return lastIdx(p, end); };
  const close = (ctx) => ctx.s.prices[ctx.iT].c;
  const mcap = (ctx) => (ctx.s.shares ? ctx.s.shares * close(ctx) : null);
  // 信用残は申込日の行。基準日より前で一番新しい行(3週より古ければ無し)
  const credit = (ctx, back = 0) => { const s = ctx.s; if (!s._cd) s._cd = (s.credit || []).map((r) => ({ d: r.date })); const lim = iso(t(ctx.T) - back * DAY); const r = s.credit?.[lastIdx(s._cd, lim)]; return r && t(lim) - t(r.date) <= 21 * DAY ? r : null; };
  // 分割の前後で比べられるように、今の株数にそろえた残高
  const adj = (r, k) => (r && fin(r[k]) ? r[k] * (r.splitFactor || 1) : null);
  const avgV = (ctx, days, endBack = 0) => { const p = ctx.s.prices; const hi = iso(t(ctx.T) - endBack * DAY), lim = iso(t(ctx.T) - (days + endBack) * DAY); let s = 0, k = 0; for (let i = ctx.iT; i >= 0 && p[i].d > lim; i--) { if (p[i].d > hi) continue; const v = vDay(ctx.s, p[i]); if (v !== null) { const w = p[i].d < ctx.s.dailyFrom ? 5 : 1; s += v * w; k += w; } } return k ? s / k : null; };
  // 日足の終値の移動平均(日足が足りなければ null)
  const sma = (ctx, k) => { const p = ctx.s.prices; if (ctx.iT < k - 1 || p[ctx.iT - k + 1].d < ctx.s.dailyFrom) return null; let s = 0; for (let i = ctx.iT - k + 1; i <= ctx.iT; i++) s += p[i].c; return s / k; };
  // TOPIX の終値(その日以前で一番新しい日)
  const mktAt = (ctx, date) => { const m = ctx.mkt; if (!m?.length) return null; const i = lastIdx(m, date); return i < 0 || t(date) - t(m[i].d) > 7 * DAY ? null : m[i].c; };
  const mktRet = (ctx, d0, d1) => { const a = mktAt(ctx, d0), b = mktAt(ctx, d1); return a && b ? b / a - 1 : null; };
  // 日次リターン(銘柄と TOPIX の同じ日)。基準日から days 日さかのぼる
  function dailyPairs(ctx, days) {
    const p = ctx.s.prices, m = ctx.mkt; if (!m?.length) return null;
    if (!ctx.s._mi) { const mi = new Map(m.map((r, i) => [r.d, i])); ctx.s._mi = p.map((r) => mi.get(r.d) ?? -1); }
    const lim = iso(t(ctx.T) - days * DAY); const xs = [], ys = [];
    for (let i = ctx.iT; i > 0 && p[i - 1].d >= lim && p[i - 1].d >= ctx.s.dailyFrom; i--) {
      const a = ctx.s._mi[i], b = ctx.s._mi[i - 1]; if (a < 0 || b < 0 || a - b !== 1) continue;
      xs.push(Math.log(m[a].c / m[b].c)); ys.push(Math.log(p[i].c / p[i - 1].c));
    }
    return xs.length >= 40 ? { xs, ys } : null;
  }
  // TOPIX に対する β・相関・固有ボラティリティ(過去1年の日次)。同じ銘柄・基準日では1回だけ計算する
  function market(ctx) {
    const s = ctx.s; if (!s._mk) s._mk = new Map(); if (s._mk.has(ctx.T)) return s._mk.get(ctx.T);
    let out = null; const d = dailyPairs(ctx, 365);
    if (d) {
      const n = d.xs.length, mx = d.xs.reduce((a, b) => a + b, 0) / n, my = d.ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (d.xs[i] - mx) * (d.ys[i] - my); sxx += (d.xs[i] - mx) ** 2; syy += (d.ys[i] - my) ** 2; }
      const beta = sxx ? sxy / sxx : null; const res = beta === null ? null : Math.max(0, syy - beta * sxy) / (n - 2);
      out = { beta, corr: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, idio: res === null ? null : Math.sqrt(res * 245) };
    }
    s._mk.set(ctx.T, out); return out;
  }
  // 相対力(RS = 株価 ÷ TOPIX)。RRG(Relative Rotation Graph)の RS-Ratio・RS-Momentum の近似:
  //   RS-Ratio = 100 × RS の10日平均 ÷ RS の60日平均(100 より上 = TOPIX より強い流れ)
  //   RS-Momentum = 100 × 直近5日の RS-Ratio の平均 ÷ 10営業日前までの5日の平均(100 より上 = 強さが増している)
  //   本家(JdK)の計算式は公開されていないので、同じ考え方の近似です
  function rsAt(ctx, i, k) { const p = ctx.s.prices, m = ctx.mkt; if (!ctx.s._mi) dailyPairs(ctx, 1); if (i - k + 1 < 0 || p[i - k + 1].d < ctx.s.dailyFrom) return null; let s = 0; for (let j = i - k + 1; j <= i; j++) { const a = ctx.s._mi[j]; if (a < 0) return null; s += p[j].c / m[a].c; } return s / k; }
  const rsRatioAt = (ctx, i) => { if (!ctx.mkt?.length) return null; const a = rsAt(ctx, i, 10), b = rsAt(ctx, i, 60); return a && b ? 100 * a / b : null; };
  // 株探の業績: 基準日までに公表された行(availableFrom ≤ T)のうち一番新しいもの
  const avail = (r) => r.availableFrom || r.announce || null;
  function latest(rows, T, ok = () => true) { let best = null; (rows || []).forEach((r) => { const a = avail(r); if (a && a <= T && ok(r) && (!best || a > avail(best) || (a === avail(best) && String(r.period) > String(best.period)))) best = r; }); return best; }
  const fund = (ctx, k) => ctx.s.fund?.[k] || [];
  const annualFc = (ctx) => latest(fund(ctx, "annual"), ctx.T, (r) => r.forecast && !r.irregular);
  const annualAct = (ctx) => latest(fund(ctx, "annual"), ctx.T, (r) => !r.forecast && !r.irregular);
  // 期の終わりがおよそ1年前の行
  const yearAgo = (rows, r) => rows.find((x) => x !== r && x.end && r.end && Math.abs(t(r.end) - t(x.end) - 365 * DAY) < 20 * DAY && !x.forecast);
  // 機関の需給: 空売り残高報告の合計(基準日の時点で残っている各報告者の最新の割合の合計、%)
  function shortSum(ctx) {
    const list = ctx.s.inst?.shorts; if (!list?.length) return ctx.s.inst ? 0 : null;
    const cur = new Map(); list.filter((r) => r.date <= ctx.T).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((r) => cur.set(`${r.holder}|${r.client || ""}|${r.fund || ""}`, r));
    return [...cur.values()].reduce((a, r) => a + (fin(r.ratio) ? r.ratio : 0), 0) / 100;
  }
  const lending = (ctx) => { const l = ctx.s.inst?.lending; if (!l?.length) return null; let r = null; l.forEach((x) => { if (x.date <= ctx.T && (!r || x.date > r.date)) r = x; }); return r && t(ctx.T) - t(r.date) <= 10 * DAY ? r : null; };
  const instSince = (ctx) => ctx.s.inst?.since || "9999";

  // ---------- 指標 ----------
  // pct: 割合(% 表示) / log: 対数目盛 / future: 基準日より先の値 / center: 図の基準線
  const METRICS = [
    // 値動き(過去)
    { key: "ret", label: "過去 n か月の騰落率", group: "値動き", pct: true, f: (c) => { const i0 = past(c); return i0 === null ? null : close(c) / c.s.prices[i0].c - 1; } },
    { key: "excess", label: "過去 n か月の対TOPIX超過リターン", group: "値動き", pct: true, f: (c) => { const i0 = past(c); if (i0 === null) return null; const m = mktRet(c, c.s.prices[i0].d, c.T); return m === null ? null : close(c) / c.s.prices[i0].c - 1 - m; } },
    { key: "dd", label: "過去 n か月の最大の下げ(高値からの調整の深さ)", group: "値動き", pct: true, f: (c) => { const i0 = past(c); if (i0 === null) return null; let mx = -Infinity, dd = 0; for (let i = i0; i <= c.iT; i++) { const x = c.s.prices[i].c; mx = Math.max(mx, x); dd = Math.min(dd, x / mx - 1); } return dd; } },
    { key: "fromHigh", label: "n か月の高値からの位置(今どれだけ下か)", group: "値動き", pct: true, f: (c) => { const i0 = past(c); if (i0 === null) return null; let mx = -Infinity; for (let i = i0; i <= c.iT; i++) mx = Math.max(mx, c.s.prices[i].h ?? c.s.prices[i].c); return close(c) / mx - 1; } },
    { key: "rebound", label: "n か月の安値からの戻り", group: "値動き", pct: true, f: (c) => { const i0 = past(c); if (i0 === null) return null; let mn = Infinity; for (let i = i0; i <= c.iT; i++) mn = Math.min(mn, c.s.prices[i].l ?? c.s.prices[i].c); return close(c) / mn - 1; } },
    { key: "mom12_1", label: "12-1か月モメンタム(1年前から1か月前までの騰落)", group: "値動き", pct: true, f: (c) => { const a = backIdx(c, 12), b = backIdx(c, 1); return a === null || b === null ? null : c.s.prices[b].c / c.s.prices[a].c - 1; } },
    { key: "ma25dev", label: "25日線からの乖離", group: "値動き", pct: true, f: (c) => { const m = sma(c, 25); return m ? close(c) / m - 1 : null; } },
    { key: "ma75dev", label: "75日線からの乖離", group: "値動き", pct: true, f: (c) => { const m = sma(c, 75); return m ? close(c) / m - 1 : null; } },
    { key: "ma200dev", label: "200日線からの乖離", group: "値動き", pct: true, f: (c) => { const m = sma(c, 200); return m ? close(c) / m - 1 : null; } },
    { key: "rsi", label: "RSI(14日)", group: "値動き", center: 50, f: (c) => { const p = c.s.prices; const k0 = Math.max(1, c.iT - 120); if (p[k0 - 1].d < c.s.dailyFrom || c.iT - k0 < 30) return null; let up = 0, dn = 0; for (let i = k0; i < k0 + 14; i++) { const d = p[i].c - p[i - 1].c; up += Math.max(d, 0); dn += Math.max(-d, 0); } up /= 14; dn /= 14; for (let i = k0 + 14; i <= c.iT; i++) { const d = p[i].c - p[i - 1].c; up = (up * 13 + Math.max(d, 0)) / 14; dn = (dn * 13 + Math.max(-d, 0)) / 14; } return up + dn ? 100 * up / (up + dn) : null; } },
    { key: "maxRet", label: "直近1か月の最大の日次上昇率", group: "値動き", pct: true, f: (c) => { const p = c.s.prices; const lim = iso(t(c.T) - 31 * DAY); let mx = null; for (let i = c.iT; i > 0 && p[i - 1].d >= lim && p[i - 1].d >= c.s.dailyFrom; i--) mx = Math.max(mx ?? -Infinity, p[i].c / p[i - 1].c - 1); return mx; } },
    { key: "vol", label: "ボラティリティ(年率・直近3か月)", group: "値動き", pct: true, f: (c) => { const p = c.s.prices; const lim = iso(t(c.T) - 92 * DAY); const r = []; let gap = 0; for (let i = c.iT; i > 0 && p[i - 1].d >= lim; i--) { r.push(Math.log(p[i].c / p[i - 1].c)); gap += (t(p[i].d) - t(p[i - 1].d)) / DAY; } if (r.length < 8) return null; const m = r.reduce((a, b) => a + b, 0) / r.length; const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1); return Math.sqrt(v * 365 / (gap / r.length)); } },
    // 市場との関係
    { key: "beta", label: "β(TOPIX・過去1年の日次)", group: "市場との関係", center: 1, f: (c) => market(c)?.beta ?? null },
    { key: "corrMkt", label: "TOPIX との相関(過去1年の日次)", group: "市場との関係", f: (c) => market(c)?.corr ?? null },
    { key: "idio", label: "固有ボラティリティ(TOPIX で説明できない分・年率)", group: "市場との関係", pct: true, f: (c) => market(c)?.idio ?? null },
    { key: "rsRatio", label: "RRG: RS-Ratio(TOPIX に対する強さ・近似)", group: "市場との関係", center: 100, f: (c) => rsRatioAt(c, c.iT) },
    { key: "rsMom", label: "RRG: RS-Momentum(強さの勢い・近似)", group: "市場との関係", center: 100, f: (c) => { if (c.iT < 15) return null; let a = 0, b = 0; for (let k = 0; k < 5; k++) { const u = rsRatioAt(c, c.iT - k), v = rsRatioAt(c, c.iT - 10 - k); if (!u || !v) return null; a += u; b += v; } return 100 * a / b; } },
    // 出来高
    { key: "volRatio", label: "出来高の増え方(直近1か月 ÷ 過去6か月)", group: "出来高", log: true, center: 1, f: (c) => { const a = avgV(c, 31), b = avgV(c, 183); return a && b ? a / b : null; } },
    { key: "volRatio5", label: "出来高の増え方(直近1週 ÷ 過去3か月)", group: "出来高", log: true, center: 1, f: (c) => { const a = avgV(c, 7), b = avgV(c, 92); return a && b ? a / b : null; } },
    { key: "volRatioN", label: "出来高の増え方(直近 n か月 ÷ その前の n か月)", group: "出来高", log: true, center: 1, f: (c) => { const d = Math.round(c.n * 30.44); const a = avgV(c, d), b = avgV(c, d, d); return a && b ? a / b : null; } },
    { key: "turnover", label: "売買代金(直近1か月の1日平均・億円)", group: "出来高", log: true, f: (c) => { const a = avgV(c, 31); return a ? a * close(c) / 1e8 : null; } },
    { key: "turnRate", label: "売買回転率(1か月の出来高 ÷ 発行済株式)", group: "出来高", pct: true, log: true, f: (c) => { const a = avgV(c, 31); return a && c.s.shares ? a * 21 / c.s.shares : null; } },
    // 信用
    { key: "ratio", label: "信用倍率", group: "信用残", log: true, center: 1, f: (c) => { const r = credit(c); return r && r.ratio > 0 ? r.ratio : null; } },
    { key: "ratioChg", label: "信用倍率の4週の変化(倍)", group: "信用残", log: true, center: 1, f: (c) => { const a = credit(c), b = credit(c, 28); return a && b && a.ratio > 0 && b.ratio > 0 ? a.ratio / b.ratio : null; } },
    { key: "buyToShares", label: "買残 ÷ 発行済株式", group: "信用残", pct: true, f: (c) => { const b = adj(credit(c), "buy"); return b !== null && c.s.shares ? b / c.s.shares : null; } },
    { key: "sellToShares", label: "売残 ÷ 発行済株式", group: "信用残", pct: true, f: (c) => { const b = adj(credit(c), "sell"); return b !== null && c.s.shares ? b / c.s.shares : null; } },
    { key: "buyDays", label: "買残 ÷ 20日平均出来高(日数)", group: "信用残", log: true, f: (c) => { const r = credit(c); return r && r.buyDays > 0 ? r.buyDays : null; } },
    { key: "sellDays", label: "売残 ÷ 20日平均出来高(日数)", group: "信用残", log: true, f: (c) => { const r = credit(c); return r && r.sellDays > 0 ? r.sellDays : null; } },
    { key: "buyChg", label: "買残の4週の増減率", group: "信用残", pct: true, f: (c) => { const a = adj(credit(c), "buy"), b = adj(credit(c, 28), "buy"); return a !== null && b > 0 ? a / b - 1 : null; } },
    { key: "sellChg", label: "売残の4週の増減率", group: "信用残", pct: true, f: (c) => { const a = adj(credit(c), "sell"), b = adj(credit(c, 28), "sell"); return a !== null && b > 0 ? a / b - 1 : null; } },
    { key: "buyChgVol", label: "買残の4週の増減 ÷ 1日の出来高(日数)", group: "信用残", f: (c) => { const a = adj(credit(c), "buy"), b = adj(credit(c, 28), "buy"), v = avgV(c, 28); return a !== null && b !== null && v ? (a - b) / v : null; } },
    { key: "buyPnl", label: "推定 買い方評価損益率", group: "信用残", pct: true, f: (c) => { const r = credit(c); return r && !r.warmup && fin(r.buyPnl) ? r.buyPnl : null; } },
    { key: "sellPnl", label: "推定 売り方評価損益率", group: "信用残", pct: true, f: (c) => { const r = credit(c); return r && !r.warmup && fin(r.sellPnl) ? r.sellPnl : null; } },
    // 機関の需給(JPX・日証金・EDINET。取り始めてからの期間しか無い)
    { key: "shortRep", label: "空売り残高報告の合計(発行株比・0.5%以上の報告)", group: "機関の需給", pct: true, recent: true, f: (c) => (c.T >= instSince(c) ? shortSum(c) : null) },
    { key: "jsfRatio", label: "日証金 貸借倍率(融資残 ÷ 貸株残)", group: "機関の需給", log: true, recent: true, f: (c) => { const r = lending(c); return r && r.loan > 0 && r.lend > 0 ? r.loan / r.lend : null; } },
    { key: "jsfLend", label: "日証金 貸株残 ÷ 発行済株式", group: "機関の需給", pct: true, recent: true, f: (c) => { const r = lending(c); return r && fin(r.lend) && c.s.shares ? r.lend / c.s.shares : null; } },
    { key: "buyback", label: "過去 n か月の自己株買付状況報告書の件数", group: "機関の需給", f: (c) => { const b = c.s.inst?.buyback; if (!b) return null; const from = iso(t(c.T) - c.n * MONTH); if (from < (c.s.inst.buybackSince || "2025-10-01")) return null; return b.filter((x) => x.date > from && x.date <= c.T).length; } },
    // 業績・バリュエーション(株探の業績。その日までに発表された分だけ)
    { key: "per", label: "PER(会社予想・時価総額 ÷ 予想純利益)", group: "業績・割安さ", log: true, f: (c) => { const r = annualFc(c) || annualAct(c); const m = mcap(c); return r && pos(r.net) && m ? m / (r.net * 1e6) : null; } },
    { key: "pbr", label: "PBR(時価総額 ÷ 純資産)", group: "業績・割安さ", log: true, center: 1, f: (c) => { const r = latest(fund(c, "balance"), c.T); const m = mcap(c); return r && pos(r.equity) && m ? m / (r.equity * 1e6) : null; } },
    { key: "earnYield", label: "益回り(予想純利益 ÷ 時価総額。赤字も入る)", group: "業績・割安さ", pct: true, f: (c) => { const r = annualFc(c) || annualAct(c); const m = mcap(c); return r && fin(r.net) && m ? r.net * 1e6 / m : null; } },
    { key: "divYield", label: "配当利回り(会社予想)", group: "業績・割安さ", pct: true, f: (c) => { const r = annualFc(c) || annualAct(c); return r && fin(r.dps) ? r.dps / close(c) : null; } },
    { key: "roe", label: "ROE(直近の本決算)", group: "業績・割安さ", pct: true, f: (c) => { const a = annualAct(c); if (!a || !fin(a.net)) return null; const b = fund(c, "balance").find((x) => x.period === a.period) || latest(fund(c, "balance"), c.T); return b && pos(b.equity) ? a.net / b.equity : null; } },
    { key: "equityRatio", label: "自己資本比率", group: "業績・割安さ", pct: true, f: (c) => { const r = latest(fund(c, "balance"), c.T); return r && fin(r.equity_ratio) ? r.equity_ratio / 100 : null; } },
    { key: "salesGrowth", label: "売上高の伸び(直近の本決算・前期比)", group: "業績・割安さ", pct: true, f: (c) => { const a = annualAct(c); if (!a) return null; const b = yearAgo(fund(c, "annual"), a); return b && pos(b.sales) && fin(a.sales) ? a.sales / b.sales - 1 : null; } },
    { key: "netGrowthFc", label: "会社予想の純利益の伸び(今期予想 ÷ 前期実績)", group: "業績・割安さ", pct: true, f: (c) => { const f = annualFc(c), a = annualAct(c); return f && a && pos(a.net) && fin(f.net) ? f.net / a.net - 1 : null; } },
    { key: "opYoyQ", label: "直近の四半期の営業利益の伸び(前年同期比)", group: "業績・割安さ", pct: true, f: (c) => { const q = latest(fund(c, "quarter"), c.T, (r) => !r.forecast); if (!q) return null; const b = yearAgo(fund(c, "quarter"), q); return b && pos(b.op) && fin(q.op) ? q.op / b.op - 1 : null; } },
    { key: "opMargin", label: "直近の四半期の営業利益率", group: "業績・割安さ", pct: true, f: (c) => { const q = latest(fund(c, "quarter"), c.T, (r) => !r.forecast); return q && pos(q.sales) && fin(q.op) ? q.op / q.sales : null; } },
    { key: "earnReact", label: "直近の決算発表の翌日の値動き", group: "業績・割安さ", pct: true, f: (c) => { const q = latest([...fund(c, "quarter"), ...fund(c, "annual")], c.T, (r) => !r.forecast); if (!q || t(c.T) - t(avail(q)) > 120 * DAY) return null; const p = c.s.prices; const j = lastIdx(p, avail(q)); if (j < 1 || p[j].d !== avail(q) || p[j].d < c.s.dailyFrom) return null; return p[j].c / p[j - 1].c - 1; } },
    { key: "daysSinceEarn", label: "直近の決算発表からの日数", group: "業績・割安さ", f: (c) => { const q = latest([...fund(c, "quarter"), ...fund(c, "annual")], c.T, (r) => !r.forecast); return q ? (t(c.T) - t(avail(q))) / DAY : null; } },
    // 規模
    { key: "mcap", label: "時価総額(億円)", group: "規模", log: true, f: (c) => { const m = mcap(c); return m ? m / 1e8 : null; } },
    { key: "price", label: "株価(円)", group: "規模", log: true, f: (c) => close(c) },
    // その後(基準日の翌日から m か月)
    { key: "fret", label: "その後 m か月の騰落率", group: "その後(先の値動き)", pct: true, future: true, f: (c) => { const j = future(c); return j === null ? null : c.s.prices[j].c / close(c) - 1; } },
    { key: "fexcess", label: "その後 m か月の対TOPIX超過リターン", group: "その後(先の値動き)", pct: true, future: true, f: (c) => { const j = future(c); if (j === null) return null; const m = mktRet(c, c.T, c.s.prices[j].d); return m === null ? null : c.s.prices[j].c / close(c) - 1 - m; } },
    { key: "fdd", label: "その後 m か月の最大の下げ", group: "その後(先の値動き)", pct: true, future: true, f: (c) => { const j = future(c); if (j === null) return null; let mx = close(c), dd = 0; for (let i = c.iT + 1; i <= j; i++) { const x = c.s.prices[i].c; mx = Math.max(mx, x); dd = Math.min(dd, x / mx - 1); } return dd; } },
    { key: "fup", label: "その後 m か月の最大の上げ", group: "その後(先の値動き)", pct: true, future: true, f: (c) => { const j = future(c); if (j === null) return null; let mx = close(c); for (let i = c.iT + 1; i <= j; i++) mx = Math.max(mx, c.s.prices[i].h ?? c.s.prices[i].c); return mx / close(c) - 1; } },
  ];
  const byKey = Object.fromEntries(METRICS.map((m) => [m.key, m]));

  // 1銘柄・1基準日の文脈(足が7日以上前で止まっていれば無し)
  function context(s, T, n, m, mkt) { const iT = lastIdx(s.prices, T); if (iT < 0 || t(T) - t(s.prices[iT].d) > 7 * DAY) return null; return { s, T, iT, n, m, mkt }; }
  const value = (ctx, key) => { const M = byKey[key]; const v = M.f(ctx); return fin(v) ? v : null; };
  // 図に描く値(対数目盛の指標は log10)
  const plotVal = (M, v) => (v === null ? null : M.log ? (v > 0 ? Math.log10(v) : null) : v);

  // 1つの基準日で全銘柄の2つの指標を計算する
  function points(stocks, T, xKey, yKey, n, m, opts = {}) {
    const out = []; const X = byKey[xKey], Y = byKey[yKey];
    stocks.forEach((s) => {
      const ctx = context(s, T, n, m, opts.mkt); if (!ctx) return;
      const x = plotVal(X, value(ctx, xKey)), y = plotVal(Y, value(ctx, yKey));
      if (x === null || y === null) return;
      out.push({ code: s.code, name: s.name, industry: s.industry, T, x, y, rawX: X.log ? 10 ** x : x, rawY: Y.log ? 10 ** y : y });
    });
    return out;
  }
  // 上位・下位 N 銘柄に絞る(基準日ごとに key の値で並べる)。mode: "top" | "bottom" | "both"
  function pickRank(stocks, T, key, N, mode, n, m, mkt) {
    const vals = stocks.map((s) => { const c = context(s, T, n, m, mkt); return c ? { code: s.code, v: value(c, key) } : null; }).filter((x) => x && x.v !== null).sort((a, b) => b.v - a.v);
    const top = mode === "bottom" ? [] : vals.slice(0, N).map((x) => x.code), bottom = mode === "top" ? [] : vals.slice(-N).map((x) => x.code);
    const out = new Map(); top.forEach((c) => out.set(c, "top")); bottom.forEach((c) => { if (!out.has(c)) out.set(c, "bottom"); });
    return out;
  }
  // 業種の中での順位(0〜1)に直す。業種や相場全体の差を取り除いて「同じ業種の中で」比べる(業種中立)
  function neutralize(pts) {
    const groups = new Map(); pts.forEach((p) => { const k = `${p.T}|${p.industry || ""}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    const out = [];
    groups.forEach((g) => { if (g.length < 3) return; const rx = ranks(g.map((p) => p.x)), ry = ranks(g.map((p) => p.y)); g.forEach((p, i) => out.push({ ...p, x: (rx[i] - 1) / (g.length - 1), y: (ry[i] - 1) / (g.length - 1) })); });
    return out;
  }
  // 基準日の列(毎月末に近い日)
  function monthlyDates(lastDate, months) { const out = []; const end = new Date(t(lastDate)); for (let k = months; k >= 0; k--) { const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - k + 1, 0)); out.push(iso(Math.min(d.getTime(), t(lastDate)))); } return [...new Set(out)]; }
  // 1銘柄の時系列で見るときの基準日(日足のある期間の毎週末)
  function weeklyDates(s) { const out = []; let last = null; s.prices.forEach((r) => { if (r.d < s.dailyFrom) return; const wk = Math.floor((t(r.d) / DAY + 3) / 7); if (wk !== last) { out.push(r.d); last = wk; } else out[out.length - 1] = r.d; }); return out; }
  // 営業日の列から、最後の日から step 日ごとに count 個(古い順)
  function stepDates(bizDays, step, count, lastDate) { const end = lastDate ? lastIdx(bizDays.map((d) => ({ d })), lastDate) : bizDays.length - 1; const out = []; for (let k = 0; k < count && end - k * step >= 0; k++) out.unshift(bizDays[end - k * step]); return out; }
  // 軌跡: 銘柄ごとに、基準日を step ずつずらした (X, Y) を古い順につなぐ
  function trails(stocks, dates, xKey, yKey, n, m, opts = {}) {
    return stocks.map((s) => ({ code: s.code, name: s.name, industry: s.industry, path: dates.flatMap((T) => points([s], T, xKey, yKey, n, m, opts)) })).filter((x) => x.path.length);
  }

  // ---------- 統計 ----------
  // 外れ値の影響を抑えるため、上下 1% で切り詰めてからピアソンの相関を取る。順位(スピアマン)は外れ値に強い
  function winsor(a, p = 0.01) { const s = a.slice().sort((x, y) => x - y); const lo = s[Math.floor(p * (s.length - 1))], hi = s[Math.ceil((1 - p) * (s.length - 1))]; return a.map((x) => Math.min(hi, Math.max(lo, x))); }
  function pearson(x, y) { const n = x.length; if (n < 3) return null; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; }
  function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
  const spearman = (x, y) => pearson(ranks(x), ranks(y));
  const med = (a) => { const v = a.slice().sort((u, w) => u - w); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
  function stats(pts) {
    const n = pts.length; if (n < 10) return { n };
    const x = winsor(pts.map((p) => p.x)), y = winsor(pts.map((p) => p.y));
    const r = pearson(x, y), rho = spearman(pts.map((p) => p.x), pts.map((p) => p.y));
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : null;
    // 相関が 0 なら |t| が 2 を超えるのは 5% 程度(同じ基準日に銘柄どうしが似た動きをするので、本当はもっと甘めに見る)
    const tval = rho === null || Math.abs(rho) >= 1 ? null : rho * Math.sqrt((n - 2) / (1 - rho * rho));
    // X の5分位ごとの Y
    const order = pts.map((p, i) => i).sort((a, b) => pts[a].x - pts[b].x);
    const q = [0, 1, 2, 3, 4].map((k) => { const ids = order.slice(Math.floor(k * n / 5), Math.floor((k + 1) * n / 5)); const ys = ids.map((i) => pts[i].y).sort((a, b) => a - b); const xs = ids.map((i) => pts[i].x); return { k: k + 1, n: ids.length, xMin: Math.min(...xs), xMax: Math.max(...xs), mean: ys.reduce((a, b) => a + b, 0) / ys.length, median: ys[Math.floor(ys.length / 2)], pos: ys.filter((v) => v > 0).length / ys.length }; });
    // X を10等分した区間ごとの中央値(直線でない関係の形を見る)
    const bins = Array.from({ length: 10 }, (_, k) => order.slice(Math.floor(k * n / 10), Math.floor((k + 1) * n / 10))).filter((ids) => ids.length).map((ids) => ({ x: med(ids.map((i) => pts[i].x)), y: med(ids.map((i) => pts[i].y)) }));
    return { n, r, rho, slope, intercept: slope === null ? null : my - slope * mx, t: tval, quintiles: q, bins };
  }
  // 基準日ごとの順位相関(IC = Information Coefficient)と、X の上位20% − 下位20% の Y の平均の差(ロング・ショートの差。Y は上下2%で切り詰める)
  function icSeries(pts) {
    const by = new Map(); pts.forEach((p) => { if (!by.has(p.T)) by.set(p.T, []); by.get(p.T).push(p); });
    const list = [...by.entries()].sort().map(([T, g]) => { if (g.length < 10) return null; const ic = spearman(g.map((p) => p.x), g.map((p) => p.y)); const o = g.slice().sort((a, b) => a.x - b.x); const k = Math.max(1, Math.floor(g.length / 5)); const wy = winsor(o.map((p) => p.y), 0.02); const avg = (a, b) => wy.slice(a, b).reduce((s, v) => s + v, 0) / (b - a); return { T, n: g.length, ic, spread: avg(o.length - k, o.length) - avg(0, k) }; }).filter((x) => x && x.ic !== null);
    if (!list.length) return { list, n: 0 };
    const ics = list.map((x) => x.ic); const mean = ics.reduce((a, b) => a + b, 0) / ics.length;
    const sd = ics.length > 1 ? Math.sqrt(ics.reduce((a, b) => a + (b - mean) ** 2, 0) / (ics.length - 1)) : null;
    return { list, n: list.length, mean, sd, ir: sd ? mean / sd : null, hit: ics.filter((v) => v > 0).length / ics.length, spread: list.reduce((a, x) => a + x.spread, 0) / list.length };
  }
  // ある Y に対して、ほかの全部の指標の相関(順位)を並べる
  function scan(stocks, dates, yKey, n, m, opts = {}) {
    return METRICS.filter((X) => X.key !== yKey && !X.future).map((X) => {
      let pts = dates.flatMap((T) => points(stocks, T, X.key, yKey, n, m, opts)); if (opts.neutral) pts = neutralize(pts);
      const s = stats(pts); const ic = dates.length > 1 ? icSeries(pts) : null;
      return { key: X.key, label: X.label, group: X.group, n: s.n, rho: s.rho ?? null, r: s.r ?? null, t: s.t ?? null, icMean: ic?.mean ?? null, hit: ic?.hit ?? null };
    }).sort((a, b) => Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0));
  }
  // 先の期間ごとの相関(IC の減衰): X が「どのくらい先まで」効くか
  function horizons(stocks, dates, xKey, yKey, n, ms, opts = {}) {
    return ms.map((m) => { let pts = dates.flatMap((T) => points(stocks, T, xKey, yKey, n, m, opts)); if (opts.neutral) pts = neutralize(pts); const s = stats(pts); const ic = icSeries(pts); return { m, n: s.n, rho: s.rho ?? null, icMean: ic.mean ?? null, hit: ic.hit ?? null, spread: ic.spread ?? null }; });
  }
  // 全指標どうしの順位相関の表。各指標を全体の中の順位(0〜1)に直してから、両方そろう組で相関を取る
  function corrMatrix(stocks, dates, keys, n, m, opts = {}) {
    const rows = []; dates.forEach((T) => stocks.forEach((s) => { const c = context(s, T, n, m, opts.mkt); if (c) rows.push(keys.map((k) => value(c, k))); }));
    const pr = keys.map((_, j) => { const idx = rows.map((r, i) => [r[j], i]).filter((x) => x[0] !== null); const rk = ranks(idx.map((x) => x[0])); const out = new Array(rows.length).fill(null); idx.forEach((x, k) => { out[x[1]] = rk[k] / idx.length; }); return out; });
    const M = keys.map(() => keys.map(() => null)); const N = keys.map(() => keys.map(() => 0));
    for (let a = 0; a < keys.length; a++) for (let b = a; b < keys.length; b++) {
      const xs = [], ys = []; for (let i = 0; i < rows.length; i++) { const u = pr[a][i], v = pr[b][i]; if (u !== null && v !== null) { xs.push(u); ys.push(v); } }
      const r = xs.length >= 20 ? (a === b ? 1 : pearson(xs, ys)) : null; M[a][b] = M[b][a] = r; N[a][b] = N[b][a] = xs.length;
    }
    return { keys, M, N, rows: rows.length };
  }
  // 1銘柄の時系列で「どちらが先に動くか」: X の今と、k 回あとの Y の相関(k < 0 は Y が先)
  function leadLag(s, dates, xKey, yKey, n, m, maxLag = 12, opts = {}) {
    const X = byKey[xKey], Y = byKey[yKey];
    const xs = [], ys = []; dates.forEach((T) => { const c = context(s, T, n, m, opts.mkt); xs.push(c ? plotVal(X, value(c, xKey)) : null); ys.push(c ? plotVal(Y, value(c, yKey)) : null); });
    const out = [];
    for (let k = -maxLag; k <= maxLag; k++) { const a = [], b = []; for (let i = 0; i < xs.length; i++) { const j = i + k; if (j < 0 || j >= ys.length || xs[i] === null || ys[j] === null) continue; a.push(xs[i]); b.push(ys[j]); } out.push({ k, n: a.length, rho: a.length >= 12 ? spearman(a, b) : null }); }
    return out;
  }

  const api = { METRICS, byKey, periodLabel, points, pickRank, neutralize, monthlyDates, weeklyDates, stepDates, trails, stats, icSeries, scan, horizons, corrMatrix, leadLag, pearson, spearman, ranks, winsor, lastIdx, context, value };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRExplore = api;
})(typeof window !== "undefined" ? window : globalThis);
