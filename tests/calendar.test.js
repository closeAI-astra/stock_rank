// node tests/calendar.test.js — スケジュールの決まりごと(SQ・権利日・営業日)と決算日の推定
const assert = require("assert");
const C = require("../assets/js/calendar.js");
const cal = C.makeBizCal([]);
// 2026-12 の SQ は第2金曜 12/11、権利付き最終日は 12/28(月末 12/30 の2営業日前。12/31 は休場)
const ev = C.ruleEvents("2026-12-01", "2026-12-31", cal);
assert.ok(ev.some((e) => e.kind === "sq" && e.date === "2026-12-11" && /メジャー/.test(e.title)));
assert.ok(ev.some((e) => e.kind === "rights" && e.date === "2026-12-28" && /権利付き最終日/.test(e.title)));
// 祝日をまたぐ営業日の計算(2026-11-03 は文化の日)
assert.strictEqual(cal.shift("2026-11-02", 1), "2026-11-04");
// 米雇用統計: 第1金曜が1日なら翌週(2027-01-01 → 01-08)
assert.ok(C.ruleEvents("2027-01-01", "2027-01-31", cal).some((e) => /雇用統計/.test(e.title) && e.date === "2027-01-08"));
// 決算の推定は去年 + 364 日(同じ曜日)
const est = C.estimateEarnings({ 7203: { items: [{ announceDate: "2025-11-05", period: "25.07-09" }] } }, "2026-10-27", "2026-11-30", { 7203: "トヨタ" });
assert.strictEqual(est[0].date, "2026-11-04");
console.log("calendar tests: ok");
