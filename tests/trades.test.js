// node tests/trades.test.js — 売買の記録の対応づけ(先入れ先出し)と CSV の読み込み
const assert = require("assert");
const T = require("../assets/js/trades.js");

// 買い 200 → 売り 100 → 売り 100: 2組、損益は株数で分ける
let m = T.match([
  { code: "7203", date: "2026-01-05", side: "buy", price: 1000, qty: 200 },
  { code: "7203", date: "2026-02-02", side: "sell", price: 1100, qty: 100 },
  { code: "7203", date: "2026-03-02", side: "sell", price: 900, qty: 100 },
]);
assert.strictEqual(m.pairs.length, 2); assert.strictEqual(m.pairs[0].pnl, 10000); assert.strictEqual(m.pairs[1].pnl, -10000);
assert.strictEqual(m.position, 0); assert.strictEqual(m.wins, 1);
assert.ok(Math.abs(m.pairs[0].pnlPct - 0.1) < 1e-12);

// 空売り: 売り → 買い戻しは値下がりで利益
m = T.match([{ date: "2026-01-05", side: "sell", price: 1000, qty: 100 }, { date: "2026-01-20", side: "buy", price: 800, qty: 100 }]);
assert.strictEqual(m.pairs[0].dir, -1); assert.strictEqual(m.pairs[0].pnl, 20000); assert.ok(Math.abs(m.pairs[0].pnlPct - 0.2) < 1e-12);

// 残っている建玉と平均単価
m = T.match([{ date: "2026-01-05", side: "buy", price: 1000, qty: 100 }, { date: "2026-01-06", side: "buy", price: 1200, qty: 100 }, { date: "2026-01-07", side: "sell", price: 1300, qty: 100 }]);
assert.strictEqual(m.position, 100); assert.strictEqual(m.avgPrice, 1200); assert.strictEqual(m.pairs[0].open.price, 1000);

// 証券会社の CSV(見出しの前に説明の行がある・数字にカンマ)
const csv = `約定履歴照会\n"約定日","銘柄","銘柄コード","取引","約定数量","約定単価","手数料"\n"2026/10/01","トヨタ自動車","7203","現物買","100","3,000","0"\n"2026/10/15","トヨタ自動車","7203","現物売","100","3,150","0"\n"2026/10/16","キオクシア","285A","信用新規売","100","17,000","0"\n"2026/10/20","キオクシア","285A","信用返済買","100","16,500","0"`;
const list = T.parseCsv(csv);
assert.strictEqual(list.length, 4);
assert.deepStrictEqual(list.map((t) => [t.code, t.date, t.side, t.price, t.qty]), [["7203", "2026-10-01", "buy", 3000, 100], ["7203", "2026-10-15", "sell", 3150, 100], ["285A", "2026-10-16", "sell", 17000, 100], ["285A", "2026-10-20", "buy", 16500, 100]]);

// 同じ CSV を2回読んでも重ならない
const merged = T.mergeTrades(list, T.parseCsv(csv));
assert.strictEqual(merged.added, 0); assert.strictEqual(merged.list.length, 4);
// 書き出し → 読み込みで元に戻る
assert.strictEqual(T.parseCsv(T.toCsv(list)).length, 4);
console.log("trades tests: ok");
