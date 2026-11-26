// node tests/analytics.test.js — 分析(VWAP・価格帯別出来高・進捗率・回帰・権利落ち・信用期日)の計算
const assert = require("assert");
const A = require("../assets/js/analytics.js");
const C = require("../assets/js/credit.js");

// アンカード VWAP: 出来高で加重した典型価格
const bars = [{ o: 10, h: 12, l: 8, c: 10, v: 100 }, { o: 10, h: 22, l: 18, c: 20, v: 300 }];
const v = A.anchoredVwap(bars, 0);
assert.ok(Math.abs(v[0] - 10) < 1e-9); assert.ok(Math.abs(v[1] - (10 * 100 + 20 * 300) / 400) < 1e-9);
assert.ok(Number.isNaN(A.anchoredVwap(bars, 1)[0]));

// 価格帯別出来高: 出来高の合計が保たれ、POC が一番多い帯
const vp = A.volumeProfile(bars, 0, 1, 10);
assert.ok(Math.abs(vp.total - 400) < 1e-6); assert.ok(vp.pocPrice > 18 && vp.pocPrice < 22);

// 進捗率: 四半期を累計して通期で割る
const kab = {
  annual: [{ period: "2025.03", start: "2024-04-01", end: "2025-03-31", op: 100 }, { period: "2026.03", start: "2025-04-01", end: "2026-03-31", op: 200, forecast: true }],
  quarter: [["2024-04-01", "2024-06-30", 20], ["2024-07-01", "2024-09-30", 30], ["2024-10-01", "2024-12-31", 25], ["2025-01-01", "2025-03-31", 25], ["2025-04-01", "2025-06-30", 60]].map(([start, end, op]) => ({ period: end, start, end, op })),
};
const pr = A.progressTable(kab);
assert.strictEqual(pr.years.length, 2);
assert.deepStrictEqual(pr.years[0].steps.map((s) => s.opP), [0.2, 0.5, 0.75, 1]);
assert.strictEqual(pr.years[1].steps[0].opP, 0.3);
assert.ok(Math.abs(pr.pastAvg(1, "op").mean - 0.2) < 1e-12);

// 最小二乗: y = 1 + 2x を復元する
const xs = Array.from({ length: 50 }, (_, i) => i / 10);
const fit = A.ols(xs.map((x) => 1 + 2 * x), xs.map((x) => [1, x]));
assert.ok(Math.abs(fit.beta[0] - 1) < 1e-9 && Math.abs(fit.beta[1] - 2) < 1e-9 && Math.abs(fit.r2 - 1) < 1e-9);

// 権利落ち: 月末の 2 営業日前が権利付き最終日
const days = []; for (let d = 1; d <= 31; d++) { const dt = new Date(Date.UTC(2026, 2, d)); if (![0, 6].includes(dt.getUTCDay())) days.push({ d: dt.toISOString().slice(0, 10), c: 100 }); }
days.push({ d: "2026-04-01", c: 100 });
const ex = A.exDividendEvents(days, [3], 5, 0);
assert.strictEqual(ex[0].cumDate, "2026-03-27"); assert.strictEqual(ex[0].exDate, "2026-03-30");

// 信用期日: 建てた日 + 182日。最初の残高(建てた日不明)は除ける
const credit = [{ date: "2026-01-02", buy: 100, sell: 0 }, { date: "2026-02-06", buy: 300, sell: 0 }];
const daily = [{ d: "2026-01-02", h: 10, l: 10, c: 10, v: 1 }, { d: "2026-02-06", h: 12, l: 12, c: 12, v: 1 }];
const est = C.estimateCredit(credit, daily, [], { method: "fifo6m" });
assert.strictEqual(est.buyLots.length, 2);
const sch = C.expirySchedule(est.buyLots, 12, "2026-02-06", "month", "2026-01-02");
assert.strictEqual(sch.length, 1); assert.strictEqual(sch[0].key, "2026-08"); assert.strictEqual(sch[0].shares, 200);
// 含み益保有者割合: 上がり続ければ 1 に近づき、下がり続ければ 0 に近づく。回転の累計が 1 を超えた日が warmEnd
const mk = (f) => Array.from({ length: 300 }, (_, i) => { const c = f(i); return { d: `d${i}`, o: c, h: c * 1.005, l: c * 0.995, c, v: 1000 }; });
const upP = A.profitHolders(mk((i) => 100 * Math.exp(i * 0.005)), 100000);
assert.ok(upP.ratio.at(-1) > 0.9, `up ${upP.ratio.at(-1)}`);
const dnP = A.profitHolders(mk((i) => 100 * Math.exp(-i * 0.005)), 100000);
assert.ok(dnP.ratio.at(-1) < 0.1, `down ${dnP.ratio.at(-1)}`);
assert.strictEqual(upP.warmEnd, 100); // 1000 ÷ 100000 = 1% / 日 → 100 日で一回転
// 横ばいなら半分前後
const flat = A.profitHolders(mk(() => 100), 100000); assert.ok(Math.abs(flat.ratio.at(-1) - 0.5) < 0.05);
// 発行済株式数が無いときも動く(直近の出来高で一回転)
assert.ok(A.profitHolders(mk((i) => 100 + i), 0).ratio.at(-1) > 0.9);
console.log("analytics tests: ok");
