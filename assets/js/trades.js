// Stock Rank — 自分の売買の記録(この端末のブラウザだけに保存。GitHub には送らない)
//
// 記録: {id, code, date, side: "buy"|"sell", price, qty, note}
// 対応づけ: 銘柄ごとに日付順に並べ、先入れ先出しで「建てた売買」と「手じまった売買」を組にする。
//   買い → 売り は買いの取引(ロング)、売り → 買い は空売り・信用売りの取引(ショート)。
//   一部だけ手じまったときは、株数で分けて別の組にする。
(function (root) {
  "use strict";
  const KEY = "stockrank-trades";
  const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[,円株\s]/g, "")); return Number.isFinite(n) ? n : null; };

  function load(store = root.localStorage) { try { const v = JSON.parse(store.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
  function save(list, store = root.localStorage) { try { store.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
  const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  function sortTrades(list) {
    return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq ?? 0) - (b.seq ?? 0)));
  }

  // 先入れ先出しで組にする。pairs: [{open, close, qty, dir: 1(ロング)|-1(ショート), pnl, pnlPct}]、open: 残っている建玉
  function match(list) {
    const lots = []; const pairs = []; let realized = 0;
    sortTrades(list).forEach((t) => {
      const dir = t.side === "buy" ? 1 : -1; let left = num(t.qty) || 0; const price = num(t.price);
      if (!left || price === null) return;
      while (left > 1e-9 && lots.length && lots[0].dir === -dir) {
        const lot = lots[0]; const q = Math.min(lot.left, left);
        const pnl = (price - lot.price) * q * lot.dir;
        pairs.push({ open: lot.trade, close: t, qty: q, dir: lot.dir, pnl, pnlPct: lot.price ? (price / lot.price - 1) * lot.dir : null });
        realized += pnl; lot.left -= q; left -= q;
        if (lot.left <= 1e-9) lots.shift();
      }
      if (left > 1e-9) lots.push({ trade: t, price, left, dir });
    });
    const pos = lots.reduce((s, l) => s + l.left * l.dir, 0);
    const cost = lots.reduce((s, l) => s + l.left * l.price, 0); const shares = lots.reduce((s, l) => s + l.left, 0);
    const wins = pairs.filter((p) => p.pnl > 0).length;
    return { pairs, open: lots, realized, position: pos, avgPrice: shares ? cost / shares : null, wins, closed: pairs.length };
  }

  // 証券会社の約定履歴の CSV(SBI・楽天・マネックスなど)を読む。見出しの行を探して列を決める
  function parseCsv(text) {
    const rows = text.replace(/^﻿/, "").split(/\r?\n/).map(splitCsvLine).filter((r) => r.some((c) => c.trim()));
    const hi = rows.findIndex((r) => r.some((c) => /約定日|取引日|日付/.test(c)) && r.some((c) => /単価|価格/.test(c)) && r.some((c) => /数量|株数/.test(c)));
    if (hi < 0) throw new Error("見出し(約定日・単価・数量)が見つかりませんでした");
    const h = rows[hi].map((c) => c.trim());
    const col = (re, ex) => h.findIndex((c) => re.test(c) && !(ex && ex.test(c)));
    const cDate = col(/約定日|取引日|日付/, /受渡/), cCode = col(/銘柄コード|コード/), cName = col(/銘柄/, /コード/), cSide = col(/売買|取引区分|取引|区分/, /日|単価|数量|手数料|税/);
    const cPrice = col(/約定単価|単価|約定価格|価格/, /手数料|金額/), cQty = col(/約定数量|数量|株数/, /単価/);
    const out = [];
    rows.slice(hi + 1).forEach((r, i) => {
      const date = normDate(r[cDate]); const sideText = `${cSide >= 0 ? r[cSide] : ""}`;
      const side = /売/.test(sideText) && !/買戻|買い戻/.test(sideText) ? "sell" : /買/.test(sideText) ? "buy" : null;
      const codeText = `${cCode >= 0 ? r[cCode] : ""} ${cName >= 0 ? r[cName] : ""}`;
      const code = (codeText.match(/(?:^|[^0-9A-Z])([0-9][0-9A-Z]{3})(?:[^0-9A-Z]|$)/) || [])[1];
      const price = num(r[cPrice]), qty = num(r[cQty]);
      if (!date || !side || !code || price === null || !qty) return;
      out.push({ id: newId(), code, date, side, price, qty, note: sideText.trim(), seq: i });
    });
    return out;
  }
  function splitCsvLine(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === "," || ch === "\t") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out;
  }
  function normDate(s) {
    const m = String(s || "").trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
  }
  function toCsv(list) {
    const head = "約定日,銘柄コード,売買,約定単価,約定数量,メモ";
    return [head, ...sortTrades(list).map((t) => [t.date, t.code, t.side === "buy" ? "買" : "売", t.price, t.qty, `"${String(t.note || "").replace(/"/g, '""')}"`].join(","))].join("\n");
  }
  // 同じ約定(日付・銘柄・売買・単価・数量)が既にあれば足さない(同じ CSV を2回読み込んでも重ならない)
  function mergeTrades(old, add) {
    const key = (t) => [t.date, t.code, t.side, t.price, t.qty].join("|");
    const seen = new Set(old.map(key)); const out = old.slice(); let added = 0;
    add.forEach((t) => { if (!seen.has(key(t))) { seen.add(key(t)); out.push(t); added++; } });
    return { list: out, added };
  }

  const api = { KEY, load, save, newId, match, parseCsv, toCsv, mergeTrades, sortTrades };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SRTrades = api;
})(typeof window !== "undefined" ? window : globalThis);
