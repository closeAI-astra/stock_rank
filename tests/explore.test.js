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

// ---------- 追加の指標 ----------
// TOPIX と、日次リターンがちょうど TOPIX の 2 倍の銘柄 → β = 2、相関 = 1、固有ボラ = 0
const mkt = days.map((dd, i) => ({ d: dd, c: 1000 * Math.exp(0.01 * Math.sin(i / 3) + 0.0005 * i) }));
const p2 = mkt.map((r, i) => ({ d: r.d, h: 0, l: 0, c: 50 * (r.c / mkt[0].c) ** 2, v: 1000 }));
p2.forEach((r) => { r.h = r.c; r.l = r.c; });
const s2 = { code: "3333", prices: p2, dailyFrom: days[0], shares: 2e6, credit: [],
  fund: { annual: [
    { period: "2025.03", end: "2025-03-31", forecast: false, availableFrom: "2025-05-10", sales: 1000, net: 100, dps: 10 },
    { period: "2026.03", end: "2026-03-31", forecast: false, availableFrom: "2026-05-10", sales: 1200, net: 150, dps: 12 },
    { period: "2027.03", end: "2027-03-31", forecast: true, availableFrom: "2026-05-10", sales: 1300, net: 180, dps: 14 }],
  balance: [{ period: "2026.03", availableFrom: "2026-05-10", equity: 1000, equity_ratio: 40 }], quarter: [] } };
const c2 = E.context(s2, days[150], 3, 1, mkt);
const v2 = (k, c = c2) => E.value(c, k);
assert.ok(Math.abs(v2("beta") - 2) < 1e-9, `beta ${v2("beta")}`);
assert.ok(Math.abs(v2("corrMkt") - 1) < 1e-9 && v2("idio") < 1e-6);
// 超過リターン = 銘柄の騰落 − TOPIX の騰落
const i02 = E.lastIdx(p2, new Date(Date.parse(`${days[150]}T00:00:00Z`) - 3 * 30.44 * 864e5).toISOString().slice(0, 10));
assert.ok(Math.abs(v2("excess") - ((p2[150].c / p2[i02].c - 1) - (mkt[150].c / mkt[i02].c - 1))) < 1e-12);
// RS-Ratio は 100 前後の値
assert.ok(v2("rsRatio") > 80 && v2("rsRatio") < 120 && v2("rsMom") > 80 && v2("rsMom") < 120);
// PER = 時価総額 ÷ 予想純利益(百万円)。基準日が 2026-05-10 より前なら前の期の実績しか見えない
const mc = 2e6 * p2[150].c;
assert.ok(Math.abs(v2("per") - mc / 180e6) < 1e-9);
assert.ok(Math.abs(v2("pbr") - mc / 1000e6) < 1e-9);
assert.ok(Math.abs(v2("roe") - 0.15) < 1e-12 && Math.abs(v2("salesGrowth") - 0.2) < 1e-12 && Math.abs(v2("netGrowthFc") - 0.2) < 1e-12);
assert.ok(Math.abs(v2("divYield") - 14 / p2[150].c) < 1e-12);
const early = E.context(s2, days[60], 3, 1, mkt); // 2026-03 下旬: 2026-05-10 の発表はまだ
assert.ok(days[60] < "2026-05-10" && Math.abs(v2("per", early) - 2e6 * p2[60].c / 100e6) < 1e-9);

// 上位・下位 N
const many = Array.from({ length: 20 }, (_, k) => ({ ...s, code: `S${k}`, shares: (k + 1) * 1e6, _cd: null }));
const pick = E.pickRank(many, T, "mcap", 3, "both", 3, 1);
assert.deepStrictEqual([...pick.entries()].filter(([, v]) => v === "top").map(([c]) => c), ["S19", "S18", "S17"]);
assert.deepStrictEqual([...pick.entries()].filter(([, v]) => v === "bottom").map(([c]) => c).sort(), ["S0", "S1", "S2"]);
// 業種中立: 業種の中の順位 0〜1 に直す
const nz = E.neutralize([1, 2, 3, 10, 20, 30].map((v, i) => ({ T: "x", industry: i < 3 ? "A" : "B", x: v, y: -v })));
assert.deepStrictEqual(nz.map((p) => p.x), [0, 0.5, 1, 0, 0.5, 1]);
// IC: 基準日ごとの順位相関と、上位20% − 下位20% の差
const icPts = ["2026-01-30", "2026-02-27"].flatMap((TT, j) => Array.from({ length: 20 }, (_, i) => ({ T: TT, x: i, y: j ? -i : i })));
const ic = E.icSeries(icPts); assert.strictEqual(ic.n, 2); assert.ok(Math.abs(ic.list[0].ic - 1) < 1e-12 && Math.abs(ic.list[1].ic + 1) < 1e-12 && ic.hit === 0.5 && Math.abs(ic.mean) < 1e-12);
assert.ok(Math.abs(ic.list[0].spread - 16) < 1e-12);
// 軌跡と営業日のとびとび
const sd = E.stepDates(days, 10, 5); assert.deepStrictEqual(sd, [days[119], days[129], days[139], days[149], days[159]]);
const tr = E.trails([s], sd.slice(0, 3), "ret", "dd", 1, 1); assert.strictEqual(tr[0].path.length, 3);
// 相関の表: 自分自身は 1、ret と ret の符号違いは -1 に近い
const cm = E.corrMatrix([s, s2], E.weeklyDates(s), ["ret", "excess", "price"], 1, 1, { mkt }); assert.strictEqual(cm.M[0][0], 1); assert.ok(cm.rows > 20);
// 先行・遅行: Y を X と同じにすると k = 0 で 1
const ll = E.leadLag(s, E.weeklyDates(s), "ret", "ret", 1, 1, 3); assert.strictEqual(ll.length, 7); assert.ok(Math.abs(ll[3].rho - 1) < 1e-12 && ll[3].k === 0);
assert.strictEqual(E.periodLabel(0.25), "1週"); assert.strictEqual(E.periodLabel(3), "3か月");
console.log("explore extra ok");
