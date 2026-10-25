// node tests/credit.test.js
const assert = require("assert");
const C = require("../assets/js/credit.js");

const days = (from, n, price) => {
  const out = []; const t0 = Date.parse(`${from}T00:00:00Z`);
  for (let i = 0, k = 0; out.length < n; k++) {
    const t = new Date(t0 + k * 864e5); const wd = t.getUTCDay(); if (wd === 0 || wd === 6) continue;
    const p = typeof price === "function" ? price(i) : price; out.push({ d: t.toISOString().slice(0, 10), o: p, h: p, l: p, c: p, v: 1000 }); i++;
  }
  return out;
};

// 1) 価格一定 → 損益率 0、金額 = 株数 × 価格
{
  const daily = days("2026-01-05", 60, 1000);
  const credit = [{ date: "2026-01-09", buy: 1000, sell: 500 }, { date: "2026-01-16", buy: 2000, sell: 500 }];
  const r = C.estimateCredit(credit, daily, []).rows;
  assert.strictEqual(r[1].buyAmount, 2_000_000);
  assert.strictEqual(r[1].sellAmount, 500_000);
  assert.ok(Math.abs(r[1].buyPnl) < 1e-12);
  assert.strictEqual(r[1].ratio, 4);
}

// 2) 1000円で建てた買残が、1200円になれば +20%、売り方は −20%
{
  const daily = days("2026-01-05", 40, (i) => (i < 5 ? 1000 : 1200));
  const credit = [{ date: "2026-01-09", buy: 1000, sell: 1000 }, { date: "2026-01-23", buy: 1000, sell: 1000 }];
  const r = C.estimateCredit(credit, daily, []).rows;
  assert.ok(Math.abs(r[1].buyPnl - 0.2) < 1e-9, r[1].buyPnl);
  assert.ok(Math.abs(r[1].sellPnl + 0.2) < 1e-9, r[1].sellPnl);
}

// 3) 追加の建玉はその期間の VWAP で入る: 1000円で1000株 → 1200円の週に1000株追加 → 平均1100円、終値1200円で +9.09%
{
  const daily = days("2026-01-05", 40, (i) => (i < 5 ? 1000 : 1200));
  const credit = [{ date: "2026-01-09", buy: 1000, sell: 0 }, { date: "2026-01-16", buy: 2000, sell: 0 }];
  const r = C.estimateCredit(credit, daily, []).rows;
  assert.ok(Math.abs(r[1].buyAvgPrice - 1100) < 1e-9, r[1].buyAvgPrice);
  assert.ok(Math.abs(r[1].buyPnl - (1200 / 1100 - 1)) < 1e-9);
}

// 4) FIFO と移動平均の違い: 古い(安い)建玉から返済すると平均単価は上がる
{
  const daily = days("2026-01-05", 40, (i) => (i < 5 ? 1000 : 1200));
  const credit = [{ date: "2026-01-09", buy: 1000 }, { date: "2026-01-16", buy: 2000 }, { date: "2026-01-23", buy: 1000 }];
  const fifo = C.estimateCredit(credit, daily, [], { method: "fifo6m" }).rows.at(-1);
  const avg = C.estimateCredit(credit, daily, [], { method: "avg" }).rows.at(-1);
  assert.ok(Math.abs(fifo.buyAvgPrice - 1200) < 1e-9, fifo.buyAvgPrice);
  assert.ok(Math.abs(avg.buyAvgPrice - 1100) < 1e-9, avg.buyAvgPrice);
}

// 5) 6か月の期日: 1000円の建玉が残り続けても、期日後は期日の終値(1500円)に置き直す
{
  const daily = days("2026-01-05", 200, (i) => (i < 100 ? 1000 : 1500));
  const credit = [{ date: "2026-01-09", buy: 1000 }, { date: "2026-09-04", buy: 1000 }];
  const r = C.estimateCredit(credit, daily, []).rows;
  assert.ok(Math.abs(r[1].buyAvgPrice - 1500) < 1e-9, r[1].buyAvgPrice);
  const a = C.estimateCredit(credit, daily, [], { method: "avg" }).rows;
  assert.ok(Math.abs(a[1].buyPnl - 0.5) < 1e-9);
}

// 6) 分割: 日足は調整済み・信用残は未調整(分割で株数が2倍に跳ぶ)→ 自動判定して金額を揃える
{
  const daily = days("2026-01-05", 80, 500); // 調整後 500円(分割前の実際は 1000円)
  const splits = [["2026-02-02", 2]];
  const credit = [
    { date: "2026-01-09", buy: 1000, sell: 100 }, { date: "2026-01-16", buy: 1000, sell: 100 }, { date: "2026-01-23", buy: 1000, sell: 100 },
    { date: "2026-02-06", buy: 2000, sell: 200 }, { date: "2026-02-13", buy: 2000, sell: 200 }, { date: "2026-02-20", buy: 2000, sell: 200 },
  ];
  const est = C.estimateCredit(credit, daily, splits);
  assert.strictEqual(est.unadjusted, true);
  assert.strictEqual(est.rows[0].buyAmount, 1_000_000); // 1000株 × 実際の1000円
  assert.strictEqual(est.rows.at(-1).buyAmount, 1_000_000); // 2000株 × 500円
  assert.ok(Math.abs(est.rows.at(-1).buyPnl) < 1e-12);
  // 調整済みの信用残なら未調整と判定しない
  const adj = credit.map((c) => ({ ...c, buy: 2000, sell: 200 }));
  assert.strictEqual(C.estimateCredit(adj, daily, splits).unadjusted, false);
}

// 7) changeOver: 4週前比
{
  const rows = [{ date: "2026-01-02", sell: 100 }, { date: "2026-01-09", sell: 110 }, { date: "2026-01-30", sell: 150 }];
  assert.ok(Math.abs(C.changeOver(rows, "sell", 4) - 0.5) < 1e-12);
}
// 8) 取得元のつなぎ: 同じ日付は stockAI > 株探保存 > IRBANK保存、隙間は後ろの取得元で埋める
{
  const base = [{ date: "2026-01-09", buy: 10, sell: 1 }, { date: "2026-01-23", buy: 12, sell: 1 }];
  const kab = [{ date: "2026-01-16", buy: 11, sell: 1 }, { date: "2026-01-23", buy: 99, sell: 9 }, { date: "2026-01-30", buy: 13, sell: 1 }];
  const irb = [{ date: "2020-01-10", buy: 5, sell: 1 }, { date: "2026-01-16", buy: 77, sell: 7 }, { date: "2020-01-17", buy: null, sell: null }];
  const m = C.mergeSources([[base, (r) => r.source || "stockAI"], [kab, "株探保存"], [irb, "IRBANK保存"]]);
  assert.deepStrictEqual(m.map((r) => [r.date, r.buy, r.source]), [["2020-01-10", 5, "IRBANK保存"], ["2026-01-09", 10, "stockAI"], ["2026-01-16", 11, "株探保存"], ["2026-01-23", 12, "stockAI"], ["2026-01-30", 13, "株探保存"]]);
}
console.log("credit tests: ok");
