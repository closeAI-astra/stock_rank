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
