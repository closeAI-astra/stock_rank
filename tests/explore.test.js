// node tests/explore.test.js
const assert = require("assert");
const E = require("../assets/js/explore.js");

// 100 営業日(平日)の株価: 100 → 120 まで上げ、途中で 90 まで下げる
const days = []; let d = Date.parse("2026-01-05T00:00:00Z");
while (days.length < 160) { const w = new Date(d).getUTCDay(); if (w && w < 6) days.push(new Date(d).toISOString().slice(0, 10)); d += 864e5; }
const path = days.map((_, i) => (i < 40 ? 100 + i * 0.5 : i < 60 ? 120 - (i - 40) * 1.5 : 90 + (i - 60) * 0.3));
const prices = days.map((dd, i) => ({ d: dd, o: path[i], h: path[i] * 1.01, l: path[i] * 0.99, c: path[i], v: i >= 140 ? 3000 : 1000 }));
const credit = days.filter((_, i) => i % 5 === 4).map((dd, k) => ({ date: dd, buy: 1000 + k * 10, sell: 500, ratio: (1000 + k * 10) / 500, splitFactor: 1, buyPnl: -0.05, buyDays: 1.2, warmup: false }));
const s = { code: "1111", prices, dailyFrom: days[0], credit, shares: 1e6 };
const T = days[139];
const ctx = { s, T, iT: 139, n: 3, m: 1 };
const f = (k, c = ctx) => E.byKey[k].f(c);

// 過去3か月(約91日)の騰落率: 基準日の終値 ÷ 91日前の終値
const i0 = E.lastIdx(prices, new Date(Date.parse(`${T}T00:00:00Z`) - 3 * 30.44 * 864e5).toISOString().slice(0, 10));
assert.ok(Math.abs(f("ret") - (path[139] / path[i0] - 1)) < 1e-12);
// 最大の下げ: 120 → 90 の -25% (期間に高値 120 を含む場合)
assert.strictEqual(f("dd"), 0); // 3か月前は下げの後なので、その後は上がり続け
const dd = f("dd", { ...ctx, n: 6 }); assert.ok(Math.abs(dd - (90 / 120 - 1)) < 1e-12, `dd ${dd}`);
// 出来高の増え方: 直近は平常時と同じ 1000 なので 1 付近
assert.ok(Math.abs(f("volRatio") - 1) < 1e-9);
// 基準日の後に出来高が 3 倍になる。基準日 159 での直近1週 ÷ 過去3か月 は 1 より大きい
assert.ok(f("volRatio5", { ...ctx, T: days[159], iT: 159 }) > 1.5);
// 信用: 倍率と4週の増減
const cr = credit.filter((r) => r.date <= T).at(-1);
assert.strictEqual(f("ratio"), cr.ratio);
assert.ok(f("buyChg") > 0 && f("buyChg") < 0.1);
assert.strictEqual(f("buyToShares"), cr.buy / 1e6);
// 先の騰落率は未来の値だけを使う(基準日の後のデータが足りなければ null)
assert.ok(Math.abs(f("fret") - (path[E.lastIdx(prices, new Date(Date.parse(`${T}T00:00:00Z`) + 30.44 * 864e5).toISOString().slice(0, 10))] / path[139] - 1)) < 1e-12);
assert.strictEqual(f("fret", { ...ctx, T: days[155], iT: 155 }), null);

// 相関: 完全に比例なら 1、順位も 1。外れ値1つでピアソンは崩れるが順位は強い
const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 2 * i + 1 }));
let st = E.stats(pts); assert.ok(Math.abs(st.r - 1) < 1e-12 && Math.abs(st.rho - 1) < 1e-12 && Math.abs(st.slope - 2) < 1e-9);
assert.strictEqual(st.quintiles.length, 5); assert.ok(st.quintiles[4].mean > st.quintiles[0].mean);
assert.deepStrictEqual(E.ranks([3, 1, 3, 2]), [3.5, 1, 3.5, 2]);
const neg = pts.map((p) => ({ x: p.x, y: -p.y })); assert.ok(E.stats(neg).rho < -0.999);
// points: 2銘柄 × 1基準日
const pp = E.points([s, { ...s, code: "2222" }], T, "ret", "fret", 3, 1); assert.strictEqual(pp.length, 2);
// 月末の基準日と週の基準日
const md = E.monthlyDates("2026-10-23", 3); assert.deepStrictEqual(md, ["2026-07-31", "2026-08-31", "2026-09-30", "2026-10-23"]);
const wd = E.weeklyDates(s); assert.ok(wd.length >= 31 && wd.length <= 33 && new Date(`${wd[0]}T00:00:00Z`).getUTCDay() === 5);
console.log("explore ok");
// 区間ごとの中央値: 曲がった関係 y = x^2 では直線の相関はほぼ 0 だが、中央値の線は U 字になる
const u = Array.from({ length: 101 }, (_, i) => ({ x: i - 50, y: (i - 50) ** 2 }));
const su = E.stats(u); assert.ok(Math.abs(su.r) < 0.05); assert.strictEqual(su.bins.length, 10);
assert.ok(su.bins[0].y > su.bins[4].y && su.bins[9].y > su.bins[5].y);
console.log("bins ok");
