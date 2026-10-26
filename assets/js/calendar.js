// Stock Rank — 相場のスケジュール(決まりごとから計算できるイベント・決算発表の推定・過去の TOPIX の動き)
// 画面に依存しない計算だけ(node でもテストできる)。日付はすべて "YYYY-MM-DD"(日本時間の暦日)
(function (root) {
  "use strict";
  const DAY = 864e5;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const add = (d, k) => iso(t(d) + k * DAY);
  const dow = (d) => new Date(t(d)).getUTCDay(); // 0=日

  // 東証の休業日(土日以外)。2026 年 11 月以降と 2027 年。春分・秋分は国立天文台の暦要項の予定日。
  // 祝日が変わったら足す(足りない年は土日だけで数えるので、前後にずれることがある)
  const JP_HOLIDAYS = new Set([
    "2026-11-03", "2026-11-23", "2026-12-31",
    "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-22", "2027-04-29",
    "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11",
    "2027-11-03", "2027-11-23", "2027-12-31",
  ]);
  // 過去は TOPIX の日足がある日を営業日とする(休場日が自然に抜ける)
  function makeBizCal(pastDays) {
    const past = new Set(pastDays || []); const lastPast = (pastDays || []).at(-1) || "0000-00-00";
    const isBiz = (d) => (d <= lastPast ? past.has(d) : dow(d) !== 0 && dow(d) !== 6 && !JP_HOLIDAYS.has(d));
    return {
      isBiz,
      next(d) { let x = d; while (!isBiz(x)) x = add(x, 1); return x; },
      prev(d) { let x = d; while (!isBiz(x)) x = add(x, -1); return x; },
      shift(d, n) { let x = d; let k = n; while (k !== 0) { x = add(x, k > 0 ? 1 : -1); if (isBiz(x)) k += k > 0 ? -1 : 1; } return x; },
    };
  }
  const monthStart = (y, m) => `${y}-${String(m).padStart(2, "0")}-01`;
  const monthEnd = (y, m) => iso(Date.UTC(y, m, 0));
  function nthWeekday(y, m, weekday, n) { // m: 1-12
    let d = monthStart(y, m); while (dow(d) !== weekday) d = add(d, 1); return add(d, 7 * (n - 1));
  }

  // ---------- 決まりごとのイベント ----------
  // kind: sq / rights / nisa / index / macro / dividend / credit
  function ruleEvents(from, to, cal) {
    const out = []; const push = (date, kind, title, note, extra = {}) => { if (date >= from && date <= to) out.push({ date, kind, title, note, rule: true, ...extra }); };
    const y0 = Number(from.slice(0, 4)), m0 = Number(from.slice(5, 7)), y1 = Number(to.slice(0, 4)), m1 = Number(to.slice(5, 7));
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) {
      const major = [3, 6, 9, 12].includes(m);
      // SQ(特別清算指数の算出日): 第2金曜日(休みなら前の営業日)
      const sq = cal.prev(nthWeekday(y, m, 5, 2));
      push(sq, "sq", major ? "メジャーSQ(先物・オプション)" : "SQ(オプション)", major ? "日経225先物・オプションの清算。前日〜当日の寄りに売買が集中し、値が振れやすい" : "日経225オプションの清算");
      // 権利付き最終日(月末の2営業日前)と権利落ち日
      const lastBiz = cal.prev(monthEnd(y, m)); const cum = cal.shift(lastBiz, -2), ex = cal.shift(lastBiz, -1);
      const big = m === 3 || m === 9;
      push(cum, "rights", `${m}月の権利付き最終日${big ? "(配当・優待が集中)" : ""}`, big ? "3月・9月決算の配当・株主優待の権利が付く最後の日。配当取りの買い、翌日は配当落ちで下がりやすい" : "この月が決算・中間の会社の権利付き最終日", { strong: big });
      push(ex, "rights", `${m}月の権利落ち日`, big ? "配当の分だけ下げて始まりやすい(TOPIX で 0.5〜1% 程度の配当落ち)" : "", { strong: big });
      // 月初: 積立 NISA・投信の積立の買い、年金などの月初の資金
      const first = cal.next(monthStart(y, m));
      push(first, "nisa", m === 1 ? "新年の NISA 枠(成長投資枠・つみたて投資枠)が使えるようになる" : "月初(積立 NISA・投信の積立買いが入りやすい)", m === 1 ? "年初は一括で枠を使う買いが入りやすい" : "多くの証券会社の積立日は月初〜上旬。投信経由の買い(主に全世界株・S&P500・日本株インデックス)", { strong: m === 1 });
      // 米雇用統計: 原則 第1金曜(日本時間は夜)
      // 第1金曜が1日・2日のときは、集計が間に合わず翌週になることが多い
      const nfp = nthWeekday(y, m, 5, 1); push(Number(nfp.slice(8)) <= 2 ? add(nfp, 7) : nfp, "macro", "米雇用統計(目安)", "原則は第1金曜(日本時間 21:30、米国の冬時間は 22:30)。祝日などで1週ずれることがある", { approx: true });
      // 日銀短観: 4・7・10月の初め、12月中旬(目安)
      if ([4, 7, 10].includes(m)) push(first, "macro", "日銀短観(目安)", "企業の景況感。4・7・10月は月初、12月は中旬に公表(日程は日銀の公表予定で確認)", { approx: true });
      if (m === 12) push(cal.next(`${y}-12-13`), "macro", "日銀短観(目安)", "12月は中旬", { approx: true });
      // 配当金の支払いが集中する時期(配当の再投資の買い)
      if (m === 6) push(cal.prev(`${y}-06-26`), "dividend", "3月決算の期末配当の支払いが集中", "株主総会の翌日あたりに配当が入る。再投資の買い(配当再投資・ETF の分配金)が出やすい時期", { approx: true });
      if (m === 12) push(cal.next(`${y}-12-01`), "dividend", "9月中間配当の支払いが集中(12月上旬)", "配当の再投資の買いが出やすい時期", { approx: true });
      // ETF の分配金を作るための売り(7月上旬の大型 ETF の決算)
      if (m === 7) push(cal.next(`${y}-07-08`), "dividend", "大型 ETF の決算(分配金の売りが出やすい)", "日経225・TOPIX の大型 ETF の決算が7月8〜10日ごろに集中。分配金を作るための売り(目安)", { approx: true });
      // 指数の入れ替え
      if (m === 4 || m === 10) push(first, "index", "日経平均の定期入れ替え(実施の目安)", "入る銘柄は買われ、外れる銘柄は売られやすい。発表は前月上旬(日経の発表で確認)", { approx: true });
      if ([2, 5, 8, 11].includes(m)) push(cal.prev(monthEnd(y, m)), "index", "MSCI の定期見直し(実施の目安)", "四半期の見直しは 2・5・8・11 月の最終営業日の大引けで反映。海外のパッシブ資金の売買", { approx: true });
      // 決算発表が集中する時期
      if ([1, 4, 7, 10].includes(m)) push(cal.next(`${y}-${String(m).padStart(2, "0")}-25`), "earnings_season", "決算発表シーズン入り", "3月決算の会社の決算発表が、この週から翌月半ばまでに集中する", { approx: true });
    }
    return out;
  }

  // ---------- 決算発表の推定 ----------
  // 去年の同じ時期の発表日 + 364 日(同じ曜日)。earnings: {code: {items: [{announceDate, table, period}]}}
  function estimateEarnings(earnings, from, to, names = {}) {
    const out = [];
    Object.entries(earnings || {}).forEach(([code, v]) => {
      const dates = [...new Set((v.items || []).map((x) => x.announceDate).filter(Boolean))].sort();
      const recent = dates.filter((d) => d > add(from, -35)); // 直近 5 週に既に発表していれば、その分は済み
      dates.forEach((d) => {
        const p = add(d, 364); if (p < from || p > to) return;
        if (recent.some((r) => Math.abs(t(r) - t(p)) < 40 * DAY && r < from)) return;
        const per = (v.items || []).filter((x) => x.announceDate === d).map((x) => x.period).filter(Boolean);
        out.push({ date: p, kind: "earnings", code, title: `${code} ${names[code] || ""} 決算(推定)`, note: `去年は ${d}(${[...new Set(per)].join("・")})に発表。今年の日付は会社の発表で確認`, approx: true });
      });
    });
    // 同じ銘柄・同じ日は1つに
    const seen = new Set(); return out.filter((e) => { const k = `${e.code}|${e.date}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- 信用期日の目安(市場全体): 26 週前に買残が大きく増えた週 ----------
  function creditExpiryEvents(margin, from, to) {
    const rows = (margin || []).filter((r) => Number.isFinite(r.buy));
    const inc = rows.map((r, i) => (i ? { date: r.date, d: r.buy - rows[i - 1].buy } : null)).filter(Boolean);
    const recent = inc.slice(-104).map((x) => x.d).filter((x) => x > 0).sort((a, b) => a - b);
    const th = recent.length ? recent[Math.floor(recent.length * 0.8)] : Infinity;
    return inc.filter((x) => x.d >= th).map((x) => ({ date: add(x.date, 182), build: x.date, d: x.d })).filter((x) => x.date >= from && x.date <= to)
      .map((x) => ({ date: x.date, kind: "credit", title: "信用期日が集中しやすい週(市場全体の目安)", note: `6か月前(${x.build} 申込週)に買残が ${Math.round(x.d / 1e6).toLocaleString("ja-JP")}百万株増えた。制度信用の期日で、その分の手じまい売りが出やすい`, approx: true }));
  }

  // ---------- 過去の TOPIX の動き(イベントの種類ごと) ----------
  // rows: TOPIX 日足 [{d, c}]。種類ごとに、当日の騰落(前日終値比)・前 5 日・後 5 日の平均と上昇した割合
  function eventStudy(rows) {
    const s = (rows || []).filter((r) => Number.isFinite(r.c)); if (s.length < 60) return [];
    const days = s.map((r) => r.d); const idx = new Map(days.map((d, i) => [d, i])); const cal = makeBizCal(days);
    const groups = {};
    const addE = (key, label, d) => { const i = idx.get(d); if (i === undefined || i < 6 || i + 5 >= s.length) return; (groups[key] = groups[key] || { label, list: [] }).list.push(i); };
    const y0 = Number(days[0].slice(0, 4)), y1 = Number(days.at(-1).slice(0, 4));
    for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) {
      if (monthStart(y, m) < days[0] || monthEnd(y, m) > days.at(-1)) continue;
      const major = [3, 6, 9, 12].includes(m);
      const sq = cal.prev(nthWeekday(y, m, 5, 2)); addE(major ? "msq" : "sq", major ? "メジャーSQ の日" : "SQ の日(メジャー以外)", sq);
      const lastBiz = cal.prev(monthEnd(y, m)); const ex = cal.shift(lastBiz, -1);
      addE(m === 3 || m === 9 ? "ex39" : "exother", m === 3 || m === 9 ? "3月・9月の権利落ち日" : "その他の月の権利落ち日", ex);
      addE("first", "月初の営業日(積立の買い)", cal.next(monthStart(y, m)));
      addE("last", "月末の営業日", lastBiz);
      if (m === 1) addE("jan", "大発会(年初の営業日)", cal.next(monthStart(y, m)));
    }
    const r = (a, b) => s[b].c / s[a].c - 1;
    return Object.entries(groups).map(([key, g]) => {
      const day = g.list.map((i) => r(i - 1, i)), pre = g.list.map((i) => r(i - 6, i - 1)), post = g.list.map((i) => r(i, i + 5));
      const mean = (a) => a.reduce((p, x) => p + x, 0) / a.length;
      return { key, label: g.label, n: g.list.length, day: mean(day), win: day.filter((x) => x > 0).length / day.length, pre: mean(pre), post: mean(post), from: s[g.list[0]].d };
    });
  }

  const api = { JP_HOLIDAYS, makeBizCal, nthWeekday, ruleEvents, estimateEarnings, creditExpiryEvents, eventStudy, add };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRCal = api;
})(typeof window !== "undefined" ? window : globalThis);
