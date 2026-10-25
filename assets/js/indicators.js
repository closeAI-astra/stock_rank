// Stock Rank — 足の集約とテクニカル指標(rows: [{time,o,h,l,c,v}] 古い順)
(function (root) {
  "use strict";
  const isNum = Number.isFinite;

  function weekKey(d) { const t = new Date(`${d}T00:00:00Z`); const wd = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - wd); return t.toISOString().slice(0, 10); }
  // 日足(と、それより古い週足)を週足・月足にまとめる。time は期間の最初の取引日
  function aggregate(daily, weekly, interval) {
    if (interval === "1d") return daily.map((r) => ({ time: r.d, start: r.d, end: r.d, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v || 0 }));
    const first = daily[0]?.d || "9999";
    const src = [...(weekly || []).filter((r) => r.d < first), ...daily];
    const key = interval === "1w" ? (d) => weekKey(d) : (d) => d.slice(0, 7);
    const out = [];
    src.forEach((r) => {
      const k = key(r.d); let g = out.at(-1);
      if (!g || g.key !== k) { g = { key: k, time: r.d, start: r.d, end: r.d, o: r.o, h: r.h, l: r.l, c: r.c, v: 0 }; out.push(g); }
      g.end = r.d; g.h = Math.max(g.h, r.h); g.l = Math.min(g.l, r.l); g.c = r.c; g.v += r.v || 0;
    });
    return out;
  }
  function heikinAshi(rows) {
    const out = []; rows.forEach((r, i) => {
      const c = (r.o + r.h + r.l + r.c) / 4; const o = i ? (out[i - 1].o + out[i - 1].c) / 2 : (r.o + r.c) / 2;
      out.push({ ...r, o, c, h: Math.max(r.h, o, c), l: Math.min(r.l, o, c) });
    });
    return out;
  }
  function sma(values, n) {
    const out = Array(values.length).fill(null); let s = 0, k = 0;
    for (let i = 0; i < values.length; i++) { const v = values[i]; if (isNum(v)) { s += v; k++; } if (i >= n) { const old = values[i - n]; if (isNum(old)) { s -= old; k--; } } if (i >= n - 1 && k === n) out[i] = s / n; }
    return out;
  }
  function ema(values, n) {
    const out = Array(values.length).fill(null); const a = 2 / (n + 1); let prev = null, seed = [];
    for (let i = 0; i < values.length; i++) { const v = values[i]; if (!isNum(v)) continue; if (prev === null) { seed.push(v); if (seed.length === n) { prev = seed.reduce((x, y) => x + y, 0) / n; out[i] = prev; } continue; } prev = a * v + (1 - a) * prev; out[i] = prev; }
    return out;
  }
  function bollinger(closes, n = 20, k = 2) {
    const mid = sma(closes, n); const up = [], lo = [];
    closes.forEach((_, i) => { if (mid[i] === null) { up.push(null); lo.push(null); return; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += (closes[j] - mid[i]) ** 2; const sd = Math.sqrt(s / n); up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd); });
    return { mid, up, lo };
  }
  // Wilder の RSI
  function rsi(closes, n = 14) {
    const out = Array(closes.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1]; const up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } continue; }
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function macd(closes, f = 12, s = 26, sig = 9) {
    const ef = ema(closes, f), es = ema(closes, s); const line = closes.map((_, i) => (ef[i] === null || es[i] === null ? null : ef[i] - es[i]));
    const sg = ema(line, sig); return { line, signal: sg, hist: line.map((v, i) => (v === null || sg[i] === null ? null : v - sg[i])) };
  }
  function stochastic(rows, n = 14, d = 3) {
    const k = rows.map((_, i) => { if (i < n - 1) return null; let hi = -Infinity, lo = Infinity; for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, rows[j].h); lo = Math.min(lo, rows[j].l); } return hi === lo ? 50 : (rows[i].c - lo) / (hi - lo) * 100; });
    return { k, d: sma(k, d) };
  }
  // 一目均衡表: 転換線9・基準線26・先行スパンは26本先・遅行スパンは26本前
  function ichimoku(rows) {
    const mid = (i, n) => { if (i < n - 1) return null; let hi = -Infinity, lo = Infinity; for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, rows[j].h); lo = Math.min(lo, rows[j].l); } return (hi + lo) / 2; };
    const tenkan = rows.map((_, i) => mid(i, 9)), kijun = rows.map((_, i) => mid(i, 26));
    const spanA = rows.map((_, i) => (tenkan[i] === null || kijun[i] === null ? null : (tenkan[i] + kijun[i]) / 2));
    const spanB = rows.map((_, i) => mid(i, 52));
    return { tenkan, kijun, spanA, spanB, chikou: rows.map((r) => r.c) };
  }
  // 土日を除いた n 営業日後(祝日は考えない概算)
  function addBusinessDays(date, n) {
    const t = new Date(`${date}T00:00:00Z`); let k = 0;
    while (k < n) { t.setUTCDate(t.getUTCDate() + 1); const wd = t.getUTCDay(); if (wd !== 0 && wd !== 6) k++; }
    return t.toISOString().slice(0, 10);
  }
  const api = { aggregate, heikinAshi, sma, ema, bollinger, rsi, macd, stochastic, ichimoku, addBusinessDays, weekKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRInd = api;
})(typeof window !== "undefined" ? window : globalThis);
