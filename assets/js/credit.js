// Stock Rank — 信用残の金額と「推定」信用評価損益率
//
// 個別銘柄の信用評価損益率は公表されていない(日経・松井証券などが出すのは市場全体の値)。
// ここでは 申込日ごとの買残・売残(株数)と日足から、建玉の取得コストを追跡して推定する。
//
//   金額         = 残高(株) × 申込日の終値
//   取得コスト   = 増えた株数 × その期間の VWAP(典型価格 (高+安+終)/3 を出来高で加重)を積み上げたもの
//   買い方損益率 = 買残金額 ÷ 買い方の取得コスト − 1
//   売り方損益率 = 1 − 売残金額 ÷ 売り方の取得コスト   (売り方は株価が下がると利益)
//
// 減った株数の扱いは2通り:
//   fifo6m … 古い建玉から返済(先入れ先出し)。制度信用の期日(6か月=182日)を過ぎた建玉は
//            期日の終値で乗り換えたとみなして取得単価を置き直す。
//   avg    … 移動平均法。減った割合だけ取得コストを比例で減らす(期日は考えない)。
// 初回の観測は「その日の終値で建てた」と置くので、最初の約半年(warmup)は損益率が0%寄りに出る。
(function (root) {
  "use strict";
  const DAY = 864e5;
  const EXPIRY_DAYS = 182;
  const num = (v) => { const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n; };
  const toTime = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
  const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

  // 分割: [[日付, 比率], ...]。比率 2 = 1株→2株。日足はさかのぼって調整済み(Future Sight と同じ前提)
  function splitFactor(splits, date) {
    let f = 1;
    (splits || []).forEach(([d, r]) => { const x = num(r); if (d > date && x && x > 0) f *= x; });
    return f;
  }

  // 信用残の株数が分割調整済みかを、分割日の前後の残高の跳びで判定する。
  // 前後4回の中央値の比が分割比率に近ければ「未調整」(公表値のまま)。
  function creditIsUnadjusted(credit, splits) {
    const med = (a) => { const s = a.filter((x) => x !== null && x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    let votes = 0;
    (splits || []).forEach(([d, r]) => {
      const ratio = num(r); if (!ratio || Math.abs(Math.log(ratio)) < 0.1) return;
      const before = credit.filter((c) => c.date < d).slice(-4), after = credit.filter((c) => c.date >= d).slice(0, 4);
      if (before.length < 2 || after.length < 2) return;
      const total = (c) => (num(c.buy) || 0) + (num(c.sell) || 0);
      const b = med(before.map(total)), a = med(after.map(total)); if (!b || !a) return;
      const jump = Math.log(a / b);
      votes += Math.abs(jump - Math.log(ratio)) < Math.abs(jump) ? 1 : -1;
    });
    return votes > 0;
  }

  // 日足の検索(d 昇順を前提)
  function makePriceBook(daily) {
    const rows = (daily || []).filter((r) => num(r.c) !== null).slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const dates = rows.map((r) => r.d);
    const upto = (date) => { let lo = 0, hi = dates.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; };
    return {
      rows,
      closeAt(date) { const i = upto(date); return i < 0 ? null : rows[i].c; },
      // (from, to] の VWAP。出来高が無ければ典型価格の単純平均、期間内に日足が無ければ to 以前の終値
      vwap(from, to) {
        const j = upto(to); if (j < 0) return null;
        let sv = 0, spv = 0, n = 0, sp = 0;
        for (let i = j; i >= 0 && (from === null || rows[i].d > from); i--) {
          const r = rows[i]; const tp = ((num(r.h) ?? r.c) + (num(r.l) ?? r.c) + r.c) / 3; const v = num(r.v) || 0;
          sv += v; spv += tp * v; sp += tp; n++;
        }
        if (!n) return rows[j].c;
        return sv > 0 ? spv / sv : sp / n;
      },
      avgVolume(date, days = 20) {
        const j = upto(date); if (j < 0) return null;
        let s = 0, n = 0; for (let i = j; i >= 0 && n < days; i--, n++) s += num(rows[i].v) || 0;
        return n ? s / n : null;
      },
    };
  }

  // 片側(買い or 売り)の建玉の取得コストを追跡する
  function makeBook(method) {
    let lots = []; let shares = 0; let cost = 0;
    return {
      update(newShares, price, date, book) {
        if (method === "fifo6m") {
          const t = toTime(date);
          lots.forEach((lot) => {
            while (toTime(lot.date) + EXPIRY_DAYS * DAY <= t) {
              const exp = isoDate(toTime(lot.date) + EXPIRY_DAYS * DAY);
              lot.price = book.closeAt(exp) ?? lot.price; lot.date = exp;
            }
          });
          const delta = newShares - lots.reduce((s, l) => s + l.shares, 0);
          if (delta > 0) lots.push({ shares: delta, price, date, built: date, cost0: price });
          else if (delta < 0) {
            let left = -delta;
            while (left > 1e-9 && lots.length) { const l = lots[0]; const take = Math.min(l.shares, left); l.shares -= take; left -= take; if (l.shares <= 1e-9) lots.shift(); }
          }
          shares = lots.reduce((s, l) => s + l.shares, 0); cost = lots.reduce((s, l) => s + l.shares * l.price, 0);
          return { shares, cost, oldest: lots[0]?.date || null };
        }
        if (newShares > shares) cost += (newShares - shares) * price;
        else if (shares > 0) cost *= newShares / shares;
        shares = newShares;
        return { shares, cost, oldest: null };
      },
      // 残っている建玉(先入れ先出しのときだけ)。date は最後に建てた(乗り換えた)日、built は最初に建てた日
      lots() { return lots.map((l) => ({ ...l })); },
    };
  }

  // credit: [{date, buy, sell, ratio, availableFrom, ...}] / daily: [{d,o,h,l,c,v}](分割調整済み)
  function estimateCredit(credit, daily, splits, opts = {}) {
    const method = opts.method === "avg" ? "avg" : "fifo6m";
    const list = (credit || []).filter((r) => r && r.date && (num(r.buy) !== null || num(r.sell) !== null)).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const book = makePriceBook(daily);
    const unadjusted = creditIsUnadjusted(list, splits);
    const buyBook = makeBook(method), sellBook = makeBook(method);
    const first = list[0]?.date; const warmupEnd = first ? isoDate(toTime(first) + EXPIRY_DAYS * DAY) : null;
    let prev = null;
    const rows = list.map((r) => {
      const pf = splitFactor(splits, r.date); const f = unadjusted ? pf : 1;
      const buy = num(r.buy), sell = num(r.sell);
      const buyAdj = buy === null ? null : buy * f, sellAdj = sell === null ? null : sell * f;
      const close = book.closeAt(r.date);
      const entry = prev ? book.vwap(prev.date, r.date) : close;
      const b = close === null || buyAdj === null ? null : buyBook.update(buyAdj, entry, r.date, book);
      const s = close === null || sellAdj === null ? null : sellBook.update(sellAdj, entry, r.date, book);
      const buyAmount = close === null || buyAdj === null ? null : buyAdj * close;
      const sellAmount = close === null || sellAdj === null ? null : sellAdj * close;
      const vol20 = book.avgVolume(r.date, 20);
      const out = {
        date: r.date, availableFrom: r.availableFrom || null, source: r.source || null,
        close, closeRaw: close === null ? null : close * pf, splitFactor: f, priceFactor: pf,
        buy, sell, buyChg: prev && buy !== null && prev.buy !== null ? buy - prev.buy : null, sellChg: prev && sell !== null && prev.sell !== null ? sell - prev.sell : null,
        ratio: num(r.ratio) ?? (buy !== null && sell ? buy / sell : null),
        buyAmount, sellAmount, netAmount: buyAmount === null || sellAmount === null ? null : buyAmount - sellAmount,
        buyCost: b?.cost ?? null, sellCost: s?.cost ?? null,
        buyAvgPrice: b && b.shares > 0 ? b.cost / b.shares : null, sellAvgPrice: s && s.shares > 0 ? s.cost / s.shares : null,
        buyPnl: b && b.cost > 0 && buyAmount !== null ? buyAmount / b.cost - 1 : null,
        sellPnl: s && s.cost > 0 && sellAmount !== null ? 1 - sellAmount / s.cost : null,
        buyDays: vol20 && buyAdj !== null ? buyAdj / vol20 : null, sellDays: vol20 && sellAdj !== null ? sellAdj / vol20 : null,
        entryPrice: entry, warmup: warmupEnd !== null && r.date < warmupEnd,
      };
      prev = out; return out;
    });
    return { method, unadjusted, rows, warmupEnd, buyLots: buyBook.lots(), sellLots: sellBook.lots() };
  }

  // 信用期日の到来予定。先入れ先出しで残った建玉それぞれの「次の期日」(建てた日・乗り換えた日 + 182日)を、
  // 週または月ごとに集計する。price はいまの株価(分割調整済み)。asOf より前に来る期日は、asOf 以降の次の期日に送る
  // unknownBuilt: この日に建てたことになっている建玉は除く(履歴の最初の残高。本当に建てた日は分からない)
  function expirySchedule(lots, price, asOf, by = "month", unknownBuilt = null) {
    const t0 = toTime(asOf); const groups = new Map();
    (lots || []).forEach((l) => {
      if (!(l.shares > 0) || (unknownBuilt && l.built === unknownBuilt)) return;
      let exp = toTime(l.date) + EXPIRY_DAYS * DAY; let rolled = 0;
      while (exp < t0) { exp += EXPIRY_DAYS * DAY; rolled++; }
      const d = isoDate(exp);
      let key;
      if (by === "week") { const t = new Date(exp); t.setUTCDate(t.getUTCDate() + ((5 - t.getUTCDay() + 7) % 7)); key = t.toISOString().slice(0, 10); }
      else key = d.slice(0, 7);
      const g = groups.get(key) || { key, shares: 0, cost: 0, first: d, last: d, lots: 0, rolled: 0 };
      g.shares += l.shares; g.cost += l.shares * l.price; g.lots++; g.rolled += rolled;
      if (d < g.first) g.first = d; if (d > g.last) g.last = d;
      groups.set(key, g);
    });
    return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((g) => ({
      ...g, avgPrice: g.shares ? g.cost / g.shares : null, amount: price === null ? null : g.shares * price,
      pnl: price === null || !g.cost ? null : g.shares * price / g.cost - 1,
    }));
  }

  // n 観測前(週次なら n 週前)との変化率
  function changeOver(rows, key, weeks) {
    const last = rows.at(-1); if (!last || num(last[key]) === null) return null;
    const lim = isoDate(toTime(last.date) - weeks * 7 * DAY); let base = null;
    for (const r of rows) { if (r.date <= lim) base = r; else break; }
    const a = num(last[key]), b = num(base?.[key]);
    return b ? a / b - 1 : null;
  }

  // 複数の取得元の信用残を日付でつなぐ。sources は優先順の [[rows, 既定の出典名], ...]。
  // 同じ日付は先の取得元を採る(stockAI > 株探保存 > IRBANK保存)
  function mergeSources(sources) {
    const byDate = new Map();
    sources.forEach(([rows, label]) => (rows || []).forEach((r) => {
      if (!r?.date || byDate.has(r.date) || (num(r.buy) === null && num(r.sell) === null)) return;
      byDate.set(r.date, { ...r, buy: num(r.buy), sell: num(r.sell), ratio: num(r.ratio), source: typeof label === "function" ? label(r) : label });
    }));
    return [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  }

  const api = { estimateCredit, expirySchedule, mergeSources, creditIsUnadjusted, splitFactor, makePriceBook, changeOver, EXPIRY_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRCredit = api;
})(typeof window !== "undefined" ? window : globalThis);
