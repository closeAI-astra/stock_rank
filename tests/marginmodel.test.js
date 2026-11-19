// node tests/marginmodel.test.js
const assert = require("assert");
const M = require("../assets/js/marginmodel.js");

// IRBANK の表: 年の行から月日をさかのぼる(12月 → 前の年)
const pages = [{ tables: [{ headers: ["日付", "買い残高", "前日比", "売り残高", "前日比", "損益率"], rows: [["2026", "円", "円", "%"], ["01/09", "", "", "", "", "-3.04"], ["12/26", "", "", "", "", "-5.85"], ["More"]] }] }];
assert.deepStrictEqual(M.parseIrbank(pages).map((o) => [o.date, o.y]), [["2026-01-09", -3.04], ["2025-12-26", -5.85]]);
// 優先度: 先に渡したリストの値を使う
const mt = M.mergeTargets([{ date: "2026-01-09", y: -3, src: "手" }], [{ date: "2026-01-09", y: -9, src: "IRBANK" }, { date: "2026-01-02", y: -1, src: "IRBANK" }]);
assert.deepStrictEqual(mt.map((o) => [o.date, o.y]), [["2026-01-02", -1], ["2026-01-09", -3]]);

// 1銘柄: 100株を 100円で建て、値段が 120円に上がって残高そのまま
const days = ["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23"];
const rows = days.map((d, i) => ({ date: d, av: d, n: 100, p: i ? 120 : 100, e: 100 }));
// 建て替えなし: 取得単価は 100 のまま → 評価損益 +20%
assert.strictEqual(M.simulate(rows, 0, 0).at(-1).cost, 100 * 100);
// 週 50% の建て替え: 1週目で 110、2週目で 115、3週目で 117.5
assert.ok(Math.abs(M.simulate(rows, 0.5, 0.5).at(-1).cost - 100 * 117.5) < 1e-9);
// 含み益だけ建て替える(含み損はそのまま)
const down = days.map((d, i) => ({ date: d, av: d, n: 100, p: i ? 80 : 100, e: 100 }));
assert.strictEqual(M.simulate(down, 0.5, 0).at(-1).cost, 100 * 100);
// 6か月(182日)で期日: 残高が同じなら建て直しとして新しい単価で入る
const long = [{ date: "2026-01-02", av: "2026-01-02", n: 10, p: 100, e: 100 }, { date: "2026-08-07", av: "2026-08-07", n: 10, p: 150, e: 140 }];
assert.strictEqual(M.simulate(long, 0, 0).at(-1).cost, 10 * 140);
// 減った分は古い建玉から
const cut = [{ date: "2026-01-02", av: "2026-01-02", n: 10, p: 100, e: 100 }, { date: "2026-01-09", av: "2026-01-09", n: 20, p: 110, e: 110 }, { date: "2026-01-16", av: "2026-01-16", n: 12, p: 110, e: 110 }];
assert.strictEqual(M.simulate(cut, 0, 0).at(-1).cost, 2 * 100 + 10 * 110);

// xAt: 公表前(availableFrom より前)の行は使わない。終値で値洗い
const prices = [{ d: "2026-04-10", c: 110 }, { d: "2026-04-17", c: 121 }];
const st = [{ code: "A", prices, rows: [{ date: "2026-01-02", av: "2026-01-06", n: 10, p: 100, e: 100 }, { date: "2026-04-10", av: "2026-04-14", n: 20, p: 110, e: 110 }] }];
const b = M.build(st, 0, 0);
assert.ok(Math.abs(M.xAt(b, "2026-04-10").x - 10) < 1e-9); // 4/10 の行はまだ公表前 → 10株 × 110 / 1000
assert.ok(Math.abs(M.xAt(b, "2026-04-17").x - ((20 * 121) / (10 * 100 + 10 * 110) - 1) * 100) < 1e-9);
assert.strictEqual(M.xAt(b, "2026-02-01"), null); // 履歴が 91 日に満たない

// fit: y がちょうど x の変化の 0.5 倍で動くなら、先を見ない推定は当たる
const weeks = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 3, 10) + i * 7 * 864e5).toISOString().slice(0, 10));
const px = weeks.map((d, i) => ({ d, c: 100 * (1 + 0.05 * Math.sin(i / 2)) }));
const st2 = [{ code: "B", prices: px, rows: [{ date: "2026-01-02", av: "2026-01-02", n: 10, p: 100, e: 100 }] }];
const b2 = M.build(st2, 0, 0);
const targets = weeks.map((d) => ({ date: d, y: -5 + 0.5 * M.xAt(b2, d).x, src: "t" }));
const f = M.fit(targets, b2, { minTrain: 5 });
assert.ok(Math.abs(f.b - 0.5) < 1e-9 && f.mae < 1e-9 && f.maeNaive > 0.1, `${f.b} ${f.mae}`);
// nowcast: 最後の公表日より後の日だけ。幅は週数とともに広がる
const nc = M.nowcast(f, b2, [weeks.at(-1), "2099-01-01"]); assert.strictEqual(nc.length, 0); // 価格の無い日は出さない
console.log("marginmodel ok");

// ---------- 全銘柄の合計(JPX 銘柄別信用取引残高の PDF)----------
const fx = require("./fixtures/margin_market_2026-10.json");
assert.strictEqual(M.monday("2026-11-13"), "2026-11-09"); assert.strictEqual(M.friday("2026-11-09"), "2026-11-13"); assert.strictEqual(M.friday("2026-11-15"), "2026-11-13");
// 怪しい日(2026-10-20: 買残が前日の7割になり翌日に戻った)は使わない
assert.ok(!M.cleanDaily(fx.daily).some((r) => r.date === "2026-10-20"));
// 信用倍率: 毎日の合計(東証)は公表値(2市場)と 0.01 以内で一致する。先を見ない比の補正で更に近づく
const rc = M.ratioCheck(fx.official, fx.daily);
assert.strictEqual(rc.weeks.length, 6);
assert.ok(rc.weeks.every((w) => Math.abs(w.raw - w.off) < 0.01), JSON.stringify(rc.weeks.map((w) => w.raw - w.off)));
assert.ok(rc.mae <= rc.maeRaw && rc.mae < 0.005 && rc.maeNaive > 0.3, `${rc.mae} ${rc.maeRaw} ${rc.maeNaive}`);
assert.ok(rc.fb > 1 && rc.fb < 1.002 && rc.fs > 1 && rc.fs < 1.001); // 名古屋の分だけ公表値が少し大きい
// 今週の推定: 最新 11/09(月)→ 11/13(金)申込分、残り4営業日。幅は正
const nc2 = M.ratioNowcast(fx.official, fx.daily, rc);
assert.strictEqual(nc2.target, "2026-11-13"); assert.strictEqual(nc2.basis, "2026-11-09"); assert.strictEqual(nc2.remaining, 4);
assert.ok(Math.abs(nc2.ratio - (3389929086 * rc.fb) / (340537277 * rc.fs)) < 1e-9 && nc2.lo < nc2.ratio && nc2.hi > nc2.ratio);
// 公表値がまだ無い週の金曜なら、その金曜が対象で残り0日(幅0)
const nc3 = M.ratioNowcast(fx.official, fx.daily.filter((r) => r.date <= "2026-11-06"), rc);
assert.strictEqual(nc3.target, "2026-11-06"); assert.strictEqual(nc3.remaining, 0); assert.ok(Math.abs(nc3.hi - nc3.lo) < 1e-12);
// 評価損益率: 全銘柄の約定金額ベースの系列を x にした先を見ない推定(b はそれまでの週だけで決める)
const pf = M.fitX(fx.pl, M.linkSeries(fx.daily), { minTrain: 3 });
assert.strictEqual(pf.n, 7); assert.strictEqual(pf.nEval, 4);
assert.ok(pf.mae < pf.maeNaive, `${pf.mae} ${pf.maeNaive}`);
// 事前登録の答え合わせ: 同じ週の公表値と突き合わせる
const g = M.gradeNowcasts([{ targetDate: "2026-10-30", ratio: 10.45, pl: -12 }, { targetDate: "2026-11-13", ratio: 9.9, pl: -20 }], fx.official, fx.pl);
assert.ok(Math.abs(g[0].ratioErr - (10.45 - 3654854000 / 349230000)) < 1e-9 && Math.abs(g[0].plErr - 0.54) < 1e-9);
assert.strictEqual(g[1].offRatio, null); assert.strictEqual(g[1].plErr, null);
// 指数の対数
const li = M.logIndex([{ d: "2026-01-02", c: 100 }, { d: "2026-01-09", c: 110 }]);
assert.ok(Math.abs(li("2026-01-12").x - 100 * Math.log(110)) < 1e-9); assert.strictEqual(li("2026-02-01"), null);
console.log("marginmodel (全銘柄) ok");

// 毎営業日の推定: 先を見ない(その日より前の公表値だけ)。公表日の行は推定と公表値を並べる
const de = M.dailyEstimates(fx.daily, fx.pl, fx.official);
assert.ok(!de.some((r) => r.date === "2026-10-20")); // JPX の集計ミスの日は推定しない
const d1106 = de.find((r) => r.date === "2026-11-06"), d1109 = de.find((r) => r.date === "2026-11-09");
assert.strictEqual(d1106.anchor, "2026-10-30"); assert.strictEqual(d1106.plOff, -21.08);
assert.strictEqual(d1109.anchor, "2026-11-06"); assert.ok(Math.abs(d1109.pl - (-21.08 + d1109.b * (-19.551 + 21.303))) < 1e-9);
assert.ok(d1109.b > 0.7 && d1109.b < 0.9, String(d1109.b));
const d0925 = de.find((r) => r.date === "2026-09-25"); assert.strictEqual(d0925.pl, null); // それより前の公表値が無い
assert.ok(Math.abs(de.find((r) => r.date === "2026-10-30").ratio - 3654854000 / 349230000) < 0.005);
console.log("marginmodel (毎日) ok");

// ---- 予測(日証金の値まで)と実データの分離(2026-11-19) ----
{
  const fr = M.ratioForecasts(fx.daily, fx.official, ["2026-11-10"]);
  const row = (d) => fr.find((r) => r.date === d);
  // 日証金が無いときは「前の営業日の合計のまま」。祝日(11/3)をはさむ 11/4 の元は 11/2
  assert.strictEqual(row("2026-10-23").base, "2026-10-22"); assert.strictEqual(row("2026-10-23").used, "persist");
  assert.strictEqual(row("2026-11-04").base, "2026-11-02");
  // 金曜の実データは公表値とほぼ同じ(先回り集計)。判明は月曜、公表は火曜(祝日をはさむと水曜)
  assert.ok(Math.abs(row("2026-10-30").actual - row("2026-10-30").off) < 0.01);
  assert.strictEqual(row("2026-10-30").actualAt, "2026-11-02");
  assert.strictEqual(row("2026-10-30").offAt, "2026-11-04");
  // 未来の日は予測だけ(実データなし)
  assert.strictEqual(row("2026-11-10").actual, null); assert.ok(row("2026-11-10").fc > 0);

  // 日証金の変化が全銘柄の合計の変化のちょうど半分なら、β ≒ 2 になり、予測は実データとほぼ同じになる
  const dd = M.cleanDaily(fx.daily);
  const jsf = dd.map((r, i) => ({ date: r.date, dLoan: i ? 0.5 * Math.log(r.buy_sh / dd[i - 1].buy_sh) : null, dLend: i ? 0.5 * Math.log(r.sell_sh / dd[i - 1].sell_sh) : null }));
  const fj = M.ratioForecasts(fx.daily, fx.official, [], undefined, jsf);
  const late = fj.filter((r) => r.used === "jsf");
  assert.ok(late.length >= 10, `日証金を使った日 ${late.length}`);
  late.forEach((r) => { assert.ok(Math.abs(r.beta.b - 2) < 1e-6 && Math.abs(r.beta.s - 2) < 1e-6); assert.ok(Math.abs(r.fc / r.actual - 1) < 0.002, `${r.date} ${r.fc} ${r.actual}`); });
  // 先を見ない: D の予測は、D 以降の全銘柄の合計・D より後の日証金・まだ出ていない公表値を壊しても変わらない
  const D = late.at(-3).date; const a = fj.find((r) => r.date === D);
  const broken = fx.daily.map((r) => (r.date >= D ? { ...r, buy_sh: r.buy_sh * 2 } : r));
  const jsfB = jsf.map((r) => (r.date > D ? { ...r, dLoan: 9 } : r));
  const offB = fx.official.map((o) => (M.friday(o.date) >= M.friday(D) ? { ...o, buy: o.buy * 3 } : o));
  assert.strictEqual(M.ratioForecasts(broken, offB, [], undefined, jsfB).find((r) => r.date === D).fc, a.fc);
  console.log("ratioForecasts ok");
}
