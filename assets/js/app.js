// Stock Rank — 画面(チャート・ランキング・マクロ・保存データ)
(() => {
  "use strict";
  const LW = window.LightweightCharts;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境 */ } },
  };

  // ---------- 数値の表示 ----------
  const fmt = (v, d = 0) => { const n = num(v); return n === null ? "—" : n.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const fmtPrice = (v) => { const n = num(v); if (n === null) return "—"; const a = Math.abs(n); return n.toLocaleString("ja-JP", { maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 1 : 2 }); };
  const pct = (v, d = 1) => { const n = num(v); return n === null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(d)}%`; };
  const cls = (v) => { const n = num(v); return n === null || n === 0 ? "" : n > 0 ? "up" : "down"; };
  const pctCell = (v, d = 1) => `<span class="${cls(v)}">${pct(v, d)}</span>`;
  const diffCell = (v) => { const n = num(v); return n === null ? "—" : `<span class="${cls(n)}">${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("ja-JP")}</span>`; };
  // 円 → 億円・兆円
  const oku = (yen) => { const n = num(yen); if (n === null) return "—"; const a = Math.abs(n); if (a >= 1e12) return `${(n / 1e12).toFixed(2)}兆`; if (a >= 1e10) return `${Math.round(n / 1e8).toLocaleString("ja-JP")}億`; if (a >= 1e8) return `${(n / 1e8).toFixed(1)}億`; return `${(n / 1e4).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万`; };
  // 株探の金額(百万円)
  const mil = (v) => fmt(v, 0);
  const vol = (v) => { const n = num(v, 0); if (n === null) return "—"; if (n >= 1e8) return `${(n / 1e8).toFixed(2)}億`; if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`; return fmt(n); };
  // 貿易統計(億円単位の値)
  const okuUnit = (v) => { const n = num(v); if (n === null) return "—"; return Math.abs(n) >= 10000 ? `${(n / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}兆円` : `${Math.round(n).toLocaleString("ja-JP")}億円`; };
  const yoyOf = (cur, prev) => { const a = num(cur), b = num(prev); return a === null || b === null || b === 0 ? null : a / Math.abs(b) - (b < 0 ? -1 : 1); };

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2600); }
  function spark(values, w = 120, h = 28, color) {
    const v = (values || []).map(num).filter((x) => x !== null); if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (x - lo) / span * (h - 4)).toFixed(1)}`).join(" ");
    const c = color || (v.at(-1) >= v[0] ? "var(--up)" : "var(--down)");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="${c}" stroke-width="1.5" points="${pts}"/></svg>`;
  }
  // 日付表記をチャートの time(YYYY-MM-DD)にそろえる
  function normDate(d) {
    const s = String(d ?? "").trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{4})[-/.](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-01`;
    m = s.match(/^(\d{4})(\d{2})$/); if (m) return `${m[1]}-${m[2]}-01`;
    m = s.match(/^(\d{4})Q([1-4])$/i); if (m) return `${m[1]}-${String((m[2] - 1) * 3 + 1).padStart(2, "0")}-01`;
    m = s.match(/^(\d{4})$/); if (m) return `${m[1]}-01-01`;
    return null;
  }
  const timeKey = (t) => {
    if (typeof t === "string") return t;
    if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
    if (t && t.year) return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
    return null;
  };
  function download(name, text, type = "text/csv") {
    const blob = new Blob([type === "text/csv" ? "﻿" + text : text], { type }); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const csvLine = (cells) => cells.map((c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",");

  // ---------- 状態 ----------
  const DEFAULTS = { interval: "1d", type: "candle", ind: ["ma5", "ma25", "ma75", "vol", "earnings"], panes: ["credit", "pnl"], hiddenInd: [], sideOpen: true, bottomOpen: true, bottomH: 300, magnet: false, hideDrawings: false, scale: 0, bottomTab: "credit", creditMethod: "fifo6m", watch: "all", watchSort: "rank", macroTab: "trade" };
  const S = {
    dash: null, preds: [], byCode: new Map(), catalog: {}, code: null, view: "chart",
    set: { ...DEFAULTS, ...LS.get("stockrank-settings", {}) },
    favs: new Set(LS.get("stockrank-favs", [])),
    cur: null, // 表示中の銘柄 {code, daily, weekly, splits, detail, archives: {kabutan, irbank}, est, credit}
    archiveIndex: {}, // 取得元ごとの index(未読込は undefined、無ければ null)
    tool: "cursor", pending: null,
  };
  const saveSettings = () => LS.set("stockrank-settings", S.set);
  // =====================================================================
  // 入口(パスワード)
  // =====================================================================
  function showGate(message = "") {
    return new Promise((resolve) => {
      const wrap = document.createElement("div"); wrap.id = "gate";
      wrap.innerHTML = `<form><h1>Stock Rank</h1><p>stockAI(Future Sight)と同じパスワードで開きます。</p>
        <input type="password" autocomplete="current-password" placeholder="パスワード" required aria-label="パスワード">
        <label><input type="checkbox"> この端末で覚える</label><button type="submit">開く</button><p class="gate-msg">${esc(message)}</p></form>`;
      document.body.appendChild(wrap);
      const form = $("form", wrap), pw = $("input[type=password]", wrap), rem = $("input[type=checkbox]", wrap), msg = $(".gate-msg", wrap), btn = $("button", wrap);
      pw.focus();
      form.addEventListener("submit", async (e) => {
        e.preventDefault(); btn.disabled = true; msg.textContent = "確認中…";
        try {
          if (await SRData.unlock(pw.value, rem.checked)) { wrap.remove(); resolve(); return; }
          msg.textContent = "パスワードが違います。";
        } catch (err) { msg.textContent = `開けませんでした: ${err}`; }
        btn.disabled = false;
      });
    });
  }

  async function boot() {
    if (!window.crypto?.subtle || typeof DecompressionStream === "undefined") { document.body.innerHTML = "<p style='padding:24px'>このブラウザは対応していません(最新の Chrome / Edge / Safari / Firefox を使ってください)。</p>"; return; }
    try { await SRData.loadMeta(); } catch (e) { document.body.insertAdjacentHTML("beforeend", `<div id="gate"><form><h1>Stock Rank</h1><p>stockAI のデータの入口(enc-meta.json)を取得できませんでした。</p><p class="gate-msg">${esc(e.message)}</p></form></div>`); return; }
    if (!(await SRData.tryStoredKeys())) await showGate();
    try { await start(); } catch (e) { console.error(e); toast(`読み込みに失敗しました: ${e.message}`); }
  }

  async function start() {
    document.body.classList.add("loading");
    S.dash = await SRData.fs("dashboard");
    S.preds = (S.dash.predictions || []).slice();
    S.preds.forEach((r) => S.byCode.set(r.code, r));
    // 指数(日経平均・TOPIX・米国株・VIX・金利・為替)。チャートでは "@N225" のように @ を付けたコードで扱う
    S.indexPages = (await SRData.fs("index-pages").catch(() => ({ pages: [] })))?.pages || [];
    S.idxById = new Map(S.indexPages.map((p) => [p.id, p]));
    [S.catalog, S.inventory] = await Promise.all([SRData.fs("field-catalog").catch(() => ({})), SRData.fs("data-inventory").catch(() => ({}))]);
    SRData.fs("evidence").then((x) => { S.evidence = x; if (S.set.bottomTab === "profile") renderBottom(); }).catch(() => { S.evidence = null; });
    $("#asOf").textContent = S.dash.asOf ? `${String(S.dash.asOf).slice(0, 16).replace("T", " ")} 時点のデータ` : "";
    document.body.classList.remove("loading");
    buildToolbar(); bindChartUi(); bindLegend(); bindModals(); bindSearch(); bindWatch(); bindSidebar(); renderWatch();
    window.addEventListener("hashchange", route);
    route();
  }

  // =====================================================================
  // 画面の切り替え
  // =====================================================================
  function route() {
    const h = location.hash.replace(/^#/, "");
    const [view, arg] = h.split("/");
    const v = ["chart", "rank", "macro", "archive", "settings", "about"].includes(view) ? view : "chart";
    S.view = v;
    $$(".view").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === v));
    document.body.dataset.view = v; document.body.classList.remove("menu-open");
    if (v === "chart") {
      const known = (c) => S.byCode.has(c) || (c?.startsWith("@") && S.idxById.has(c.slice(1)));
      const code = arg && known(decodeURIComponent(arg)) ? decodeURIComponent(arg) : S.code || LS.get("stockrank-last", null) || (S.byCode.has("7203") ? "7203" : S.preds[0]?.code);
      if (code && code !== S.code) loadSymbol(code);
      if (!arg && code) history.replaceState(null, "", `#chart/${code}`);
    }
    if (v === "rank") renderRank();
    if (v === "macro") renderMacro();
    if (v === "archive") renderArchive();
    if (v === "settings") renderSettings();
  }
  const goChart = (code) => { location.hash = `#chart/${code}`; };

  // ---------- 銘柄検索(上部) ----------
  function candidates(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    const idx = S.indexPages.filter((p) => `${p.id} ${p.symbol} ${p.name}`.toLowerCase().includes(q)).map((p) => ({ code: `@${p.id}`, name: p.name, industry: p.kind }));
    return [...idx, ...S.preds.filter((r) => r.code.toLowerCase().startsWith(q) || (r.name || "").toLowerCase().includes(q))].slice(0, 12);
  }
  function bindSearch() {
    const input = $("#symSearch"), box = $("#symResults");
    const render = () => {
      const list = candidates(input.value);
      box.hidden = !list.length;
      box.innerHTML = list.map((r, i) => `<button type="button" data-code="${esc(r.code)}" class="${i === 0 ? "sel" : ""}"><b>${esc(r.code)}</b><span>${esc(r.name)}</span><small>${esc(r.industry || "")}</small></button>`).join("");
    };
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const c = candidates(input.value)[0]; if (c) { goChart(c.code); input.value = ""; box.hidden = true; input.blur(); } }
      if (e.key === "Escape") { box.hidden = true; input.blur(); }
    });
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-code]"); if (!b) return; goChart(b.dataset.code); input.value = ""; box.hidden = true; });
    document.addEventListener("click", (e) => { if (!e.target.closest(".global-search")) box.hidden = true; });
    // TradingView のように、チャート上で英数字を打つと検索欄へ
    document.addEventListener("keydown", (e) => {
      if (S.view === "chart" || e.ctrlKey || e.metaKey || e.altKey || /input|select|textarea/i.test(document.activeElement?.tagName || "")) return;
      if (e.key === "/") { e.preventDefault(); input.focus(); }
    });
    // スマホ: サイドバーを引き出す
    $("#mobileMenu").addEventListener("click", (e) => { e.stopPropagation(); document.body.classList.toggle("menu-open"); });
    document.addEventListener("click", (e) => { if (document.body.classList.contains("menu-open") && !e.target.closest(".sidebar")) document.body.classList.remove("menu-open"); });
  }

  // ---------- サイドバー(Claude のように閉じる/開く。Ctrl+B) ----------
  function setSidebar(open) {
    document.documentElement.classList.toggle("sidebar-closed", !open);
    try { localStorage.setItem("stockrank-sidebar", open ? "open" : "closed"); } catch { /* */ }
    // チャートの幅が変わるので、アニメーションの後に合わせ直す(autoSize が追従するが、凡例の位置も更新)
    setTimeout(() => requestAnimationFrame(renderPaneLegends), 260);
  }
  function bindSidebar() {
    $("#sidebarClose").addEventListener("click", () => setSidebar(false));
    $("#sidebarOpen").addEventListener("click", () => setSidebar(true));
    document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); setSidebar(document.documentElement.classList.contains("sidebar-closed")); } });
  }

  // テーマ(Future Sight と同じ 4 種・同じ保存先)
  const THEMES = [["light", "Light", "明るい標準"], ["dark", "Dark", "暗い背景(ダークモード)"], ["prototype", "Prototype", "セピアと歯車の背景"], ["earth", "Earth", "夜の地球の背景"]];
  function setTheme(theme) {
    const t = THEMES.some(([k]) => k === theme) ? theme : "light";
    document.documentElement.dataset.fsTheme = t;
    try { localStorage.setItem("future-sight-theme", t); } catch { /* 保存できない環境でも表示は続ける */ }
    requestAnimationFrame(() => { applyChartTheme(); if (S.cur) renderChart(true); rankChart?.applyOptions(chartTheme()); macroChart?.applyOptions(chartTheme()); });
  }

  // =====================================================================
  // 設定
  // =====================================================================
  function renderSettings() {
    const body = $("#settingsBody"); if (!body) return;
    const theme = document.documentElement.dataset.fsTheme || "light";
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`).join("");
    const checks = (list, on, attr) => list.map(([k, l]) => `<label class="check"><input type="checkbox" data-${attr}="${k}" ${on.includes(k) ? "checked" : ""}> ${esc(l)}</label>`).join("");
    body.innerHTML = `
      <section class="panel settings"><h3>表示テーマ</h3><p class="foot">Future Sight と同じ 4 種類。同じ github.io なら Future Sight と共通です。</p>
        <div class="theme-cards">${THEMES.map(([k, l, d]) => `<button type="button" class="theme-card ${k === theme ? "active" : ""}" data-set-theme="${k}"><span class="swatch sw-${k}"><i></i><i></i><i></i></span><b>${l}</b><small>${d}</small></button>`).join("")}</div></section>
      <section class="panel settings"><h3>チャートの既定</h3>
        <div class="set-grid">
          <label>足<select data-set="interval">${opt([["1d", "日足"], ["1w", "週足"], ["1mo", "月足"]], S.set.interval)}</select></label>
          <label>チャートの種類<select data-set="type">${opt(CHART_TYPES.map(([k, l]) => [k, l]), S.set.type)}</select></label>
          <label>価格軸<select data-set="scale">${opt([[0, "通常"], [1, "対数"], [2, "%"]], S.set.scale)}</select></label>
          <label>ウォッチリストの並び順<select data-set="watchSort">${opt([["rank", "売買代金順"], ["chg", "前日比"], ["code", "コード"]], S.set.watchSort)}</select></label>
        </div>
        <h4>インジケーター</h4><div class="check-grid">${checks(IND_MENU, S.set.ind, "set-ind")}</div>
        <h4>サブチャート</h4><div class="check-grid">${checks(PANE_MENU, S.set.panes, "set-pane")}</div></section>
      <section class="panel settings"><h3>信用残</h3>
        <div class="set-grid"><label>推定評価損益率の計算方法<select data-set="creditMethod">${opt([["fifo6m", "先入れ先出し+6か月期日(既定)"], ["avg", "移動平均法"]], S.set.creditMethod)}</select></label></div>
        <p class="foot">計算方法の違いは「使い方」を参照。ランキングの計算方法もここに合わせます。</p></section>
      <section class="panel settings"><h3>この端末に保存したもの</h3>
        <div class="set-actions">
          <button type="button" class="btn" data-reset="favs">お気に入りを消す(${S.favs.size}件)</button>
          <button type="button" class="btn" data-reset="drawings">チャートの描画を全部消す</button>
          <button type="button" class="btn" data-reset="settings">設定を初期値に戻す</button>
          <button type="button" class="btn danger" data-reset="key">保存したパスワードを消して閉じる</button>
        </div>
        <p class="foot">データの配信元: ${esc(SRData.base || "—")} · データの時点: ${esc(String(S.dash?.asOf || "—"))}</p></section>`;
    $$("[data-set-theme]", body).forEach((b) => b.addEventListener("click", () => { setTheme(b.dataset.setTheme); renderSettings(); }));
    $$("[data-set]", body).forEach((el) => el.addEventListener("change", () => {
      const k = el.dataset.set; S.set[k] = k === "scale" ? Number(el.value) : el.value; saveSettings(); afterSettings();
      if (k === "creditMethod" && S.cur && !S.cur.isIndex) computeEst(S.cur);
      if (k === "creditMethod" && S.rank) { const m = $("#rankMethod"); if (m) m.value = el.value; S.rank = computeRank(S.rankData); }
      toast("保存しました");
    }));
    $$("[data-set-ind]", body).forEach((el) => el.addEventListener("change", () => { const k = el.dataset.setInd; S.set.ind = el.checked ? [...new Set([...S.set.ind, k])] : S.set.ind.filter((x) => x !== k); saveSettings(); afterSettings(); }));
    $$("[data-set-pane]", body).forEach((el) => el.addEventListener("change", () => { const k = el.dataset.setPane; S.set.panes = el.checked ? PANE_MENU.map(([x]) => x).filter((x) => x === k || S.set.panes.includes(x)) : S.set.panes.filter((x) => x !== k); saveSettings(); afterSettings(); }));
    $$("[data-reset]", body).forEach((b) => b.addEventListener("click", () => {
      const what = b.dataset.reset;
      if (what === "favs") { S.favs.clear(); LS.set("stockrank-favs", []); renderWatch(); }
      if (what === "drawings") { try { Object.keys(localStorage).filter((k) => k.startsWith("stockrank-draw-")).forEach((k) => localStorage.removeItem(k)); } catch { /* */ } S.drawings = { h: [], t: [] }; }
      if (what === "settings") { S.set = { ...DEFAULTS }; saveSettings(); afterSettings(); }
      if (what === "key") { if (!confirm("この端末に保存したパスワード(復号の鍵)を消して、ページを閉じた状態に戻します。よろしいですか?")) return; SRData.forget(); location.reload(); return; }
      toast("消しました"); renderSettings();
    }));
  }
  // 設定を変えたら、チャートのツールバーと表示に反映する
  function afterSettings() { buildToolbar(); if (S.cur) renderChart(false); renderWatch(); }

  // =====================================================================
  // ウォッチリスト(右)
  // =====================================================================
  function renderWatch() {
    const list = $("#watchList"); if (!list) return;
    const q = ($("#watchFilter").value || "").trim().toLowerCase();
    const idxRows = S.indexPages.map((p) => ({ code: `@${p.id}`, name: p.name, close: p.stats?.last, change1d: p.stats?.chg1d, rank: 0, isIndex: true }));
    if (S.set.watch === "idx") {
      $$("[data-watch]").forEach((b) => b.classList.toggle("active", b.dataset.watch === "idx"));
      list.innerHTML = idxRows.map((r) => `<button type="button" class="watch-row ${r.code === S.code ? "active" : ""}" data-code="${esc(r.code)}"><span class="ws"><b>${esc(r.name)}</b><small>${esc(S.idxById.get(r.code.slice(1))?.symbol || "")}</small></span><span class="wl">${fmtPrice(r.close)}</span><span class="wc ${cls(r.change1d)}">${pct(r.change1d, 2)}</span></button>`).join("") || '<p class="muted pad">指数のデータがありません。</p>';
      return;
    }
    let rows = [...(S.set.watch === "fav" ? idxRows.filter((r) => S.favs.has(r.code)) : []), ...S.preds].filter((r) => (S.set.watch !== "fav" || S.favs.has(r.code)) && (!q || r.code.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)));
    const sorters = { rank: (a, b) => (a.rank || 1e9) - (b.rank || 1e9), chg: (a, b) => (num(b.change1d) ?? -9) - (num(a.change1d) ?? -9), code: (a, b) => a.code.localeCompare(b.code) };
    rows.sort(sorters[S.set.watchSort] || sorters.rank);
    $$("[data-watch]").forEach((b) => b.classList.toggle("active", b.dataset.watch === S.set.watch));
    $("#watchSort").value = S.set.watchSort;
    list.innerHTML = rows.slice(0, 500).map((r) => `<button type="button" class="watch-row ${r.code === S.code ? "active" : ""}" data-code="${esc(r.code)}"><span class="ws"><i class="star ${S.favs.has(r.code) ? "on" : ""}" data-fav="${esc(r.code)}" title="お気に入り">★</i><b>${esc(r.code)}</b><small>${esc(r.name || "")}</small></span><span class="wl">${fmtPrice(r.close)}</span><span class="wc ${cls(r.change1d)}">${pct(r.change1d, 2)}</span></button>`).join("") || `<p class="muted pad">${S.set.watch === "fav" ? "★ を押した銘柄がここに並びます。" : "該当なし"}</p>`;
  }
  function bindWatch() {
    $("#watchList").addEventListener("click", (e) => {
      const fav = e.target.closest("[data-fav]");
      if (fav) { e.stopPropagation(); const c = fav.dataset.fav; if (S.favs.has(c)) S.favs.delete(c); else S.favs.add(c); LS.set("stockrank-favs", [...S.favs]); renderWatch(); return; }
      const b = e.target.closest("[data-code]"); if (b) goChart(b.dataset.code);
    });
    $$("[data-watch]").forEach((b) => b.addEventListener("click", () => { S.set.watch = b.dataset.watch; saveSettings(); renderWatch(); }));
    $("#watchSort").addEventListener("change", (e) => { S.set.watchSort = e.target.value; saveSettings(); renderWatch(); });
    $("#watchFilter").addEventListener("input", renderWatch);
    // ↑↓ で前後の銘柄
    document.addEventListener("keydown", (e) => {
      if (S.view !== "chart" || !["ArrowUp", "ArrowDown"].includes(e.key) || /input|select|textarea/i.test(document.activeElement?.tagName || "")) return;
      const rows = $$("#watchList [data-code]"); const i = rows.findIndex((b) => b.dataset.code === S.code); const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) { e.preventDefault(); goChart(next.dataset.code); next.scrollIntoView({ block: "nearest" }); }
    });
  }

  // =====================================================================
  // 銘柄の読み込み
  // =====================================================================
  // 信用残を日付でつなぐ。同じ日付があれば stockAI(〜2026-09 週次・以降 JPX 日次)> 株探保存 > IRBANK保存 の順に採る。
  //   株探保存 = 毎週の定期取得(これからの本線)、IRBANK保存 = 使えなくなる前に一度だけ取った古い履歴
  const ARCHIVE_SOURCES = [["kabutan", "株探保存"], ["irbank", "IRBANK保存"]];
  // 既知の公表ミス。この日の値は計算(推定評価損益率・チャート・合計)から外し、表には注記して残す
  const CREDIT_ERRATA = { "2026-10-20": "JPX の公表ミス(買残・売残とも誤り。計算から除外)" };
  const dropErrata = (rows) => (rows || []).filter((r) => !CREDIT_ERRATA[r?.date]);
  function mergeCredit(base, archives) {
    return SRCredit.mergeSources([[base, (r) => r.source || (r.date >= "2026-09-25" ? "JPX" : "stockAI")], ...ARCHIVE_SOURCES.map(([k, label]) => [archives?.[k]?.margin, label])]);
  }
  function priceRowsForCredit(cur) {
    const first = cur.daily[0]?.d || "9999";
    return [...cur.weekly.filter((r) => r.d < first), ...cur.daily];
  }
  function computeEst(cur) {
    const all = mergeCredit(cur.detail?.credit, cur.archives);
    cur.errata = all.filter((r) => CREDIT_ERRATA[r.date]);
    cur.credit = dropErrata(all);
    cur.est = SRCredit.estimateCredit(cur.credit, priceRowsForCredit(cur), cur.splits, { method: S.set.creditMethod });
  }

  async function loadSymbol(code) {
    if (code.startsWith("@")) return loadIndex(code);
    S.code = code; LS.set("stockrank-last", code);
    const row = S.byCode.get(code);
    $("#tvSymbol").innerHTML = `<b>${esc(code)}</b> ${esc(row?.name || "")}`;
    document.title = `${code} ${row?.name || ""} · Stock Rank`;
    $$("#watchList .watch-row").forEach((b) => b.classList.toggle("active", b.dataset.code === code));
    $("#tvLegend").innerHTML = '<span class="muted">読み込み中…</span>';
    const [doc, detail, kabutan, irbank] = await Promise.all([
      SRData.chartDoc(code).catch((e) => { console.warn(e); return null; }),
      SRData.detailDoc(code).catch((e) => { console.warn(e); return null; }),
      SRData.own(`kabutan/stocks/${code}`).catch(() => null),
      SRData.own(`irbank/stocks/${code}`).catch(() => null),
    ]);
    if (S.code !== code) return; // 読み込み中に別銘柄へ移った
    const dec = SRData.decodeChart(doc);
    S.cur = { code, row, ...dec, detail, archives: { kabutan, irbank } };
    S.compare = S.compare.filter((c) => c.code !== code);
    S.drawings = loadDrawings(code); undoStack = []; redoStack = [];
    S.pending = null;
    computeEst(S.cur);
    renderChart(false);
    renderSymCard();
    renderBottom();
  }

  // ---------- 指数 ----------
  // 市場の信用残: 株探・IRBANK から保存した東証全体の値があればそれを、無ければ stockAI の対象銘柄(約400)の合計を使う
  async function marketCredit() {
    if (!S.market) S.market = await SRData.fs("market").catch(() => ({}));
    if (!S.marketSaved) {
      const [kabutan, irbank] = await Promise.all(ARCHIVE_SOURCES.map(([k]) => SRData.own(`${k}/market`).catch(() => null)));
      S.marketSaved = { kabutan, irbank };
    }
    const whole = SRCredit.mergeSources(ARCHIVE_SOURCES.map(([k, label]) => [S.marketSaved[k]?.margin, `${label}(東証全体)`]));
    // 合計に入った銘柄数が少ない日(取得漏れ)は、合計が不連続に落ちるので除く
    const maxN = Math.max(0, ...[...(S.market.credit || []), ...(S.market.creditDaily || [])].map((r) => num(r.n) || 0));
    const full = (rows) => dropErrata(rows).filter((r) => !maxN || (num(r.n) || 0) >= maxN * 0.9);
    const agg = SRCredit.mergeSources([[full(S.market.creditDaily), "stockAI 対象銘柄合計(日次)"], [full(S.market.credit), "stockAI 対象銘柄合計(週次)"]]);
    return whole.length >= 4 ? { rows: whole, label: "東証全体(株探・IRBANK 保存)", agg } : { rows: agg, label: `stockAI 対象銘柄の合計(${S.market.credit?.at(-1)?.n || "約400"}銘柄)`, agg };
  }
  // 指数の信用残は株数だけを扱う(指数の値 × 株数 は金額にならないので、金額・評価損益率は出さない)
  function creditRowsOnly(rows) {
    let prev = null;
    return rows.map((r) => { const o = { date: r.date, buy: r.buy, sell: r.sell, ratio: r.ratio ?? (r.buy && r.sell ? r.buy / r.sell : null), buyChg: prev && r.buy !== null && prev.buy !== null ? r.buy - prev.buy : null, sellChg: prev && r.sell !== null && prev.sell !== null ? r.sell - prev.sell : null, source: r.source, warmup: false, buyAmount: null, sellAmount: null, buyPnl: null, sellPnl: null, buyAvgPrice: null, priceFactor: 1 }; prev = o; return o; });
  }
  async function loadIndex(code) {
    S.code = code; LS.set("stockrank-last", code);
    const p = S.idxById.get(code.slice(1)); if (!p) return;
    $("#tvSymbol").innerHTML = `<b>${esc(p.name)}</b> ${esc(p.symbol)}`;
    document.title = `${p.name} · Stock Rank`;
    $$("#watchList .watch-row").forEach((b) => b.classList.toggle("active", b.dataset.code === code));
    const daily = (p.points || []).map((a) => ({ d: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] }));
    const jp = p.tz === "JP" || ["N225", "TPX"].includes(p.id);
    const mc = jp ? await marketCredit() : { rows: [], label: "", agg: [] };
    if (S.code !== code) return;
    const est = { method: "", unadjusted: false, rows: creditRowsOnly(mc.rows), warmupEnd: null };
    S.cur = { code, isIndex: true, idx: p, row: { name: p.name, market: p.kind, close: p.stats?.last, change1d: p.stats?.chg1d }, daily, weekly: [], splits: [], detail: null, archives: {}, credit: mc.rows, creditLabel: mc.label, creditAgg: mc.agg, est };
    S.compare = S.compare.filter((c) => c.code !== code);
    S.drawings = loadDrawings(code); undoStack = []; redoStack = [];
    S.pending = null;
    renderChart(false); renderSymCard(); renderBottom();
  }

  // =====================================================================
  // チャート(Lightweight Charts)
  // =====================================================================
  let chart = null; let mainSeries = null; let overlay = []; let paneSeries = [];
  function chartTheme() {
    return {
      layout: { background: { type: "solid", color: css("--tv-bg") }, textColor: css("--tv-text"), fontFamily: "-apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif", fontSize: 11, panes: { separatorColor: css("--tv-border"), separatorHoverColor: css("--tv-hover"), enableResize: true } },
      grid: { vertLines: { color: css("--tv-grid") }, horzLines: { color: css("--tv-grid") } },
      rightPriceScale: { borderColor: css("--tv-border") }, timeScale: { borderColor: css("--tv-border") },
      crosshair: { vertLine: { color: css("--tv-cross"), labelBackgroundColor: css("--tv-label") }, horzLine: { color: css("--tv-cross"), labelBackgroundColor: css("--tv-label") } },
    };
  }
  function ensureChart() {
    if (chart) return chart;
    chart = LW.createChart($("#tvChart"), {
      autoSize: true, ...chartTheme(),
      crosshair: { ...chartTheme().crosshair, mode: S.set.magnet ? LW.CrosshairMode.Magnet : LW.CrosshairMode.Normal },
      timeScale: { ...chartTheme().timeScale, rightOffset: 6, barSpacing: 7, minBarSpacing: 0.5 },
      localization: { locale: "ja-JP", dateFormat: "yyyy/MM/dd" },
    });
    chart.subscribeCrosshairMove(onCrosshair);
    new ResizeObserver(() => requestAnimationFrame(renderPaneLegends)).observe($("#tvChart"));
    chart.subscribeClick(onChartClick);
    return chart;
  }
  function applyChartTheme() { chart?.applyOptions(chartTheme()); }
  const UP = () => css("--tv-up"), DOWN = () => css("--tv-down");
  const alpha = (hex, a) => { const m = hex.match(/^#([0-9a-f]{6})$/i); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const lineOpts = (color, extra = {}) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });

  const IND_MENU = [["ma5", "移動平均 5"], ["ma25", "移動平均 25"], ["ma75", "移動平均 75"], ["ma200", "移動平均 200"], ["bb", "ボリンジャーバンド 20, 2σ"], ["ichimoku", "一目均衡表"], ["vol", "出来高"], ["avgcost", "信用買い方の推定平均取得単価"], ["earnings", "決算発表日(「決」印)"]];
  const PANE_MENU = [["credit", "信用残(買残・売残)"], ["ratio", "信用倍率"], ["pnl", "推定 信用評価損益率"], ["amount", "信用残の金額"], ["rsi", "RSI 14"], ["macd", "MACD 12, 26, 9"], ["stoch", "ストキャスティクス 14, 3"]];
  const IND_COLORS = { ma5: "#2962ff", ma25: "#ff9800", ma75: "#ab47bc", ma200: "#26a69a", bb: "#2962ff", ichimoku: "#e91e63", vol: "#26a69a", avgcost: "#ef5350", earnings: "#f7a600" };
  const COMPARE_COLORS = ["#ff9800", "#ab47bc", "#00bcd4", "#e91e63"];
  const CHART_TYPES = [["candle", "ローソク足", "▮"], ["hollow", "中空ローソク足", "▯"], ["ha", "平均足", "▮"], ["bar", "バー", "⫶"], ["line", "ライン", "╱"], ["area", "エリア", "◺"], ["baseline", "ベースライン", "⫠"]];
  let compareSeries = []; let drawLayer = null;
  S.compare = [];

  // ---------- ツールバー ----------
  function buildToolbar() {
    const menu = $("#tvTypeMenu");
    menu.innerHTML = CHART_TYPES.map(([k, l, ic]) => `<button type="button" data-type="${k}"><i>${ic}</i>${l}</button>`).join("");
    syncToolbar();
  }
  function syncToolbar() {
    const t = CHART_TYPES.find(([k]) => k === S.set.type) || CHART_TYPES[0];
    $("#tvTypeBtn").innerHTML = `<i>${t[2]}</i> ${t[1]} ▾`;
    $$("[data-type]").forEach((b) => b.classList.toggle("active", b.dataset.type === S.set.type));
    $$("[data-interval]").forEach((b) => b.classList.toggle("active", b.dataset.interval === S.set.interval));
    $$("[data-scale]").forEach((b) => b.classList.toggle("active", Number(b.dataset.scale) === (S.compare.length ? 2 : S.set.scale)));
    $$("[data-toggle='magnet']").forEach((b) => b.classList.toggle("active", !!S.set.magnet));
    $$("[data-toggle='hide']").forEach((b) => b.classList.toggle("active", !!S.set.hideDrawings));
    $("#tvUndo").disabled = !undoStack.length; $("#tvRedo").disabled = !redoStack.length;
    const side = S.set.sideOpen !== false, bottom = S.set.bottomOpen !== false;
    $(".tvview")?.classList.toggle("side-closed", !side); $(".tvview")?.classList.toggle("bottom-closed", !bottom);
    $$("[data-rail='watch']").forEach((b) => b.classList.toggle("active", side)); $$("[data-rail='bottom']").forEach((b) => b.classList.toggle("active", bottom));
    $("#tvBottomToggle").textContent = bottom ? "▾" : "▴";
    $(".tvview")?.style.setProperty("--bottom-h", `${S.set.bottomH || 300}px`);
  }
  function bindChartUi() {
    const rerender = (keep = true) => { saveSettings(); if (S.cur) renderChart(keep); };
    $$("[data-interval]").forEach((b) => b.addEventListener("click", () => { S.set.interval = b.dataset.interval; rerender(false); }));
    $$("[data-scale]").forEach((b) => b.addEventListener("click", () => { if (S.compare.length) { toast("比較中は % 表示です(比較を外すと戻ります)"); return; } S.set.scale = Number(b.dataset.scale); saveSettings(); chart?.priceScale("right", 0).applyOptions({ mode: S.set.scale }); syncToolbar(); }));
    // 種類のドロップダウン
    const menu = $("#tvTypeMenu");
    $("#tvTypeBtn").addEventListener("click", (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menu.style.left = `${r.left}px`; menu.style.top = `${r.bottom}px`; menu.hidden = !menu.hidden; });
    menu.addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (!b) return; S.set.type = b.dataset.type; menu.hidden = true; rerender(); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".tv-dd")) menu.hidden = true; });
    $("#tvIndBtn").addEventListener("click", openIndModal);
    $("#tvSymbol").addEventListener("click", () => openSymModal("go"));
    $("#tvCompare").addEventListener("click", () => openSymModal("compare"));
    $("#tvUndo").addEventListener("click", undo); $("#tvRedo").addEventListener("click", redo);
    $("#tvFit").addEventListener("click", () => chart?.timeScale().fitContent());
    $("#tvShot").addEventListener("click", () => { if (!chart) return; const c = chart.takeScreenshot(true); c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${S.code.replace("@", "")}_${S.set.interval}.png`; a.click(); }); });
    $("#tvFull").addEventListener("click", () => { const el = $(".tvview"); if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => el.classList.toggle("pseudo-full")); });
    // 描画ツール
    $$("[data-tool]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.tool === "clear") { if (!S.drawings.length) return; pushUndo(); S.drawings.length = 0; saveDrawings(); setTool("cursor"); toast("この銘柄の描画を消しました(Ctrl+Z で戻せます)"); return; }
      setTool(S.tool === b.dataset.tool && b.dataset.tool !== "cursor" ? "cursor" : b.dataset.tool);
    }));
    $$("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.toggle === "magnet") { S.set.magnet = !S.set.magnet; chart?.applyOptions({ crosshair: { mode: S.set.magnet ? LW.CrosshairMode.Magnet : LW.CrosshairMode.Normal } }); }
      if (b.dataset.toggle === "hide") { S.set.hideDrawings = !S.set.hideDrawings; if (drawLayer) { drawLayer.hidden = S.set.hideDrawings; drawLayer.update(); } }
      saveSettings(); syncToolbar();
    }));
    // 期間・日付へ移動
    $$("[data-range]").forEach((b) => b.addEventListener("click", () => setRange(b.dataset.range)));
    $("#tvGoto").addEventListener("change", (e) => goToDate(e.target.value));
    // 右のパネル・下のパネル
    $$("[data-rail]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.rail;
      if (k === "watch") S.set.sideOpen = S.set.sideOpen === false;
      if (k === "detail") { S.set.sideOpen = true; requestAnimationFrame(() => $("#symCard")?.scrollIntoView({ block: "start", behavior: "smooth" })); }
      if (k === "bottom") S.set.bottomOpen = S.set.bottomOpen === false;
      saveSettings(); syncToolbar();
    }));
    $("#tvBottomToggle").addEventListener("click", () => { S.set.bottomOpen = S.set.bottomOpen === false; saveSettings(); syncToolbar(); });
    // 下のパネルの高さをドラッグで変える
    const handle = $("#tvBottomResize");
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault(); handle.setPointerCapture(e.pointerId); const y0 = e.clientY, h0 = S.set.bottomOpen === false ? 0 : (S.set.bottomH || 300);
      const move = (ev) => { const h = Math.max(120, Math.min(window.innerHeight * 0.7, h0 + (y0 - ev.clientY))); S.set.bottomH = Math.round(h); S.set.bottomOpen = true; syncToolbar(); };
      const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); saveSettings(); };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
    });
    // 時計(東京)
    const tick = () => { const c = $("#tvClock"); if (c) c.textContent = `${new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" })} (UTC+9)`; };
    tick(); setInterval(tick, 1000);
    bindChartKeys();
  }

  // ---------- キーボード(TradingView と同じ割り当て) ----------
  function bindChartKeys() {
    document.addEventListener("keydown", (e) => {
      if (S.view !== "chart" || !S.cur) return;
      const typing = /input|select|textarea/i.test(document.activeElement?.tagName || "");
      if ($(".modal:not([hidden])")) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y" && !typing) { e.preventDefault(); redo(); return; }
      if (typing || e.ctrlKey || e.metaKey) return;
      if (e.altKey) {
        const map = { t: "trend", h: "hline", j: "ray", v: "vline", f: "fib", r: null };
        if (k === "r") { e.preventDefault(); chart?.timeScale().resetTimeScale(); chart?.priceScale("right", 0).applyOptions({ autoScale: true }); renderChart(false); return; }
        if (map[k]) { e.preventDefault(); setTool(map[k]); }
        return;
      }
      if (e.key === "Escape") { if (S.tool !== "cursor" || S.pending) setTool("cursor"); else if (drawLayer && drawLayer.selected >= 0) { drawLayer.selected = -1; drawLayer.update(); } return; }
      if ((e.key === "Delete" || e.key === "Backspace") && drawLayer && drawLayer.selected >= 0) { e.preventDefault(); pushUndo(); S.drawings.splice(drawLayer.selected, 1); drawLayer.selected = -1; saveDrawings(); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const ts = chart.timeScale(); const r = ts.getVisibleLogicalRange(); if (!r) return; const d = Math.max(1, Math.round((r.to - r.from) / 8)) * (e.key === "ArrowLeft" ? -1 : 1); ts.setVisibleLogicalRange({ from: r.from + d, to: r.to + d }); return; }
      if (e.key === "+" || e.key === "-") { const ts = chart.timeScale(); const r = ts.getVisibleLogicalRange(); if (!r) return; const c = r.to, w = (r.to - r.from) * (e.key === "+" ? 0.8 : 1.25); ts.setVisibleLogicalRange({ from: c - w, to: c }); return; }
      if (e.key === "/") { e.preventDefault(); openIndModal(); return; }
      if (/^[0-9a-zA-Z]$/.test(e.key) || /[^\x00-\x7f]/.test(e.key)) { e.preventDefault(); openSymModal("go", e.key); }
    });
  }

  // ---------- 期間 ----------
  function setRange(key) {
    const bars = S.bars || []; if (!bars.length || !chart) return;
    if (key === "ALL") { chart.timeScale().fitContent(); return; }
    const last = bars.at(-1).end; const t = new Date(`${last}T00:00:00Z`);
    if (key === "YTD") t.setUTCMonth(0, 1); else { const m = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60 }[key]; t.setUTCMonth(t.getUTCMonth() - m); }
    const from = Math.max(0, barIndexAt(bars, t.toISOString().slice(0, 10)));
    chart.timeScale().setVisibleLogicalRange({ from, to: bars.length - 1 + 4 });
  }
  function goToDate(d) {
    const bars = S.bars || []; if (!d || !bars.length) return;
    const i = Math.max(0, barIndexAt(bars, d)); const r = chart.timeScale().getVisibleLogicalRange(); const w = r ? r.to - r.from : 120;
    chart.timeScale().setVisibleLogicalRange({ from: i - w / 2, to: i + w / 2 });
  }

  // ---------- 描画ツール ----------
  const TOOL_HINT = { trend: "トレンドライン: 始点をクリック", ray: "水平レイ: 始点をクリック", hline: "水平線: 価格をクリック", vline: "垂直線: 日付をクリック", fib: "フィボナッチ: 高値(または安値)をクリック", rect: "長方形: 角をクリック", measure: "計測: 始点をクリック", text: "テキスト: 置く場所をクリック" };
  let undoStack = [], redoStack = [];
  function pushUndo() { undoStack.push(JSON.stringify(S.drawings)); if (undoStack.length > 50) undoStack.shift(); redoStack = []; syncToolbar(); }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(S.drawings)); const prev = JSON.parse(undoStack.pop()); S.drawings.splice(0, S.drawings.length, ...prev); saveDrawings(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(S.drawings)); const next = JSON.parse(redoStack.pop()); S.drawings.splice(0, S.drawings.length, ...next); saveDrawings(); }
  function setTool(t) {
    S.tool = t; S.pending = null; if (drawLayer) { drawLayer.preview = null; drawLayer.update(); }
    $$("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    $("#tvChart").classList.toggle("drawing", t !== "cursor");
    const hint = $("#tvHint"); hint.hidden = t === "cursor"; hint.textContent = `${TOOL_HINT[t] || ""}(Esc で中止)`;
  }
  // 古い形式({h:[価格], t:[{a,b}]})の描画を読み替える
  function loadDrawings(code) {
    const v2 = LS.get(`stockrank-draw2-${code}`, null); if (Array.isArray(v2)) return v2;
    const old = LS.get(`stockrank-draw-${code}`, null); const out = [];
    (old?.h || []).forEach((p) => out.push({ type: "hline", a: { t: S.bars?.at(-1)?.time || "2026-01-01", p } }));
    (old?.t || []).forEach((d) => out.push({ type: "trend", a: { t: d.a.time, p: d.a.price }, b: { t: d.b.time, p: d.b.price } }));
    return out;
  }
  function saveDrawings() { LS.set(`stockrank-draw2-${S.code}`, S.drawings); if (drawLayer) { drawLayer.items = S.drawings; drawLayer.update(); } syncToolbar(); }
  // 表示中の足(週足・月足は time=期間の最初の取引日)
  function barIndexAt(rows, date) { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].start <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
  // 日付 → 足の位置(未来は 1 足ぶんの日数で概算)
  function dateToLogical(d) {
    const bars = S.bars || []; if (!bars.length) return null;
    const last = bars.at(-1);
    if (d <= last.end) { const i = barIndexAt(bars, d); return i < 0 ? 0 : i; }
    const days = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${last.end}T00:00:00Z`)) / 864e5;
    return bars.length - 1 + days / ({ "1d": 7 / 5, "1w": 7, "1mo": 30.4 }[S.set.interval] || 1.4);
  }
  function dateToX(d) { const l = dateToLogical(d); return l === null || !chart ? null : chart.timeScale().logicalToCoordinate(l); }
  function logicalToDate(l) {
    const bars = S.bars || []; if (!bars.length) return null; const i = Math.round(l);
    if (i <= bars.length - 1) return bars[Math.max(0, i)].time;
    const extra = i - (bars.length - 1); const t = new Date(`${bars.at(-1).end}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + Math.round(extra * ({ "1d": 7 / 5, "1w": 7, "1mo": 30.4 }[S.set.interval] || 1.4)));
    return t.toISOString().slice(0, 10);
  }
  function barsBetween(a, b) { const x = dateToLogical(a), y = dateToLogical(b); return x === null || y === null ? null : Math.round(Math.abs(y - x)); }
  // クリック位置 → {t: 日付, p: 価格}。マグネットなら一番近い OHLC に吸着
  function anchorFrom(param) {
    if (!param.point || !mainSeries) return null;
    const l = chart.timeScale().coordinateToLogical(param.point.x); if (l === null) return null;
    let p = mainSeries.coordinateToPrice(param.point.y); if (p === null) return null;
    const t = logicalToDate(l);
    if (S.set.magnet) { const bar = S.bars[Math.round(l)]; if (bar) p = [bar.o, bar.h, bar.l, bar.c].reduce((best, v) => (Math.abs(v - p) < Math.abs(best - p) ? v : best), bar.c); }
    return { t, p };
  }
  function onChartClick(param) {
    if (!mainSeries || !drawLayer) return;
    if (param.paneIndex && param.paneIndex !== 0) return;
    const a = anchorFrom(param); if (!a) return;
    const tool = param.sourceEvent?.shiftKey && S.tool === "cursor" ? "measure" : S.tool;
    if (tool === "cursor") { const i = drawLayer.hitTest2(param.point.x, param.point.y); drawLayer.selected = i; drawLayer.update(); return; }
    const need = SRDraw.POINTS[tool] || 1;
    if (need === 1 || S.pending) {
      const item = need === 1 ? { type: tool, a } : { type: tool, a: S.pending, b: a };
      if (tool === "text") { const text = prompt("テキスト"); if (!text) { setTool("cursor"); return; } item.text = text; }
      if (tool === "measure") { drawLayer.preview = item; S.pending = null; drawLayer.update(); if (S.tool === "measure") setTool("cursor"); drawLayer.preview = item; drawLayer.update(); return; }
      pushUndo(); S.drawings.push(item); drawLayer.selected = S.drawings.length - 1; saveDrawings(); setTool("cursor");
      return;
    }
    S.pending = a; $("#tvHint").textContent = "終点をクリック(Esc で中止)";
  }
  function onCrosshairDraw(param) {
    if (!drawLayer || !S.pending || !param.point) return;
    const b = anchorFrom(param); if (!b) return;
    const tool = S.tool === "cursor" ? "measure" : S.tool;
    drawLayer.preview = { type: tool, a: S.pending, b }; drawLayer.update();
  }
  // 信用残の観測日を、その日を含む足に載せる(同じ足に複数あれば最後の観測)
  function creditOnBars(est, rows) {
    const map = new Map(); const lastEnd = rows.at(-1)?.end;
    est.rows.forEach((r) => { if (!lastEnd || r.date > lastEnd && S.set.interval === "1d") return; const i = barIndexAt(rows, r.date); if (i >= 0) map.set(rows[i].time, r); });
    return [...map.entries()].map(([time, r]) => ({ time, r }));
  }
  function futureTimes(interval, last, until) {
    const out = []; let d = last; let guard = 0;
    while (guard++ < 400) {
      const t = new Date(`${d}T00:00:00Z`);
      if (interval === "1d") { do t.setUTCDate(t.getUTCDate() + 1); while ([0, 6].includes(t.getUTCDay())); }
      else if (interval === "1w") t.setUTCDate(t.getUTCDate() + 7);
      else { t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(1); }
      d = t.toISOString().slice(0, 10); out.push(d);
      if (d >= until) break;
    }
    return out;
  }

  function renderChart(keepRange) {
    const cur = S.cur; if (!cur) return;
    ensureChart();
    const range = keepRange ? chart.timeScale().getVisibleLogicalRange() : null;
    [mainSeries, ...overlay, ...paneSeries, ...compareSeries].forEach((s) => { if (s) try { chart.removeSeries(s); } catch { /* */ } });
    overlay = []; paneSeries = []; compareSeries = []; mainSeries = null; S.legendSeries = [];
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
    const interval = S.set.interval;
    const bars = SRInd.aggregate(cur.daily, cur.weekly, interval);
    S.bars = bars; S.barByTime = new Map(bars.map((r, i) => [r.time, i]));
    if (!bars.length) { $("#tvLegend").innerHTML = '<span class="muted">価格データがありません</span>'; return; }
    const shown = S.set.type === "ha" ? SRInd.heikinAshi(bars) : bars;
    const last = bars.at(-1);
    const dec = Math.abs(last.c) >= 1000 ? 0 : Math.abs(last.c) >= 100 ? 1 : 2;
    const priceFormat = { type: "price", precision: dec, minMove: 1 / 10 ** dec };
    const up = UP(), down = DOWN();
    // 主系列
    const t = S.set.type;
    if (t === "hollow") { mainSeries = chart.addSeries(LW.CandlestickSeries, { upColor: "rgba(0,0,0,0)", downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, open: r.o, high: r.h, low: r.l, close: r.c }))); }
    else if (t === "baseline") { const base = shown.at(Math.max(0, shown.length - 120))?.c ?? last.c; mainSeries = chart.addSeries(LW.BaselineSeries, { baseValue: { type: "price", price: base }, topLineColor: up, bottomLineColor: down, topFillColor1: alpha(up, 0.28), topFillColor2: alpha(up, 0.05), bottomFillColor1: alpha(down, 0.05), bottomFillColor2: alpha(down, 0.28), lineWidth: 2, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, value: r.c }))); }
    else if (t === "line") { mainSeries = chart.addSeries(LW.LineSeries, { color: css("--accent"), lineWidth: 2, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, value: r.c }))); }
    else if (t === "area") { mainSeries = chart.addSeries(LW.AreaSeries, { lineColor: css("--accent"), topColor: alpha(css("--accent"), 0.35), bottomColor: alpha(css("--accent"), 0.02), lineWidth: 2, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, value: r.c }))); }
    else if (t === "bar") { mainSeries = chart.addSeries(LW.BarSeries, { upColor: up, downColor: down, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, open: r.o, high: r.h, low: r.l, close: r.c }))); }
    else { mainSeries = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, open: r.o, high: r.h, low: r.l, close: r.c }))); }
    const hidden = new Set(S.set.hiddenInd || []);
    chart.priceScale("right", 0).applyOptions({ mode: S.compare.length ? LW.PriceScaleMode.Percentage : S.set.scale, scaleMargins: { top: 0.08, bottom: S.set.ind.includes("vol") && !hidden.has("vol") ? 0.2 : 0.06 } });
    // 描画(トレンドライン・水平線など)は主系列に付けたプリミティブで描く
    drawLayer = drawLayer || new SRDraw.DrawingLayer({ toX: dateToX, toY: (p) => mainSeries?.priceToCoordinate(p) ?? null, fmt: fmtPrice, color: () => css("--draw"), bars: barsBetween });
    mainSeries.attachPrimitive(drawLayer); drawLayer.items = S.drawings; drawLayer.hidden = !!S.set.hideDrawings; drawLayer.selected = -1; drawLayer.preview = null;

    const closes = bars.map((r) => r.c);
    const addLine = (values, color, extra, pane = 0) => { const s = chart.addSeries(LW.LineSeries, lineOpts(color, { priceFormat, ...extra }), pane); s.setData(bars.map((r, i) => (Number.isFinite(values[i]) ? { time: r.time, value: values[i] } : { time: r.time }))); (pane ? paneSeries : overlay).push(s); return s; };
    const ind = S.set.ind.filter((k) => !hidden.has(k));
    if (ind.includes("vol")) {
      const v = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      v.setData(bars.map((r) => ({ time: r.time, value: r.v || 0, color: alpha(r.c >= r.o ? up : down, 0.45) }))); overlay.push(v); S.volSeries = v;
    }
    ["ma5", "ma25", "ma75", "ma200"].forEach((k) => { if (ind.includes(k)) addLine(SRInd.sma(closes, Number(k.slice(2))), IND_COLORS[k], { title: "" }); });
    if (ind.includes("bb")) { const b = SRInd.bollinger(closes); const c = css("--bb"); addLine(b.up, c); addLine(b.mid, alpha(c, 0.6), { lineStyle: LW.LineStyle.Dashed }); addLine(b.lo, c); }
    if (ind.includes("ichimoku")) {
      const k = SRInd.ichimoku(bars); const shift = 26; const n = bars.length;
      addLine(k.tenkan, "#e91e63"); addLine(k.kijun, "#1e88e5");
      const fut = (() => { const out = []; let d = last.time; for (let i = 0; i < shift; i++) { const f = futureTimes(interval, d, "0000")[0]; out.push(f); d = f; } return out; })();
      const spanData = (vals) => { const pts = []; for (let i = 0; i < n; i++) { if (!Number.isFinite(vals[i])) continue; const j = i + shift; const time = j < n ? bars[j].time : fut[j - n]; if (time) pts.push({ time, value: vals[i] }); } return pts; };
      [[k.spanA, "#43a047"], [k.spanB, "#ef5350"]].forEach(([vals, c]) => { const s = chart.addSeries(LW.LineSeries, lineOpts(alpha(c, 0.8), { priceFormat })); s.setData(spanData(vals)); overlay.push(s); });
      const ch = chart.addSeries(LW.LineSeries, lineOpts(alpha("#9e9e9e", 0.8), { priceFormat })); ch.setData(bars.slice(shift).map((r, i) => ({ time: bars[i].time, value: r.c }))); overlay.push(ch);
    }
    // 比較(他の銘柄・指数を % で重ねる。価格軸は % 表示になる)
    S.compare.forEach((c, k) => {
      if (!c.bars) return;
      const cb2 = SRInd.aggregate(c.bars, [], interval).filter((r) => r.time >= bars[0].time);
      const s = chart.addSeries(LW.LineSeries, { color: COMPARE_COLORS[k % COMPARE_COLORS.length], lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: c.label });
      s.setData(cb2.map((r) => ({ time: r.time, value: r.c }))); compareSeries.push(s);
    });
    // 信用残を足に載せる
    const cb = creditOnBars(cur.est, bars);
    if (ind.includes("avgcost") && cb.length) {
      const s = chart.addSeries(LW.LineSeries, lineOpts(css("--credit-buy"), { lineStyle: LW.LineStyle.Dotted, lineWidth: 2, lineType: LW.LineType.WithSteps, priceFormat, lastValueVisible: true, title: "買い方平均" }));
      s.setData(cb.filter((x) => num(x.r.buyAvgPrice) !== null && !x.r.warmup).map((x) => ({ time: x.time, value: x.r.buyAvgPrice })));
      overlay.push(s);
    }
    // 決算発表日(株探の決算・stockAI の決算発表)をローソク足の下に印で出す
    if (ind.includes("earnings")) {
      const marks = new Map();
      earningsEvents(cur.detail).forEach((e) => { const i = barIndexAt(bars, e.date); if (i < 0 || e.date > last.end) return; marks.set(bars[i].time, e); });
      if (marks.size) LW.createSeriesMarkers(mainSeries, [...marks.entries()].sort().map(([time, e]) => ({ time, position: "belowBar", color: css("--warn"), shape: "arrowUp", text: "決", size: 0.6, id: e.date })));
      S.earnMarks = marks;
    } else S.earnMarks = new Map();
    // サブチャート
    let pane = 0; const paneKinds = [];
    const addPaneLine = (p, data, color, extra = {}) => { const s = chart.addSeries(LW.LineSeries, lineOpts(color, { lineWidth: 1.5, lastValueVisible: true, ...extra }), p); s.setData(data); paneSeries.push(s); return s; };
    const pctFmt = { type: "custom", formatter: (v) => `${(v).toFixed(1)}%`, minMove: 0.1 };
    for (const k of S.set.panes) {
      if (["credit", "ratio", "pnl", "amount"].includes(k) && !cb.length) continue;
      if (cur.isIndex && ["pnl", "amount"].includes(k)) continue;
      pane++; paneKinds.push(k);
      if (k === "rsi") { const s = addPaneLine(pane, bars.map((r, i) => { const v = SRInd.rsi(closes)[i]; return Number.isFinite(v) ? { time: r.time, value: v } : { time: r.time }; }), "#7e57c2", { title: "RSI" }); [30, 70].forEach((lv) => s.createPriceLine({ price: lv, color: css("--tv-grid2"), lineStyle: LW.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })); }
      if (k === "macd") {
        const m = SRInd.macd(closes);
        const hs = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        hs.setData(bars.map((r, i) => (Number.isFinite(m.hist[i]) ? { time: r.time, value: m.hist[i], color: alpha(m.hist[i] >= 0 ? up : down, 0.6) } : { time: r.time }))); paneSeries.push(hs);
        addPaneLine(pane, bars.map((r, i) => (Number.isFinite(m.line[i]) ? { time: r.time, value: m.line[i] } : { time: r.time })), "#2962ff", { title: "MACD" });
        addPaneLine(pane, bars.map((r, i) => (Number.isFinite(m.signal[i]) ? { time: r.time, value: m.signal[i] } : { time: r.time })), "#ff6d00", { title: "Signal" });
      }
      if (k === "stoch") { const st = SRInd.stochastic(bars); const s = addPaneLine(pane, bars.map((r, i) => (Number.isFinite(st.k[i]) ? { time: r.time, value: st.k[i] } : { time: r.time })), "#2962ff", { title: "%K" }); addPaneLine(pane, bars.map((r, i) => (Number.isFinite(st.d[i]) ? { time: r.time, value: st.d[i] } : { time: r.time })), "#ff6d00", { title: "%D" }); [20, 80].forEach((lv) => s.createPriceLine({ price: lv, color: css("--tv-grid2"), lineStyle: LW.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })); }
      if (k === "credit") {
        const shareFmt = { type: "volume" };
        addPaneLine(pane, cb.filter((x) => num(x.r.buy) !== null).map((x) => ({ time: x.time, value: x.r.buy })), css("--credit-buy"), { title: "買残", priceFormat: shareFmt, lineType: LW.LineType.WithSteps });
        addPaneLine(pane, cb.filter((x) => num(x.r.sell) !== null).map((x) => ({ time: x.time, value: x.r.sell })), css("--credit-sell"), { title: "売残", priceFormat: shareFmt, lineType: LW.LineType.WithSteps });
      }
      if (k === "ratio") { const s = addPaneLine(pane, cb.filter((x) => num(x.r.ratio) !== null).map((x) => ({ time: x.time, value: x.r.ratio })), "#ffb300", { title: "信用倍率", lineType: LW.LineType.WithSteps, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); s.createPriceLine({ price: 1, color: css("--tv-grid2"), lineStyle: LW.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "1倍" }); }
      if (k === "pnl") {
        const s = addPaneLine(pane, cb.filter((x) => num(x.r.buyPnl) !== null).map((x) => ({ time: x.time, value: x.r.buyPnl * 100, color: x.r.warmup ? alpha(css("--credit-buy"), 0.3) : undefined })), css("--credit-buy"), { title: "買い方", priceFormat: pctFmt });
        addPaneLine(pane, cb.filter((x) => num(x.r.sellPnl) !== null).map((x) => ({ time: x.time, value: x.r.sellPnl * 100 })), css("--credit-sell"), { title: "売り方", priceFormat: pctFmt });
        s.createPriceLine({ price: 0, color: css("--tv-grid2"), lineWidth: 1, axisLabelVisible: false });
        [-20, -10].forEach((lv) => s.createPriceLine({ price: lv, color: alpha(css("--down"), 0.35), lineStyle: LW.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: `${lv}%` }));
      }
      if (k === "amount") {
        const okuFmt = { type: "custom", formatter: (v) => `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}億`, minMove: 0.1 };
        addPaneLine(pane, cb.filter((x) => num(x.r.buyAmount) !== null).map((x) => ({ time: x.time, value: x.r.buyAmount / 1e8 })), css("--credit-buy"), { title: "買残金額", priceFormat: okuFmt, lineType: LW.LineType.WithSteps });
        addPaneLine(pane, cb.filter((x) => num(x.r.sellAmount) !== null).map((x) => ({ time: x.time, value: x.r.sellAmount / 1e8 })), css("--credit-sell"), { title: "売残金額", priceFormat: okuFmt, lineType: LW.LineType.WithSteps });
      }
    }
    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(3, (panes.length - 1) * 1.1) : 1));
    $("#tvChart").dataset.panes = String(panes.length);
    S.paneKinds = paneKinds;
    syncToolbar();
    if (range) chart.timeScale().setVisibleLogicalRange(range);
    else {
      const n = bars.length; const show = { "1d": 160, "1w": 156, "1mo": 120 }[interval];
      const extra = 6;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - show), to: n + extra });
    }
    renderLegend(null);
    requestAnimationFrame(renderPaneLegends);
  }

  // ---------- 凡例(左上: 銘柄と OHLC、指標ごとの行。TradingView のように 👁 と ✕) ----------
  function indValues(i) {
    const bars = S.bars; const key = `${S.code}${S.set.interval}${bars.length}`;
    if (S.legendCache?.key !== key) { const closes = bars.map((b) => b.c); const bb = SRInd.bollinger(closes); S.legendCache = { key, ...Object.fromEntries(["ma5", "ma25", "ma75", "ma200"].map((m) => [m, SRInd.sma(closes, Number(m.slice(2)))])), bb }; }
    const c = S.legendCache;
    return { ma5: fmtPrice(c.ma5[i]), ma25: fmtPrice(c.ma25[i]), ma75: fmtPrice(c.ma75[i]), ma200: fmtPrice(c.ma200[i]), bb: `${fmtPrice(c.bb.up[i])} ${fmtPrice(c.bb.mid[i])} ${fmtPrice(c.bb.lo[i])}`, vol: vol(bars[i]?.v) };
  }
  function renderLegend(time) {
    const bars = S.bars || []; if (!bars.length) return;
    let i = time ? S.barByTime.get(time) : bars.length - 1; if (i === undefined) i = bars.length - 1;
    const r = bars[i], p = bars[i - 1];
    const chg = p ? r.c - p.c : null, ch = p ? r.c / p.c - 1 : null; const k = cls(chg);
    const row = S.cur.row;
    const iv = { "1d": "1日", "1w": "1週", "1mo": "1か月" }[S.set.interval];
    const hidden = new Set(S.set.hiddenInd || []); const vals = indValues(i);
    const indRows = S.set.ind.map((key) => {
      const label = (IND_MENU.find(([x]) => x === key) || [key, key])[1].replace("移動平均 ", "MA ").replace("ボリンジャーバンド 20, 2σ", "BB 20 2");
      const v = vals[key] ? ` <b style="color:${IND_COLORS[key]}">${vals[key]}</b>` : "";
      return `<div class="lg-ind ${hidden.has(key) ? "off" : ""}"><span>${esc(label)}</span>${hidden.has(key) ? "" : v}<span class="lg-btns"><button type="button" data-lg-eye="${key}" title="表示/非表示">👁</button><button type="button" data-lg-del="${key}" title="外す">✕</button></span></div>`;
    }).join("");
    const cmp = S.compare.map((c, n) => { const rr = c.bars ? c.bars.filter((b) => b.d <= r.end).at(-1) : null; return `<div class="lg-ind"><span style="color:${COMPARE_COLORS[n % COMPARE_COLORS.length]}">● ${esc(c.label)}</span> <b>${rr ? fmtPrice(rr.c) : "—"}</b><span class="lg-btns"><button type="button" data-lg-cmp="${n}" title="比較を外す">✕</button></span></div>`; }).join("");
    // その足の時点の最新の信用残
    let cr = null; for (const x of S.cur.est.rows) { if (x.date <= r.end) cr = x; else break; }
    const crLine = cr && S.cur.isIndex ? `<div class="lg-line lg-credit"><em>信用残 ${esc(S.cur.creditLabel)} ${esc(cr.date)}</em> <span>買残 <b class="cb">${fmt(cr.buy)}</b></span> <span>売残 <b class="cs">${fmt(cr.sell)}</b></span> <span>倍率 <b>${fmt(cr.ratio, 2)}</b></span></div>` : cr ? `<div class="lg-line lg-credit"><em>信用 ${esc(cr.date)}</em> <span>買残 <b class="cb">${fmt(cr.buy)}</b></span> <span>売残 <b class="cs">${fmt(cr.sell)}</b></span> <span>倍率 <b>${fmt(cr.ratio, 2)}</b></span> <span>買残金額 <b>${oku(cr.buyAmount)}</b></span> <span>推定損益 買 <b class="${cls(cr.buyPnl)}">${pct(cr.buyPnl)}</b> / 売 <b class="${cls(cr.sellPnl)}">${pct(cr.sellPnl)}</b>${cr.warmup ? ' <small title="履歴の最初の半年は推定が不安定">(参考)</small>' : ""}</span></div>` : "";
    const ev = S.earnMarks?.get(r.time);
    const evLine = ev ? `<div class="lg-line lg-earn"><em>決算発表 ${esc(ev.date)}</em> <b>${esc(ev.period || "")}</b>${ev.sales !== null && ev.sales !== undefined ? ` <span>売上高 ${mil(ev.sales)}</span>` : ""}${ev.op !== null && ev.op !== undefined ? ` <span>営業利益 ${mil(ev.op)}${ev.opYoy !== null && ev.opYoy !== undefined ? `(${pct(ev.opYoy)})` : ""}</span>` : ""}${ev.react5 !== null && ev.react5 !== undefined ? ` <span>発表後5日 <b class="${cls(ev.react5)}">${pct(ev.react5)}</b></span>` : ""}</div>` : "";
    const title = S.cur.isIndex ? `${esc(S.cur.idx.name)} · ${iv} · ${esc(S.cur.idx.symbol)}` : `${esc(row?.name || "")} · ${iv} · 東証`;
    $("#tvLegend").innerHTML = `<div class="lg-line lg-head"><strong>${title}</strong> <span>始<b class="${k}">${fmtPrice(r.o)}</b></span><span>高<b class="${k}">${fmtPrice(r.h)}</b></span><span>安<b class="${k}">${fmtPrice(r.l)}</b></span><span>終<b class="${k}">${fmtPrice(r.c)}</b></span>${chg === null ? "" : `<b class="${k}">${chg >= 0 ? "+" : ""}${fmtPrice(chg)} (${pct(ch, 2)})</b>`} <small>${esc(r.start === r.end ? r.start : `${r.start}〜${r.end}`)}</small></div>${indRows}${cmp}${evLine}${crLine}`;
  }
  // 凡例のボタン(👁 / ✕)
  function bindLegend() {
    $("#tvLegend").addEventListener("click", (e) => {
      const eye = e.target.closest("[data-lg-eye]"), del = e.target.closest("[data-lg-del]"), cmp = e.target.closest("[data-lg-cmp]");
      if (eye) { const k = eye.dataset.lgEye; const h = new Set(S.set.hiddenInd || []); h.has(k) ? h.delete(k) : h.add(k); S.set.hiddenInd = [...h]; }
      else if (del) { S.set.ind = S.set.ind.filter((x) => x !== del.dataset.lgDel); }
      else if (cmp) { S.compare.splice(Number(cmp.dataset.lgCmp), 1); }
      else return;
      saveSettings(); renderChart(true);
    });
    $("#tvPaneLegends").addEventListener("click", (e) => {
      const del = e.target.closest("[data-pane-del]"); if (!del) return;
      S.set.panes = S.set.panes.filter((x) => x !== del.dataset.paneDel); saveSettings(); renderChart(true);
    });
  }
  // サブチャートの左上に名前(TradingView と同じ位置)。各段の高さから位置を出す
  function renderPaneLegends() {
    const box = $("#tvPaneLegends"); if (!box || !chart) return;
    const panes = chart.panes(); let y = 0; const out = [];
    const label = (k) => (PANE_MENU.find(([x]) => x === k) || [k, k])[1];
    panes.forEach((p, i) => { if (i > 0) out.push(`<div class="pane-lg" style="top:${y + 4}px"><span>${esc(label(S.paneKinds?.[i - 1]))}</span><button type="button" data-pane-del="${S.paneKinds?.[i - 1]}" title="外す">✕</button></div>`); y += p.getHeight() + 1; });
    box.innerHTML = out.join("");
  }
  function onCrosshair(param) { if (!S.cur) return; renderLegend(param?.time !== undefined ? timeKey(param.time) : null); onCrosshairDraw(param); }

  // ---------- 銘柄検索・比較(TradingView のダイアログ) ----------
  let symModalMode = "go", symSel = 0, symKind = "all";
  function openSymModal(mode, first = "") {
    symModalMode = mode; symSel = 0;
    $("#symModalTitle").textContent = mode === "compare" ? "比較する銘柄・指数を追加" : "銘柄・指数を検索";
    const m = $("#symModal"); m.hidden = false; const input = $("#symModalInput"); input.value = first; input.focus(); drawSymList();
  }
  function closeModals() { $$(".modal").forEach((m) => { m.hidden = true; }); }
  function symList() {
    const q = $("#symModalInput").value.trim().toLowerCase();
    const idx = S.indexPages.map((p) => ({ code: `@${p.id}`, name: p.name, sub: p.symbol, kind: "index", close: p.stats?.last, chg: p.stats?.chg1d }));
    const st = S.preds.map((r) => ({ code: r.code, name: r.name, sub: r.industry || "", kind: "stock", close: r.close, chg: r.change1d }));
    return [...idx, ...st].filter((x) => (symKind === "all" || x.kind === symKind) && (!q || x.code.toLowerCase().replace("@", "").startsWith(q) || `${x.name} ${x.sub}`.toLowerCase().includes(q))).slice(0, 80);
  }
  function drawSymList() {
    const list = symList(); symSel = Math.min(symSel, Math.max(0, list.length - 1));
    $$("[data-symkind]").forEach((b) => b.classList.toggle("active", b.dataset.symkind === symKind));
    $("#symModalList").innerHTML = list.map((x, i) => `<button type="button" class="sym-row ${i === symSel ? "sel" : ""}" data-pick="${esc(x.code)}"><b>${esc(x.code.replace("@", ""))}</b><span>${esc(x.name)}<small>${esc(x.sub)}</small></span><em class="kind ${x.kind}">${x.kind === "index" ? "指数" : "株式"}</em><span class="num">${fmtPrice(x.close)}</span><span class="num ${cls(x.chg)}">${pct(x.chg, 2)}</span></button>`).join("") || '<p class="muted pad">見つかりません</p>';
    $("#symModalList .sel")?.scrollIntoView({ block: "nearest" });
  }
  async function pickSymbol(code) {
    closeModals();
    if (symModalMode === "go") { goChart(code); return; }
    if (S.compare.some((c) => c.code === code) || code === S.code) return;
    let bars = null, label = code;
    if (code.startsWith("@")) { const p = S.idxById.get(code.slice(1)); bars = (p?.points || []).map((a) => ({ d: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })); label = p?.name || code; }
    else { const dec = SRData.decodeChart(await SRData.chartDoc(code).catch(() => null)); const first = dec.daily[0]?.d || "9999"; bars = [...dec.weekly.filter((r) => r.d < first), ...dec.daily]; label = `${code} ${S.byCode.get(code)?.name || ""}`; }
    S.compare.push({ code, label, bars }); renderChart(true); toast(`${label} を比較に追加しました(価格軸は % 表示)`);
  }
  // ---------- インジケーターのダイアログ ----------
  function openIndModal() { const m = $("#indModal"); m.hidden = false; const input = $("#indModalInput"); input.value = ""; input.focus(); drawIndList(); }
  function drawIndList() {
    const q = $("#indModalInput").value.trim().toLowerCase();
    const groups = [["チャートに重ねる", IND_MENU, "ind"], ["サブチャート(下に段を追加)", PANE_MENU, "pane"]];
    $("#indModalList").innerHTML = groups.map(([g, list, kind]) => { const items = list.filter(([, l]) => !q || l.toLowerCase().includes(q)); if (!items.length) return ""; return `<h4>${g}</h4>${items.map(([k, l]) => { const on = (kind === "ind" ? S.set.ind : S.set.panes).includes(k); return `<button type="button" class="ind-row ${on ? "on" : ""}" data-ind-pick="${kind}:${k}"><span class="chk">${on ? "✓" : ""}</span>${esc(l)}</button>`; }).join("")}`; }).join("") || '<p class="muted pad">見つかりません</p>';
  }
  function bindModals() {
    $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModals(); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $(".modal:not([hidden])")) { e.stopPropagation(); closeModals(); } }, true);
    const input = $("#symModalInput");
    input.addEventListener("input", () => { symSel = 0; drawSymList(); });
    input.addEventListener("keydown", (e) => {
      const list = symList();
      if (e.key === "ArrowDown") { e.preventDefault(); symSel = Math.min(list.length - 1, symSel + 1); drawSymList(); }
      if (e.key === "ArrowUp") { e.preventDefault(); symSel = Math.max(0, symSel - 1); drawSymList(); }
      if (e.key === "Enter" && list[symSel]) { e.preventDefault(); pickSymbol(list[symSel].code); }
    });
    $("#symModalList").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) pickSymbol(b.dataset.pick); });
    $$("[data-symkind]").forEach((b) => b.addEventListener("click", () => { symKind = b.dataset.symkind; drawSymList(); input.focus(); }));
    $("#indModalInput").addEventListener("input", drawIndList);
    $("#indModalList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ind-pick]"); if (!b) return; const [kind, k] = b.dataset.indPick.split(":");
      if (kind === "ind") S.set.ind = S.set.ind.includes(k) ? S.set.ind.filter((x) => x !== k) : [...S.set.ind, k];
      else S.set.panes = S.set.panes.includes(k) ? S.set.panes.filter((x) => x !== k) : PANE_MENU.map(([x]) => x).filter((x) => x === k || S.set.panes.includes(x));
      saveSettings(); drawIndList(); if (S.cur) renderChart(true);
    });
  }

  // =====================================================================
  // 銘柄カード(右下)
  // =====================================================================
  function renderSymCard() {
    const cur = S.cur; const box = $("#symCard"); if (!cur || !box) return;
    if (cur.isIndex) {
      const p = cur.idx, st = p.stats || {}, cr = cur.est.rows.at(-1);
      box.innerHTML = `<div class="sc-head"><div><b>${esc(p.name)}</b><small>${esc(p.symbol)} · ${esc(p.kind || "")}</small></div><button type="button" class="star-btn ${S.favs.has(cur.code) ? "on" : ""}" data-fav-card title="お気に入り">★</button></div>
        <div class="sc-price"><strong>${fmtPrice(st.last)}</strong><span class="${cls(st.chg1d)}">${pct(st.chg1d, 2)}</span><small>${esc(st.date || "")}</small></div>
        <dl class="sc-kv"><div><dt>20日</dt><dd class="${cls(st.chg20d)}">${pct(st.chg20d)}</dd></div><div><dt>年初来</dt><dd class="${cls(st.chgYtd)}">${pct(st.chgYtd)}</dd></div>
        <div><dt>52週高値から</dt><dd class="${cls(st.fromHigh52)}">${pct(st.fromHigh52)}</dd></div><div><dt>RSI 14</dt><dd>${fmt(st.rsi14, 1)}</dd></div>
        ${cr ? `<div><dt>信用倍率</dt><dd>${fmt(cr.ratio, 2)}倍</dd></div><div><dt>買残 / 売残</dt><dd><small>${fmt(cr.buy)} / ${fmt(cr.sell)}</small></dd></div>` : ""}</dl>
        ${cr ? `<p class="foot">信用残: ${esc(cur.creditLabel)}(${esc(cr.date)})</p>` : ""}`;
      $("[data-fav-card]", box).addEventListener("click", () => { const c = cur.code; if (S.favs.has(c)) S.favs.delete(c); else S.favs.add(c); LS.set("stockrank-favs", [...S.favs]); renderSymCard(); renderWatch(); });
      return;
    }
    const r = cur.row || {}; const last = cur.daily.at(-1) || {}; const prev = cur.daily.at(-2) || {};
    const chg = last.c != null && prev.c != null ? last.c - prev.c : null;
    const sec = cur.detail?.irbank?.security || {};
    const cr = cur.est.rows.at(-1);
    const shares = num(sec.issued_shares);
    const d = cur.detail || {}; const { rows: annual, forecast } = mergedAnnual(d); const lastA = annual.at(-1);
    const bal = (d.kabutan?.balance || []).filter((b) => num(b.bps) !== null).at(-1); const price = last.c ?? r.close;
    const ratio = (a, b) => { const x = num(a), y = num(b); return x === null || y === null || y <= 0 ? null : x / y; };
    const dps = num(forecast?.dps) ?? num(lastA?.dps); const lastEv = earningsEvents(d).at(-1);
    box.innerHTML = `<div class="sc-head"><div><b>${esc(r.name || cur.code)}</b><small>${esc(cur.code)} · ${esc(r.market || sec.market || "")} · ${esc(r.industry || sec.industry || "")}</small></div><button type="button" class="star-btn ${S.favs.has(cur.code) ? "on" : ""}" data-fav-card title="お気に入り">★</button></div>
      <div class="sc-price"><strong>${fmtPrice(last.c ?? r.close)}</strong><span class="${cls(chg)}">${chg === null ? "" : `${chg >= 0 ? "+" : ""}${fmtPrice(chg)} (${pct(chg / prev.c, 2)})`}</span><small>${esc(last.d || "")}</small></div>
      <dl class="sc-kv"><div><dt>時価総額</dt><dd>${shares && last.c ? oku(shares * last.c) : "—"}</dd></div><div><dt>売買代金順位</dt><dd>${r.rank ? `#${r.rank}` : "—"}</dd></div>
      <div><dt>信用倍率</dt><dd>${cr ? `${fmt(cr.ratio, 2)}倍` : "—"}</dd></div><div><dt>買残 / 売残</dt><dd>${cr ? `${oku(cr.buyAmount)} / ${oku(cr.sellAmount)}` : "—"}</dd></div>
      <div><dt>推定 買い方損益</dt><dd class="${cr ? cls(cr.buyPnl) : ""}">${cr ? pct(cr.buyPnl) : "—"}</dd></div><div><dt>推定 売り方損益</dt><dd class="${cr ? cls(cr.sellPnl) : ""}">${cr ? pct(cr.sellPnl) : "—"}</dd></div></dl>
      <dl class="sc-kv"><div><dt>PER(会社予想)</dt><dd>${ratio(price, forecast?.eps) === null ? "—" : `${ratio(price, forecast.eps).toFixed(1)}倍`}</dd></div><div><dt>PBR(実績)</dt><dd>${ratio(price, bal?.bps) === null ? "—" : `${ratio(price, bal.bps).toFixed(2)}倍`}</dd></div>
      <div><dt>配当利回り</dt><dd>${dps !== null && price ? `${(dps / price * 100).toFixed(2)}%` : "—"}</dd></div><div><dt>1株配当</dt><dd>${dps === null ? "—" : `${fmtPrice(dps)}円${forecast ? "(予)" : ""}`}</dd></div>
      <div><dt>直近の通期</dt><dd>${lastA ? `${esc(lastA.period)} 営業益 ${mil(lastA.op)}` : "—"}</dd></div><div><dt>今期 会社予想 営業益</dt><dd>${forecast ? `${mil(forecast.op)}<small class="${cls(yoyOf(forecast.op, lastA?.op))}"> ${pct(yoyOf(forecast.op, lastA?.op))}</small>` : "—"}</dd></div>
      <div><dt>直近の決算発表</dt><dd>${lastEv ? esc(lastEv.date) : "—"}</dd></div><div><dt>&nbsp;</dt><dd><small>${lastEv ? esc(lastEv.period || "") : ""}</small></dd></div></dl>
      <p class="foot">金額は百万円。予想は会社予想(株探)。</p>
      <div class="sc-links"><a href="https://kabutan.jp/stock/?code=${esc(cur.code)}" target="_blank" rel="noopener">株探</a><a href="https://irbank.net/${esc(cur.code)}" target="_blank" rel="noopener">IRBANK</a><a href="https://www.tradingview.com/chart/?symbol=TSE%3A${esc(cur.code)}" target="_blank" rel="noopener">TradingView</a></div>`;
    $("[data-fav-card]", box).addEventListener("click", () => { const c = cur.code; if (S.favs.has(c)) S.favs.delete(c); else S.favs.add(c); LS.set("stockrank-favs", [...S.favs]); renderSymCard(); renderWatch(); });
  }

  // =====================================================================
  // 下段のタブ(信用残・株探/IRBANK の企業データ)
  // =====================================================================
  const BOTTOM_TABS = [["credit", "信用残・金額・評価損益"], ["perf", "業績"], ["quarter", "四半期"], ["fin", "財務"], ["ind", "指標"], ["val", "株価指標"], ["div", "配当"], ["seg", "セグメント"], ["peers", "競合"], ["earn", "決算発表"], ["edinet", "有報"], ["people", "人的資本"], ["profile", "会社情報"], ["saved", "株探・IRBANK 保存"]];
  function renderBottom() {
    const tabs = $("#bottomTabs"); const cur = S.cur;
    const set = cur?.isIndex ? INDEX_TABS : BOTTOM_TABS; const kind = cur?.isIndex ? "index" : "stock";
    if (tabs.dataset.built !== kind) {
      tabs.innerHTML = set.map(([k, l]) => `<button type="button" role="tab" data-btab="${k}">${l}</button>`).join("");
      if (!tabs.dataset.built) tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-btab]"); if (!b) return; if (S.cur?.isIndex) S.set.indexTab = b.dataset.btab; else S.set.bottomTab = b.dataset.btab; saveSettings(); renderBottom(); });
      tabs.dataset.built = kind;
    }
    const active = cur?.isIndex ? (INDEX_TABS.some(([k]) => k === S.set.indexTab) ? S.set.indexTab : "istats") : S.set.bottomTab;
    $$("[data-btab]").forEach((b) => b.classList.toggle("active", b.dataset.btab === active));
    const body = $("#bottomBody"); if (!cur) return;
    if (cur.isIndex) {
      try { body.innerHTML = ({ istats: tabIdxStats, mcredit: tabMarketCredit, flows: tabFlows, breadth: tabBreadth, msaved: tabMarketSaved }[active])(cur); } catch (e) { console.error(e); body.innerHTML = `<p class="muted pad">表示できませんでした: ${esc(e.message)}</p>`; }
      $$("[data-savedsrc]", body).forEach((b) => b.addEventListener("click", () => { S.savedSrc = b.dataset.savedsrc; S.irPage = null; renderBottom(); }));
      $$("[data-irpage]", body).forEach((b) => b.addEventListener("click", () => { S.irPage = b.dataset.irpage; renderBottom(); }));
      return;
    }
    const fn = { credit: tabCredit, perf: tabPerf, quarter: tabQuarter, fin: tabFin, ind: tabInd, val: tabVal, div: tabDiv, seg: tabSeg, peers: tabPeers, earn: tabEarn, edinet: tabEdinet, people: tabPeople, profile: tabProfile, saved: tabSaved }[S.set.bottomTab] || tabCredit;
    const d = cur.detail || {};
    try { body.innerHTML = fn(d, cur); } catch (e) { console.error(e); body.innerHTML = `<p class="muted pad">表示できませんでした: ${esc(e.message)}</p>`; }
    $$("[data-method]", body).forEach((b) => b.addEventListener("click", () => { S.set.creditMethod = b.dataset.method; saveSettings(); computeEst(cur); renderChart(true); renderSymCard(); renderBottom(); }));
    $$("[data-csv]", body).forEach((b) => b.addEventListener("click", () => creditCsv(cur)));
    $$("[data-group]", body).forEach((b) => b.addEventListener("click", () => { S.finGroup = b.dataset.group; renderBottom(); }));
    $$("[data-indcat]", body).forEach((b) => b.addEventListener("click", () => { S.indCat = b.dataset.indcat; renderBottom(); }));
    $$("[data-irpage]", body).forEach((b) => b.addEventListener("click", () => { S.irPage = b.dataset.irpage; renderBottom(); }));
    $$("[data-savedsrc]", body).forEach((b) => b.addEventListener("click", () => { S.savedSrc = b.dataset.savedsrc; S.irPage = null; renderBottom(); }));
    $$("[data-code]", body).forEach((b) => b.addEventListener("click", () => goChart(b.dataset.code)));
  }
  const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
  const INDEX_TABS = [["istats", "指数の統計"], ["mcredit", "市場の信用残"], ["flows", "投資部門別売買"], ["breadth", "騰落・業種"], ["msaved", "株探・IRBANK 保存(市場)"]];
  function tabIdxStats(cur) {
    const p = cur.idx; const st = p.stats || {};
    const item = (l, v, n = "") => `<div><dt>${l}</dt><dd>${v}</dd>${n ? `<small>${n}</small>` : ""}</div>`;
    const grid = `<dl class="metrics">${[
      item("終値", fmtPrice(st.last), esc(st.date || "")), item("前日比", pctCell(st.chg1d, 2)), item("5日", pctCell(st.chg5d)), item("20日", pctCell(st.chg20d)), item("60日", pctCell(st.chg60d)), item("1年(250日)", pctCell(st.chg250d)), item("年初来", pctCell(st.chgYtd)),
      item("52週高値", fmtPrice(st.high52), `高値から ${pct(st.fromHigh52)}`), item("52週安値", fmtPrice(st.low52)), item("最高値から", pctCell(st.fromPeak)), item("1年の最大下落", pctCell(st.maxDd250)),
      item("ボラティリティ 20日", pct(st.vol20).replace("+", ""), `60日 ${pct(st.vol60).replace("+", "")} · 250日 ${pct(st.vol250).replace("+", "")}`), item("ATR 14", fmtPrice(st.atr14)), item("RSI 14", fmt(st.rsi14, 1)),
      item("25日線乖離", pctCell(st.ma25dev)), item("75日線乖離", pctCell(st.ma75dev)), item("200日線乖離", pctCell(st.ma200dev)),
    ].join("")}</dl>`;
    const names = Object.fromEntries(S.indexPages.map((x) => [x.id, x.name]));
    const corr = p.corr60 ? `<div class="row-head"><h3>他の指数との相関(日次リターン)</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>相手</th>${Object.keys(p.corr60).map((k) => `<th>${esc(names[k] || k)}</th>`).join("")}</tr></thead><tbody><tr><th>60日</th>${Object.values(p.corr60).map((v) => `<td>${fmt(v, 2)}</td>`).join("")}</tr>${p.corr250 ? `<tr><th>250日</th>${Object.keys(p.corr60).map((k) => `<td>${fmt(p.corr250[k], 2)}</td>`).join("")}</tr>` : ""}</tbody></table></div>` : "";
    const seas = (p.seasonality || []).length ? `<div class="row-head"><h3>月ごとの騰落(季節性)</h3><small>2020年以降の各月の平均リターンと上昇した割合</small></div><div class="table-wrap"><table class="grid"><thead><tr><th></th>${p.seasonality.map((m) => `<th>${m.month}月</th>`).join("")}</tr></thead><tbody><tr><th>平均</th>${p.seasonality.map((m) => `<td>${pctCell(m.avg)}</td>`).join("")}</tr><tr><th>上昇した割合</th>${p.seasonality.map((m) => `<td>${num(m.win) === null ? "—" : `${Math.round(m.win * 100)}%`}</td>`).join("")}</tr><tr><th>年数</th>${p.seasonality.map((m) => `<td>${m.n ?? "—"}</td>`).join("")}</tr></tbody></table></div>` : "";
    return `<div class="row-head"><h3>${esc(p.name)}(${esc(p.symbol)})</h3><small>${esc(p.kind || "")} · 日足 ${fmt(p.points?.length)}本(${esc(p.points?.[0]?.[0] || "")}〜)</small></div>${grid}${corr}${seas}`;
  }
  function creditTable(rows, title, note) {
    if (!rows.length) return "";
    let prev = null; const list = rows.map((r) => { const o = { ...r, bc: prev && r.buy !== null && prev.buy !== null ? r.buy - prev.buy : null, sc: prev && r.sell !== null && prev.sell !== null ? r.sell - prev.sell : null }; prev = r; return o; });
    return `<div class="row-head"><h3>${esc(title)}(${rows.length}回)</h3><small>${esc(note)}</small></div><div class="table-wrap tall"><table class="grid"><thead><tr><th>申込日</th><th>売残</th><th>前回比</th><th>買残</th><th>前回比</th><th>信用倍率</th><th>出典</th></tr></thead><tbody>${list.slice().reverse().map((r) => `<tr><th>${esc(r.date)}</th><td>${fmt(r.sell)}</td><td>${diffCell(r.sc)}</td><td>${fmt(r.buy)}</td><td>${diffCell(r.bc)}</td><td>${fmt(r.ratio ?? (r.buy && r.sell ? r.buy / r.sell : null), 2)}</td><td><small>${esc(r.source || "")}</small></td></tr>`).join("")}</tbody></table></div>`;
  }
  function tabMarketCredit(cur) {
    if (!S.market) return empty("読み込み中…");
    const whole = SRCredit.mergeSources(ARCHIVE_SOURCES.map(([k, label]) => [S.marketSaved?.[k]?.margin, `${label}(東証全体)`]));
    const agg = cur.creditAgg || [];
    const last = agg.at(-1);
    const cards = last ? `<div class="cards"><article><span>買残(対象銘柄合計)</span><strong>${fmt(last.buy)}<small>株</small></strong><em>${esc(last.date)} · 4週 ${pct(SRCredit.changeOver(agg, "buy", 4))}</em></article><article><span>売残(対象銘柄合計)</span><strong>${fmt(last.sell)}<small>株</small></strong><em>4週 ${pct(SRCredit.changeOver(agg, "sell", 4))}</em></article><article><span>信用倍率(対象銘柄合計)</span><strong>${fmt(last.ratio, 2)}<small>倍</small></strong><em>${esc(String(last.n || ""))}銘柄</em></article></div>` : "";
    return `${cards}${whole.length ? creditTable(whole, "東証全体の信用残(株探・IRBANK 保存)", "取得元のページの表から取り出した値。単位は取得元のまま") : `<div class="empty">東証全体の信用残はまだ保存されていません。<br><small>「Kabutan weekly」「IRBANK archive」が、トップページの「信用残」などのリンクから市場全体のページを探して保存します。</small></div>`}
      ${creditTable(agg, "stockAI 対象銘柄(約400)の信用残の合計", `〜2026-09 は週次、2026-09-25 申込分からは JPX の日次。東証全体ではない。${Object.entries(CREDIT_ERRATA).map(([d, t]) => `${d} は ${t}`).join(" / ")}`)}
      <p class="foot">チャートの「信用残」「信用倍率」サブチャートは、${esc(cur.creditLabel || "")}の値です。指数の値 × 株数 は金額にならないため、指数では金額・評価損益率は出しません(対象銘柄合計の推定評価損益率は「ランキング・信用」ページ)。</p>`;
  }
  const FLOW_LABELS = { foreigners: "海外投資家", individuals: "個人", individuals_cash: "個人(現金)", individuals_margin: "個人(信用)", proprietary: "自己(証券会社)", trust_banks: "信託銀行", investment_trusts: "投資信託", business_cos: "事業法人", life_nonlife: "生保・損保", city_regional_banks: "都銀・地銀", total: "合計" };
  function tabFlows() {
    const f = S.market?.flows; const weeks = f?.weeks || [];
    if (!weeks.length) return empty("投資部門別売買のデータはありません。");
    const keys = Object.keys(FLOW_LABELS).filter((k) => weeks.some((w) => w[k] !== undefined));
    return `<div class="row-head"><h3>投資部門別 株式売買状況(差引き = 買い − 売り)</h3><small>${esc(f.unit || "")} · ${esc(f.source || "")}</small></div><div class="table-wrap"><table class="grid"><thead><tr><th>週</th>${keys.map((k) => `<th>${FLOW_LABELS[k]}</th>`).join("")}<th>売買代金</th><th>公表</th></tr></thead><tbody>${weeks.slice().reverse().map((w) => `<tr><th>${esc(w.weekEnd)}</th>${keys.map((k) => `<td class="${cls(w[k])}">${num(w[k]) === null ? "—" : `${w[k] >= 0 ? "+" : ""}${fmt(w[k], 0)}`}</td>`).join("")}<td>${fmt(w.totalValue)}</td><td><small>${esc(w.availableFrom || "")}</small></td></tr>`).join("")}</tbody></table></div>`;
  }
  function tabBreadth() {
    const b = S.market?.breadth; const secs = (S.market?.sectors || []).slice().sort((x, y) => (num(y.chg20d) ?? -9) - (num(x.chg20d) ?? -9));
    if (!b) return empty("騰落のデータはありません。");
    const pc = (v) => (num(v) === null ? "—" : `${Math.round(v * 100)}%`);
    return `<div class="cards"><article><span>値上がり / 値下がり</span><strong>${fmt(b.advancers)} / ${fmt(b.decliners)}</strong><em>${esc(b.date)} · ${fmt(b.n)}銘柄(stockAI 対象)</em></article><article><span>25日線より上</span><strong>${pc(b.above25)}</strong><em>75日線 ${pc(b.above75)} · 200日線 ${pc(b.above200)}</em></article><article><span>52週 高値更新 / 安値更新</span><strong>${fmt(b.newHigh52)} / ${fmt(b.newLow52)}</strong><em>20日騰落の中央値 ${pct(b.medianChg20d)}</em></article></div>
      <div class="row-head"><h3>業種別(20日騰落の順)</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>業種</th><th>銘柄数</th><th>1日</th><th>5日</th><th>20日</th><th>25日線より上</th></tr></thead><tbody>${secs.map((x) => `<tr><th>${esc(x.industry)}</th><td>${fmt(x.n)}</td><td>${pctCell(x.chg1d)}</td><td>${pctCell(x.chg5d)}</td><td>${pctCell(x.chg20d)}</td><td>${pc(x.above25)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function tabMarketSaved() {
    const saved = S.marketSaved || {};
    return tabSaved({}, { archives: saved, credit: [], code: "market" });
  }
  const seg = (items, cur, attr) => `<div class="seg">${items.map(([k, l]) => `<button type="button" data-${attr}="${esc(k)}" class="${k === cur ? "active" : ""}">${esc(l)}</button>`).join("")}</div>`;

  function tabCredit(d, cur) {
    const est = cur.est; const rows = est.rows;
    if (!rows.length) return empty("この銘柄の信用残の履歴はありません。");
    const last = rows.at(-1); const wk = (key, w) => SRCredit.changeOver(rows, key, w);
    const card = (label, value, sub, c = "") => `<article><span>${label}</span><strong class="${c}">${value}</strong><em>${sub}</em></article>`;
    const cards = `<div class="cards">
      ${card("信用倍率", `${fmt(last.ratio, 2)}<small>倍</small>`, `${esc(last.date)} 申込分`)}
      ${card("信用買残", `${fmt(last.buy)}<small>株</small>`, `金額 ${oku(last.buyAmount)}円 · 4週 ${pct(wk("buy", 4))}`)}
      ${card("信用売残", `${fmt(last.sell)}<small>株</small>`, `金額 ${oku(last.sellAmount)}円 · 4週 ${pct(wk("sell", 4))}`)}
      ${card("推定 買い方評価損益率", pct(last.buyPnl), `推定平均取得単価 ${fmtPrice(last.buyAvgPrice === null ? null : last.buyAvgPrice * last.priceFactor)}円`, cls(last.buyPnl))}
      ${card("推定 売り方評価損益率", pct(last.sellPnl), `推定平均売り単価 ${fmtPrice(last.sellAvgPrice === null ? null : last.sellAvgPrice * last.priceFactor)}円`, cls(last.sellPnl))}
      ${card("買残 ÷ 20日平均出来高", `${fmt(last.buyDays, 1)}<small>日分</small>`, `売残 ${fmt(last.sellDays, 1)}日分`)}
    </div>`;
    const methods = seg([["fifo6m", "先入れ先出し+6か月期日"], ["avg", "移動平均法"]], est.method, "method");
    const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))];
    const table = `<div class="table-wrap tall"><table class="grid"><thead><tr><th>申込日</th><th>終値</th><th>売残(株)</th><th>前回比</th><th>買残(株)</th><th>前回比</th><th>信用倍率</th><th>売残金額</th><th>買残金額</th><th>買−売 金額</th><th>推定 買い方<br>評価損益率</th><th>推定 売り方<br>評価損益率</th><th>買い方<br>推定取得単価</th><th>買残/出来高</th><th>出典</th></tr></thead><tbody>${[...rows, ...(cur.errata || []).map((r) => ({ ...r, errata: CREDIT_ERRATA[r.date] }))].sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => r.errata ? `<tr class="errata"><th>${esc(r.date)}</th><td>—</td><td>${fmt(r.sell)}</td><td>—</td><td>${fmt(r.buy)}</td><td>—</td><td>${fmt(r.ratio, 2)}</td><td colspan="7" class="left">⚠ ${esc(r.errata)}</td><td><small>${esc(r.source || "")}</small></td></tr>` : `<tr class="${r.warmup ? "warm" : ""}"><th>${esc(r.date)}</th><td>${fmtPrice(r.closeRaw)}</td><td>${fmt(r.sell)}</td><td>${diffCell(r.sellChg)}</td><td>${fmt(r.buy)}</td><td>${diffCell(r.buyChg)}</td><td>${fmt(r.ratio, 2)}</td><td>${oku(r.sellAmount)}</td><td>${oku(r.buyAmount)}</td><td class="${cls(r.netAmount)}">${oku(r.netAmount)}</td><td class="${cls(r.buyPnl)}">${pct(r.buyPnl)}</td><td class="${cls(r.sellPnl)}">${pct(r.sellPnl)}</td><td>${fmtPrice(r.buyAvgPrice === null ? null : r.buyAvgPrice * r.priceFactor)}</td><td>${fmt(r.buyDays, 1)}日</td><td><small>${esc(r.source || "")}</small></td></tr>`).join("")}</tbody></table></div>`;
    return `${cards}<div class="row-head"><h3>信用残の全履歴(${rows.length}回)</h3>${methods}<button type="button" class="btn" data-csv>CSV で保存</button></div>${table}
      <p class="foot">金額 = 残高 × 申込日の終値(実際の株価。分割前は分割前の株価)。推定評価損益率は残高の増減と期間 VWAP から取得コストを追った推定値で、薄い行は履歴の最初の半年(推定が不安定)。${est.unadjusted ? "この銘柄の信用残は株式分割で未調整と判定したので、分割比率で揃えて計算しています。" : ""}出典: ${esc(sources.join(" / "))}(〜2026-09 は週次、2026-09-25 申込分から JPX の日次)。${(cur.errata || []).length ? ` ⚠ の行は ${esc(cur.errata.map((r) => r.date).join("・"))} の公表ミスで、前回比・金額・評価損益率の計算から外しています。` : ""}</p>`;
  }
  function creditCsv(cur) {
    const head = ["申込日", "終値", "売残", "売残前回比", "買残", "買残前回比", "信用倍率", "売残金額(円)", "買残金額(円)", "推定買い方評価損益率", "推定売り方評価損益率", "買い方推定取得単価", "買残/20日出来高", "出典", "推定方法"];
    const lines = [csvLine(head), ...cur.est.rows.map((r) => csvLine([r.date, r.closeRaw, r.sell, r.sellChg, r.buy, r.buyChg, r.ratio?.toFixed(4), Math.round(r.sellAmount ?? 0), Math.round(r.buyAmount ?? 0), r.buyPnl?.toFixed(5), r.sellPnl?.toFixed(5), r.buyAvgPrice === null ? "" : (r.buyAvgPrice * r.priceFactor).toFixed(2), r.buyDays?.toFixed(2), r.source, cur.est.method]))];
    download(`${cur.code}_credit.csv`, lines.join("\n"));
  }

  // 株探の通期(百万円)に、株探に無い古い期を IRBANK(円)で補う(Future Sight と同じ)
  function mergedAnnual(d) {
    const kab = (d.kabutan?.annual || []).filter((r) => !r.forecast);
    const fc = (d.kabutan?.annual || []).filter((r) => r.forecast).at(-1);
    const seen = new Set(kab.map((r) => (r.end || "").slice(0, 7)));
    const fin = d.irbank?.fin; const rows = [];
    if (fin) (fin.periods || []).forEach((fy, i) => {
      const key = String(fy).replace("/", "-"); if (seen.has(key)) return;
      const v = (k) => fin.values?.[k]?.[i] ?? null; const m = (k) => (v(k) === null ? null : v(k) / 1e6);
      rows.push({ period: String(fy).replace("/", "."), end: `${key}-31`, sales: m("sales"), op: m("operating_profit"), ord: m("ordinary_income"), net: m("net_income"), eps: v("eps"), dps: v("dps"), source: "IRBANK" });
    });
    return { rows: [...rows, ...kab.map((r) => ({ ...r, source: "株探" }))].sort((a, b) => (a.end || "").localeCompare(b.end || "")), forecast: fc };
  }
  function tabPerf(d) {
    const { rows, forecast } = mergedAnnual(d);
    if (!rows.length) return empty("業績データはありません。");
    const list = rows.map((r, i) => ({ ...r, prev: rows[i - 1] })); if (forecast) list.push({ ...forecast, prev: rows.at(-1), isFc: true, source: "株探" });
    const margin = (r) => (num(r.sales) ? num(r.op) / num(r.sales) : null);
    return `<div class="row-head"><h3>通期業績(百万円)</h3><small>${rows.length}期 · 予=会社予想</small></div><div class="bars-row">${barSvg(rows.slice(-12).map((r) => ({ label: r.period, value: r.sales })).concat(forecast ? [{ label: `予${forecast.period}`, value: forecast.sales, fc: true }] : []), "売上高")}${barSvg(rows.slice(-12).map((r) => ({ label: r.period, value: r.op })).concat(forecast ? [{ label: `予${forecast.period}`, value: forecast.op, fc: true }] : []), "営業利益")}</div>
      <div class="table-wrap"><table class="grid"><thead><tr><th>決算期</th><th>売上高</th><th>前期比</th><th>営業利益</th><th>前期比</th><th>営業利益率</th><th>経常利益</th><th>純利益</th><th>EPS(円)</th><th>配当(円)</th><th>発表日</th><th>出典</th></tr></thead><tbody>${list.slice().reverse().map((r) => `<tr class="${r.isFc ? "fc" : ""}"><th>${r.isFc ? '<i class="tag">予</i>' : ""}${esc(r.period)}</th><td>${mil(r.sales)}</td><td>${pctCell(yoyOf(r.sales, r.prev?.sales))}</td><td class="${num(r.op) < 0 ? "down" : ""}">${mil(r.op)}</td><td>${pctCell(yoyOf(r.op, r.prev?.op))}</td><td>${margin(r) === null ? "—" : `${(margin(r) * 100).toFixed(1)}%`}</td><td>${mil(r.ord)}</td><td class="${num(r.net) < 0 ? "down" : ""}">${mil(r.net)}</td><td>${fmtPrice(r.eps)}</td><td>${fmtPrice(r.dps)}</td><td>${esc(r.announce || "—")}</td><td><small>${esc(r.source)}</small></td></tr>`).join("")}</tbody></table></div>`;
  }
  function barSvg(items, title) {
    const vals = items.map((x) => num(x.value)); const f = vals.filter((v) => v !== null); if (!f.length) return "";
    const max = Math.max(...f, 0), min = Math.min(...f, 0), span = max - min || 1; const W = 420, H = 130, T = 14, B = 18; const slot = W / items.length; const bw = Math.min(26, slot * 0.6);
    const y = (v) => T + (max - v) / span * (H - T - B);
    return `<figure class="bars"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>${items.map((it, i) => { const v = vals[i]; if (v === null) return ""; const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0))); return `<rect x="${(slot * i + slot / 2 - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${v < 0 ? "var(--down)" : "var(--accent)"}" opacity="${it.fc ? 0.4 : 0.9}"><title>${esc(it.label)} ${fmt(v)}</title></rect><text x="${(slot * i + slot / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${esc(String(it.label).replace(/^20/, ""))}</text>`; }).join("")}</svg></figure>`;
  }
  function sameQuarterLastYear(rows, r) { const end = Date.parse(r?.end || ""); if (!Number.isFinite(end)) return rows[rows.indexOf(r) - 4]; const target = end - 365 * 864e5; return rows.find((x) => Math.abs(Date.parse(x.end || "") - target) <= 20 * 864e5) || null; }
  function tabQuarter(d) {
    const q = d.kabutan?.quarter || []; if (!q.length) return empty("四半期データはありません。");
    const cum = [...(d.kabutan?.q1cum || []), ...(d.kabutan?.half || [])].filter((r) => !r.forecast).sort((a, b) => (a.end || "").localeCompare(b.end || ""));
    return `<div class="row-head"><h3>四半期業績(3か月ごと・百万円)</h3><small>${q.length}四半期</small></div><div class="bars-row">${barSvg(q.slice(-12).map((r) => ({ label: r.period, value: r.sales })), "売上高")}${barSvg(q.slice(-12).map((r) => ({ label: r.period, value: r.op })), "営業利益")}</div>
      <div class="table-wrap"><table class="grid"><thead><tr><th>四半期</th><th>売上高</th><th>前年同期比</th><th>営業利益</th><th>前年同期比</th><th>営業利益率</th><th>経常利益</th><th>純利益</th><th>EPS(円)</th><th>発表日</th></tr></thead><tbody>${q.slice().reverse().map((r) => { const y = sameQuarterLastYear(q, r); const m = num(r.sales) ? num(r.op) / num(r.sales) : null; return `<tr><th>${esc(r.period)}</th><td>${mil(r.sales)}</td><td>${pctCell(yoyOf(r.sales, y?.sales))}</td><td>${mil(r.op)}</td><td>${pctCell(yoyOf(r.op, y?.op))}</td><td>${m === null ? "—" : `${(m * 100).toFixed(1)}%`}</td><td>${mil(r.ord)}</td><td>${mil(r.net)}</td><td>${fmtPrice(r.eps)}</td><td>${esc(r.announce || "—")}</td></tr>`; }).join("")}</tbody></table></div>
      ${cum.length ? `<div class="row-head"><h3>累計(第1四半期・上期)と通期予想への進捗</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>期間</th><th>売上高</th><th>営業利益</th><th>経常利益</th><th>純利益</th><th>EPS</th><th>通期進捗</th><th>発表日</th></tr></thead><tbody>${cum.slice().reverse().map((r) => `<tr><th>${esc(r.period)}</th><td>${mil(r.sales)}</td><td>${mil(r.op)}</td><td>${mil(r.ord)}</td><td>${mil(r.net)}</td><td>${fmtPrice(r.eps)}</td><td>${num(r.progress) === null ? "—" : `${num(r.progress).toFixed(1)}%`}</td><td>${esc(r.announce || "—")}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  }
  // IRBANK の期×項目の表(field-catalog の単位で表示)
  function unitFmt(v, unit) {
    const n = num(v); if (n === null) return "—";
    switch (unit) {
      case "jpy": return Math.abs(n) >= 1e6 ? Math.round(n / 1e6).toLocaleString("ja-JP") : (n / 1e6).toFixed(2);
      case "jpy_per_share": return n.toLocaleString("ja-JP", { maximumFractionDigits: Math.abs(n) >= 100 ? 1 : 2 });
      case "ratio": case "percent": return `${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
      case "times": return `${n.toFixed(2)}倍`;
      case "people": return `${Math.round(n).toLocaleString("ja-JP")}人`;
      case "shares": return Math.abs(n) >= 1e4 ? `${Math.round(n / 1e4).toLocaleString("ja-JP")}万株` : `${n}株`;
      case "years": return `${n.toFixed(1)}年`;
      default: return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("ja-JP") : n.toLocaleString("ja-JP", { maximumFractionDigits: 3 });
    }
  }
  const unitLabel = (u) => ({ jpy: "百万円", jpy_per_share: "円", ratio: "%", percent: "%", times: "倍", people: "人", shares: "株", years: "年" }[u] || "");
  const fy = (p) => String(p || "").replace(/^20/, "").replace("/", ".");
  function periodGrid(block, keys, kind, note = "") {
    const cat = S.catalog?.[kind] || {};
    const ks = keys.filter((k) => block?.values?.[k]);
    if (!block?.periods?.length || !ks.length) return empty("この銘柄のデータはありません。");
    return `<div class="table-wrap"><table class="grid period"><thead><tr><th>項目</th>${block.periods.map((p) => `<th>${esc(fy(p))}</th>`).join("")}</tr></thead><tbody>${ks.map((k) => `<tr><th title="${esc(cat[k]?.note || k)}">${esc(cat[k]?.label || k)}${unitLabel(cat[k]?.unit) ? `<small>${unitLabel(cat[k]?.unit)}</small>` : ""}</th>${block.values[k].map((v) => `<td class="${num(v) < 0 ? "down" : ""}">${unitFmt(v, cat[k]?.unit)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${note ? `<p class="foot">${esc(note)}</p>` : ""}`;
  }
  function tabFin(d) {
    const fin = d.irbank?.fin; const groups = (S.catalog?.finGroups || []).filter((g) => g.id !== "people");
    const bal = d.kabutan?.balance || [];
    const balTable = bal.length ? `<div class="row-head"><h3>財政状態(株探・四半期末を含む)</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>期</th><th>総資産</th><th>自己資本</th><th>自己資本比率</th><th>BPS(円)</th><th>有利子負債倍率</th><th>発表日</th></tr></thead><tbody>${bal.slice().reverse().map((b) => `<tr><th>${esc(b.period)}</th><td>${mil(b.total_assets)}</td><td>${mil(b.equity)}</td><td>${num(b.equity_ratio) === null ? "—" : `${num(b.equity_ratio).toFixed(1)}%`}</td><td>${fmtPrice(b.bps)}</td><td>${num(b.debt_ratio) === null ? "—" : `${num(b.debt_ratio).toFixed(2)}倍`}</td><td>${esc(b.announce || "—")}</td></tr>`).join("")}</tbody></table></div>` : "";
    if (!fin) return balTable || empty("財務データはありません。");
    const g = groups.find((x) => x.id === (S.finGroup || "pl")) || groups[0];
    const keys = g ? g.keys : Object.keys(fin.values || {});
    return `<div class="row-head"><h3>${esc(g?.label || "財務")}(IRBANK・通期)</h3>${groups.length ? seg(groups.map((x) => [x.id, x.label]), g?.id, "group") : ""}</div>${periodGrid(fin, keys, "fin", (fin.meta || []).length ? `会計基準: ${(fin.meta || []).map((m) => `${fy(m.fy)} ${m.std || "—"}`).join(" / ")}` : "")}${balTable}`;
  }
  function tabInd(d) {
    const ind = d.irbank?.ind; if (!ind) return empty("指標データはありません。");
    const cat = S.catalog?.ind || {}; const labels = S.catalog?.indCategories || {};
    const cats = Object.keys(labels).filter((c) => c !== "valuation" && Object.keys(ind.values || {}).some((k) => cat[k]?.category === c));
    const current = cats.includes(S.indCat) ? S.indCat : cats[0];
    const keys = current ? Object.keys(ind.values).filter((k) => cat[k]?.category === current && !/_adjusted$/.test(k)) : Object.keys(ind.values);
    return `<div class="row-head"><h3>${esc(labels[current] || "指標")}(IRBANK)</h3>${cats.length ? seg(cats.map((c) => [c, labels[c]]), current, "indcat") : ""}</div>${periodGrid(ind, keys, "ind", "項目名にマウスを乗せると定義を表示。")}`;
  }
  function tabVal(d, cur) {
    const val = d.irbank?.val; const price = cur.daily.at(-1)?.c ?? cur.row?.close;
    const { rows, forecast } = mergedAnnual(d); const lastA = rows.at(-1);
    const bal = (d.kabutan?.balance || []).filter((b) => num(b.bps) !== null).at(-1);
    const ratio = (a, b) => { const x = num(a), y = num(b); return x === null || y === null || y <= 0 ? null : x / y; };
    const shares = num(d.irbank?.security?.issued_shares); const dps = num(forecast?.dps) ?? num(lastA?.dps);
    const item = (l, v, n = "") => `<div><dt>${l}</dt><dd>${v}</dd>${n ? `<small>${n}</small>` : ""}</div>`;
    const grid = `<dl class="metrics">${[
      item("株価", `${fmtPrice(price)}円`, esc(cur.daily.at(-1)?.d || "")),
      item("時価総額", shares && price ? `${oku(shares * price)}円` : "—", "発行済株式数ベース"),
      item("PER(会社予想)", ratio(price, forecast?.eps) === null ? "—" : `${ratio(price, forecast.eps).toFixed(1)}倍`, forecast ? `予想EPS ${fmtPrice(forecast.eps)}円` : "予想なし"),
      item("PER(実績)", ratio(price, lastA?.eps) === null ? "—" : `${ratio(price, lastA.eps).toFixed(1)}倍`, lastA ? `${esc(lastA.period)}` : ""),
      item("PBR(実績)", ratio(price, bal?.bps) === null ? "—" : `${ratio(price, bal.bps).toFixed(2)}倍`, bal ? `BPS ${fmtPrice(bal.bps)}円` : ""),
      item("配当利回り", dps !== null && price ? `${(dps / price * 100).toFixed(2)}%` : "—", dps === null ? "" : `${forecast ? "予想" : "実績"}配当 ${fmtPrice(dps)}円`),
      item("PER 5年平均", num(val?.per5yAvg) === null ? "—" : `${num(val.per5yAvg).toFixed(1)}倍`, "IRBANK"),
      item("信用倍率", cur.est.rows.length ? `${fmt(cur.est.rows.at(-1).ratio, 2)}倍` : "—", cur.est.rows.at(-1)?.date || ""),
    ].join("")}</dl>`;
    const keys = ["stock_price", "stock_price_high", "stock_price_low", "market_cap", "per", "per_high", "per_low", "pbr_reported", "pbr_high_reported", "pbr_low_reported", "dividend_yield_reported", "eps", "bps_reported", "roe", "shares_outstanding"];
    return `<div class="row-head"><h3>現在の株価指標</h3><small>予想は株探の会社予想</small></div>${grid}${val ? `<div class="row-head"><h3>決算期ごとのバリュエーション(IRBANK)</h3></div>${periodGrid(val, keys.filter((k) => val.values?.[k]).length ? keys : Object.keys(val.values || {}), "val")}` : ""}`;
  }
  function tabDiv(d, cur) {
    const { rows, forecast } = mergedAnnual(d); const div = d.irbank?.div || []; const price = cur.daily.at(-1)?.c;
    const list = rows.map((r, i) => ({ ...r, prev: rows[i - 1] })); if (forecast) list.push({ ...forecast, prev: rows.at(-1), isFc: true, source: "株探" });
    const lastDiv = div.at(-1) || {}; const dps = num(forecast?.dps) ?? num(rows.at(-1)?.dps);
    const cards = `<div class="cards"><article><span>1株配当(予想)</span><strong>${forecast ? fmtPrice(forecast.dps) : "—"}<small>円</small></strong><em>${esc(forecast?.period || "予想なし")}</em></article><article><span>配当利回り</span><strong>${dps !== null && price ? (dps / price * 100).toFixed(2) : "—"}<small>%</small></strong><em>配当 ÷ 終値</em></article><article><span>連続増配</span><strong>${esc(lastDiv.consecutive_dividend_increase_years ?? "—")}<small>年</small></strong><em>IRBANK</em></article><article><span>DOE</span><strong>${num(lastDiv.doe) === null ? "—" : num(lastDiv.doe).toFixed(2)}<small>%</small></strong><em>IRBANK</em></article></div>`;
    const payout = (r) => { const a = num(r.dps), b = num(r.eps); return a === null || b === null || b <= 0 ? null : a / b; };
    const table = `<div class="table-wrap"><table class="grid"><thead><tr><th>決算期</th><th>1株配当(円)</th><th>前期比</th><th>EPS(円)</th><th>配当性向</th><th>出典</th></tr></thead><tbody>${list.slice().reverse().map((r) => `<tr class="${r.isFc ? "fc" : ""}"><th>${r.isFc ? '<i class="tag">予</i>' : ""}${esc(r.period)}</th><td>${fmtPrice(r.dps)}</td><td>${pctCell(yoyOf(r.dps, r.prev?.dps))}</td><td>${fmtPrice(r.eps)}</td><td>${payout(r) === null ? "—" : `${(payout(r) * 100).toFixed(1)}%`}</td><td><small>${esc(r.source || "")}</small></td></tr>`).join("")}</tbody></table></div>`;
    const keys = div.length ? [...new Set(div.flatMap((r) => Object.keys(r)))].filter((k) => k !== "fiscal_year") : [];
    const irb = div.length ? `<div class="row-head"><h3>配当履歴(IRBANK・分割調整後)</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>年度</th>${keys.map((k) => `<th>${esc(S.catalog?.div?.[k]?.label || k)}</th>`).join("")}</tr></thead><tbody>${div.slice().reverse().map((r) => `<tr><th>${esc(r.fiscal_year)}</th>${keys.map((k) => `<td>${typeof r[k] === "number" ? fmt(r[k], Math.abs(r[k]) < 100 ? 2 : 0) : esc(r[k] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    return `${cards}${table}${irb}`;
  }
  function tabSeg(d) {
    const sg = d.irbank?.seg || []; if (!sg.length) return empty("セグメント情報はありません(単一セグメントの会社を含む)。");
    const years = [...new Set(sg.map((s) => s.fiscal_year))].sort(); const names = [...new Set(sg.map((s) => s.segment_name))];
    const cell = (n, y, k, f) => { const s = sg.find((x) => x.segment_name === n && x.fiscal_year === y); return s ? f(s[k]) : "—"; };
    const money = (v) => (num(v) === null ? "—" : Math.round(num(v) / 1e6).toLocaleString("ja-JP")); const p1 = (v) => (num(v) === null ? "—" : `${num(v).toFixed(1)}%`);
    const tbl = (k, title, f) => `<div class="row-head"><h3>${title}</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>セグメント</th>${years.map((y) => `<th>${esc(fy(y))}</th>`).join("")}</tr></thead><tbody>${names.map((n) => `<tr><th>${esc(n)}</th>${years.map((y) => `<td>${cell(n, y, k, f)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const latest = sg.filter((s) => s.fiscal_year === years.at(-1)).sort((a, b) => (num(b.revenue) || 0) - (num(a.revenue) || 0));
    const mix = `<div class="mix">${latest.map((s, i) => `<span style="flex:${Math.max(num(s.revenue_share) || 0, 0.5)};background:hsl(${(i * 47 + 210) % 360} 55% 55%)" title="${esc(s.segment_name)} ${p1(s.revenue_share)}"></span>`).join("")}</div><div class="mix-legend">${latest.map((s, i) => `<span><i style="background:hsl(${(i * 47 + 210) % 360} 55% 55%)"></i>${esc(s.segment_name)} ${p1(s.revenue_share)}</span>`).join("")}</div>`;
    return `<div class="row-head"><h3>売上構成(${esc(fy(years.at(-1)))})</h3></div>${mix}${tbl("revenue", "セグメント別 売上(百万円)", money)}${tbl("operating_income", "セグメント別 利益(百万円)", money)}${tbl("yoy_growth", "売上成長率", p1)}`;
  }
  function tabPeers(d) {
    const peers = d.irbank?.peers || []; if (!peers.length) return empty("競合情報はありません。");
    return `<div class="peer-grid">${peers.map((p) => { const row = S.byCode.get(p.security_code); return `<article><header><b>${esc(p.name)}</b><small>${esc(p.security_code)} · ${esc(p.industry || "")}</small>${row ? `<em class="${cls(row.change1d)}">${pct(row.change1d, 2)}</em>` : ""}</header><p>${esc(p.competition_reason || "")}</p><footer>${(p.segments || []).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}${row ? `<button type="button" class="link" data-code="${esc(p.security_code)}">チャート ›</button>` : '<small class="muted">対象外</small>'}</footer></article>`; }).join("")}</div>`;
  }
  // 決算発表の一覧。stockAI の決算発表(発表日・前年同期比・発表後の値動き)を優先し、無い銘柄は株探の決算の発表日で補う
  function earningsEvents(d) {
    const out = new Map();
    (d?.earnings || []).forEach((e) => { const date = normDate(e.announceDate); if (!date) return; out.set(date, { date, period: e.period || e.table || "", sales: num(e.sales), op: num(e.operatingProfit), net: num(e.netIncome), eps: num(e.eps), salesYoy: num(e.yoy?.sales), opYoy: num(e.yoy?.operatingProfit), netYoy: num(e.yoy?.netIncome), epsYoy: num(e.yoy?.eps), base: e.yoyBase?.period || e.yoyBase?.periodEnd || "", react5: num(e.marketReaction5d), src: "stockAI" }); });
    const kab = d?.kabutan || {};
    [["quarter", "四半期"], ["q1cum", "累計"], ["half", "上期"], ["annual", "通期"]].forEach(([k, label]) => (kab[k] || []).filter((r) => !r.forecast).forEach((r) => {
      const date = normDate(r.announce); if (!date || out.has(date)) return;
      out.set(date, { date, period: `${r.period}(${label})`, sales: num(r.sales), op: num(r.op), net: num(r.net), eps: num(r.eps), salesYoy: null, opYoy: null, netYoy: null, epsYoy: null, base: "", react5: null, src: "株探" });
    }));
    return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // 発表日の前後の株価の動き(日足から計算した実績)
  function reaction(cur, date, days) {
    const rows = cur.daily; let i = rows.findIndex((r) => r.d >= date); if (i < 1) return null;
    const base = rows[i - 1].c; const j = Math.min(rows.length - 1, i + days - 1);
    return i + days - 1 < rows.length ? rows[j].c / base - 1 : null;
  }
  function tabEarn(d, cur) {
    const ev = earningsEvents(d);
    if (!ev.length) return empty("決算発表の履歴はありません。");
    const yo = (v) => (v === null ? "" : `<small class="${cls(v)}">${pct(v)}</small>`);
    return `<div class="row-head"><h3>決算発表の履歴(${ev.length}回)</h3><small>金額は百万円。小さい数字は前年同期比。発表翌日・5日後の値動きは前日終値からの実績</small></div>
      <div class="table-wrap tall"><table class="grid"><thead><tr><th>発表日</th><th>期</th><th>売上高</th><th>営業利益</th><th>純利益</th><th>EPS(円)</th><th>翌日</th><th>5日後</th><th>出典</th></tr></thead><tbody>${ev.slice().reverse().map((e) => { const r1 = reaction(cur, e.date, 1), r5 = e.react5 ?? reaction(cur, e.date, 5); return `<tr><th>${esc(e.date)}</th><td class="left">${esc(e.period)}${e.base ? `<small>比較: ${esc(e.base)}</small>` : ""}</td><td>${mil(e.sales)}${yo(e.salesYoy)}</td><td class="${num(e.op) < 0 ? "down" : ""}">${mil(e.op)}${yo(e.opYoy)}</td><td>${mil(e.net)}${yo(e.netYoy)}</td><td>${fmtPrice(e.eps)}${yo(e.epsYoy)}</td><td>${pctCell(r1)}</td><td>${pctCell(r5)}</td><td><small>${esc(e.src)}</small></td></tr>`; }).join("")}</tbody></table></div>
      <p class="foot">チャートの「決」印は、この発表日です(インジケーターの「決算発表日」で表示を切り替え)。</p>`;
  }
  // 有価証券報告書(EDINET XBRL)の全項目。項目名・単位は data-inventory.json の一覧
  const edinetFmt = (unit, value) => {
    const v = num(value); if (v === null) return "—";
    if (unit === "円") return Math.abs(v) >= 1e8 ? `${(v / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}億円` : `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円`;
    if (unit === "比率") return `${(v * 100).toFixed(1)}%`;
    if (unit === "%") return `${(v <= 1 ? v * 100 : v).toFixed(1)}%`;
    if (unit === "倍") return `${v.toFixed(1)}倍`;
    if (unit === "人") return `${Math.round(v).toLocaleString("ja-JP")}人`;
    return v.toLocaleString("ja-JP");
  };
  function tabEdinet(d) {
    const ed = d.edinet || {}; const catalog = S.inventory?.edinetItems || [];
    const keys = [...catalog.map((c) => c.key), ...Object.keys(ed).filter((k) => !catalog.some((c) => c.key === k))].filter((k) => ed[k]?.length);
    if (!keys.length) return empty("有報(EDINET)のデータはありません。");
    const years = [...new Set(keys.flatMap((k) => ed[k].map((r) => String(r[0]).slice(0, 7))))].sort();
    return `<div class="row-head"><h3>有価証券報告書(XBRL)の全項目</h3><small>${keys.length}項目 × ${years.length}期</small></div><div class="table-wrap tall"><table class="grid period"><thead><tr><th>項目</th>${years.map((y) => `<th>${esc(y.replace(/^20/, "").replace("-", "."))}</th>`).join("")}</tr></thead><tbody>${keys.map((k) => { const meta = catalog.find((c) => c.key === k) || {}; const map = Object.fromEntries(ed[k].map((r) => [String(r[0]).slice(0, 7), r[1]])); return `<tr><th title="${esc(`${k} ${meta.origin || ""}`)}">${esc(meta.label || k)}</th>${years.map((y) => `<td class="${num(map[y]) < 0 ? "down" : ""}">${y in map ? edinetFmt(meta.unit, map[y]) : "—"}</td>`).join("")}</tr>`; }).join("")}</tbody></table></div><p class="foot">EDINET の有価証券報告書の XBRL から取り出した値(stockAI)。経営指標等の推移(5年分)と本表(2年分)を合わせて、書類に載っている期をすべて表示。</p>`;
  }
  function tabPeople(d) {
    const fin = d.irbank?.fin; const g = (S.catalog?.finGroups || []).find((x) => x.id === "people");
    const ind = d.irbank?.ind; const cat = S.catalog?.ind || {};
    const hc = ind ? Object.keys(ind.values || {}).filter((k) => cat[k]?.category === "human_capital") : [];
    const ed = d.edinet || {}; const emp = ed.n_employees || [];
    const parts = [
      fin && g ? `<div class="row-head"><h3>従業員・ガバナンス・環境(IRBANK)</h3></div>${periodGrid(fin, g.keys, "fin")}` : "",
      hc.length ? `<div class="row-head"><h3>人的資本の指標(IRBANK)</h3></div>${periodGrid(ind, hc, "ind")}` : "",
      emp.length ? `<div class="row-head"><h3>従業員数(有報)</h3></div><div class="table-wrap"><table class="grid"><thead><tr><th>期</th>${emp.map((r) => `<th>${esc(String(r[0]).slice(0, 7))}</th>`).join("")}</tr></thead><tbody><tr><th>従業員数</th>${emp.map((r) => `<td>${fmt(r[1])}人</td>`).join("")}</tr></tbody></table></div>` : "",
    ].join("");
    return parts || empty("人的資本のデータはありません。");
  }
  function tabProfile(d, cur) {
    const s = d.irbank?.security || {}; const r = cur.row || {}; const k = d.kabutan || {};
    const item = (label, value) => `<div><dt>${label}</dt><dd>${value ?? "—"}</dd></div>`;
    const facts = S.evidence?.relations?.stocks?.[cur.code] || [];
    const typeLabel = { jv: "合弁", supplier: "仕入先", customer: "顧客・販売先", peer: "同業", material: "素材・部材" };
    const evLabel = { disclosed: "開示", reported: "報道", assumed: "仮定" };
    // 関連ニュースは stockAI が銘柄ごとに保存した見出し(research.news)と、全体のニュースのうちこの銘柄のもの
    const news = [...(d.research?.news || []).map((n) => ({ publishedAt: n.at, title: n.title, source: n.source, url: n.url })), ...(S.dash.news || []).filter((n) => n.code === cur.code)]
      .filter((n, i, arr) => n.title && arr.findIndex((x) => x.title === n.title) === i).sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt))).slice(0, 50);
    return `<div class="row-head"><h3>会社概要</h3></div><dl class="metrics">${[
      item("会社名", esc(s.name || r.name)), item("証券コード", esc(cur.code)), item("市場", esc(s.market || r.market)), item("業種", esc(s.industry || r.industry)),
      item("決算月", s.fiscal_year_end_month ? `${esc(s.fiscal_year_end_month)}月` : "—"), item("上場年月", esc(s.listing_month || "—")),
      item("発行済株式数", num(s.issued_shares) === null ? "—" : `${Math.round(s.issued_shares / 1e4).toLocaleString("ja-JP")}万株`), item("EDINETコード", esc(s.edinet_code || "—")),
      item("会計基準(直近)", esc((k.annual || []).filter((x) => !x.forecast).at(-1)?.acct || "—")), item("売買代金順位", r.rank ? `#${r.rank}` : "—"),
    ].join("")}</dl>
      ${facts.length ? `<div class="row-head"><h3>開示・報道ベースの取引関係</h3><small>${facts.length}件</small></div><div class="peer-grid">${facts.map((f) => `<article><header><b>${esc(f.name)}</b><small>${esc(f.code)} · ${esc(f.market || "")}</small><em>${esc(typeLabel[f.type] || f.type || "関係")}${f.direction === "in" ? "(被参照)" : ""}</em></header><p>${esc(f.note || "")}</p><footer><small>有効 ${esc(f.validFrom || "—")}〜${esc(f.validTo || "")} · 根拠 ${esc(evLabel[f.evidence] || f.evidence || "—")}</small>${S.byCode.has(f.code) ? `<button type="button" class="link" data-code="${esc(f.code)}">チャート ›</button>` : ""}</footer></article>`).join("")}</div>` : ""}
      ${news.length ? `<div class="row-head"><h3>関連ニュース(stockAI が保存した見出し)</h3></div><div class="table-wrap"><table class="grid left"><tbody>${news.map((n) => `<tr><th>${esc(String(n.publishedAt || "").slice(0, 16).replace("T", " "))}</th><td class="left"><a href="${esc(n.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></td><td><small>${esc(n.source || "")}</small></td></tr>`).join("")}</tbody></table></div>` : ""}`;
  }
  function tabSaved(d, cur) {
    const have = ARCHIVE_SOURCES.filter(([k]) => cur.archives?.[k]);
    if (!have.length) return `<div class="empty">${cur.code === "market" ? "市場全体" : "この銘柄"}の保存データはまだありません。<br><small>GitHub Actions の「Kabutan weekly」(毎週の株探)・「IRBANK archive」(一度きり)を実行すると、ここに信用残の履歴やページの表が入ります(「保存データ」ページを参照)。</small></div>`;
    const srcKey = have.some(([k]) => k === S.savedSrc) ? S.savedSrc : have[0][0];
    const srcLabel = { kabutan: "株探", irbank: "IRBANK" }[srcKey];
    const a = cur.archives[srcKey];
    const pages = a.pages || [];
    const sel = pages.find((p) => p.name === S.irPage) || pages.find((p) => p.name === "margin") || pages[0];
    const tables = (sel?.tables || []).map((t, i) => `<div class="row-head"><h3>${esc(t.title || `表 ${i + 1}`)}</h3><small>${t.rows.length}行</small></div><div class="table-wrap tall"><table class="grid left">${t.headers?.length ? `<thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : ""}<tbody>${t.rows.slice(0, 2000).map((r) => `<tr>${r.map((c, j) => (j === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`).join("");
    const used = (cur.credit || []).filter((r) => r.source === `${srcLabel}保存`).length;
    return `<div class="row-head">${seg(ARCHIVE_SOURCES.map(([k, l]) => [k, `${l.replace("保存", "")}${cur.archives?.[k] ? "" : "(なし)"}`]), srcKey, "savedsrc")}<h3>${esc(srcLabel)} 保存分(${esc(String(a.fetchedAt || "").slice(0, 16).replace("T", " "))} 取得)</h3>${seg(pages.map((p) => [p.name, `${p.label || p.name}${p.status && p.status !== 200 ? ` (${p.status})` : ""}`]), sel?.name, "irpage")}</div>
      ${a.margin?.length ? `<p class="foot">信用残の履歴 ${a.margin.length} 回(${esc(a.margin[0].date)}〜${esc(a.margin.at(-1).date)})。${cur.code === "market" ? "指数のチャートの信用残に使っています(東証全体)。" : `このうち stockAI に無い日付の ${used} 回を「信用残」タブとチャートにつないでいます(同じ日付は stockAI を優先)。`}</p>` : ""}
      ${sel ? `<p class="foot"><a href="${esc(sel.url)}" target="_blank" rel="noopener">${esc(sel.url)}</a>${sel.title ? ` · ${esc(sel.title)}` : ""}</p>${tables || empty("このページに表はありませんでした。")}` : empty("保存されたページがありません。")}`;
  }

  // =====================================================================
  // ランキング・信用(全銘柄)
  // =====================================================================
  let rankLoaded = null; let rankChart = null; const RK = { sort: "buyAmount", desc: true };
  async function loadRankData() {
    if (rankLoaded) return rankLoaded;
    const prog = $("#rankProgress"); prog.hidden = false;
    const step = (label) => (done, total) => { $("i", prog).style.width = `${Math.round(done / total * 100)}%`; $("span", prog).textContent = `${label} ${done}/${total}`; };
    rankLoaded = (async () => {
      const details = await SRData.allChunks("detail", (doc) => ({ credit: doc?.credit || [], shares: num(doc?.irbank?.security?.issued_shares) }), step("信用残を読み込み中"));
      const charts = await SRData.allChunks("chart", (doc) => { const dec = SRData.decodeChart(doc); const first = dec.daily[0]?.d || "9999"; return { prices: [...dec.weekly.filter((r) => r.d < first), ...dec.daily], splits: dec.splits }; }, step("株価を読み込み中"));
      prog.hidden = true;
      return { details, charts };
    })().catch((e) => { rankLoaded = null; prog.hidden = true; throw e; });
    return rankLoaded;
  }
  function computeRank(data) {
    const method = $("#rankMethod").value;
    return S.preds.map((p) => {
      const d = data.details[p.code], c = data.charts[p.code];
      const est = d && c ? SRCredit.estimateCredit(dropErrata(d.credit), c.prices, c.splits, { method }) : { rows: [] };
      const rows = est.rows; const last = rows.at(-1) || null; const price = c?.prices.at(-1)?.c ?? p.close;
      return {
        code: p.code, name: p.name, industry: p.industry, close: price, chg: num(p.change1d), rank: p.rank,
        ratio: last?.ratio ?? null, buy: last?.buy ?? null, sell: last?.sell ?? null, buyAmount: last?.buyAmount ?? null, sellAmount: last?.sellAmount ?? null,
        buyPnl: last?.buyPnl ?? null, sellPnl: last?.sellPnl ?? null, warmup: last?.warmup ?? true, date: last?.date ?? null,
        buy4w: SRCredit.changeOver(rows, "buy", 4), sell4w: SRCredit.changeOver(rows, "sell", 4), buyDays: last?.buyDays ?? null,
        mcap: d?.shares && price ? d.shares * price : null, buyToMcap: d?.shares && last?.buy ? last.buy * (last.splitFactor || 1) / d.shares : null, rows,
      };
    });
  }
  // 全銘柄合計(金額加重)の推定評価損益率の推移。週ごとに各銘柄の最後の観測を足し合わせる
  function aggregateSeries(list) {
    const wk = (d) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + ((5 - t.getUTCDay() + 7) % 7)); return t.toISOString().slice(0, 10); };
    const acc = new Map();
    list.forEach((x) => {
      const per = new Map(); x.rows.forEach((r) => { if (!r.warmup) per.set(wk(r.date), r); });
      per.forEach((r, w) => { const a = acc.get(w) || { bA: 0, bC: 0, sA: 0, sC: 0, n: 0, buy: 0, sell: 0 }; if (r.buyAmount !== null && r.buyCost) { a.bA += r.buyAmount; a.bC += r.buyCost; } if (r.sellAmount !== null && r.sellCost) { a.sA += r.sellAmount; a.sC += r.sellCost; } a.n++; acc.set(w, a); });
    });
    const out = [...acc.entries()].sort().map(([w, a]) => ({ time: w, buyPnl: a.bC ? a.bA / a.bC - 1 : null, sellPnl: a.sC ? 1 - a.sA / a.sC : null, ratio: a.sA ? a.bA / a.sA : null, bA: a.bA, sA: a.sA, n: a.n }));
    const maxN = Math.max(...out.map((o) => o.n), 0);
    return out.filter((o) => o.n >= maxN * 0.6); // 対象銘柄が少ない古い週は構成が偏るので除く
  }
  async function renderRank() {
    const table = $("#rankTable");
    if (!table.dataset.bound) {
      table.dataset.bound = "1";
      const inds = [...new Set(S.preds.map((r) => r.industry).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
      $("#rankIndustry").innerHTML += inds.map((x) => `<option>${esc(x)}</option>`).join("");
      ["#rankFilter", "#rankIndustry", "#rankNoWarm"].forEach((s) => $(s).addEventListener("input", drawRankTable));
      $("#rankMethod").value = S.set.creditMethod;
      $("#rankMethod").addEventListener("change", () => { S.set.creditMethod = $("#rankMethod").value; saveSettings(); S.rank = computeRank(S.rankData); drawRankTable(); drawRankAgg(); });
      table.addEventListener("click", (e) => { const th = e.target.closest("th[data-sort]"); if (th) { const k = th.dataset.sort; RK.desc = RK.sort === k ? !RK.desc : true; RK.sort = k; drawRankTable(); return; } const b = e.target.closest("[data-code]"); if (b) goChart(b.dataset.code); });
    }
    if (S.rank) { drawRankTable(); return; }
    table.innerHTML = '<tbody><tr><td class="muted pad">全銘柄の信用残と株価を読み込んでいます…(初回は十数MBの復号があります)</td></tr></tbody>';
    try { S.rankData = await loadRankData(); } catch (e) { table.innerHTML = `<tbody><tr><td class="pad">読み込めませんでした: ${esc(e.message)}</td></tr></tbody>`; return; }
    S.rank = computeRank(S.rankData); drawRankTable(); drawRankAgg();
  }
  const RANK_COLS = [
    ["code", "銘柄", (x) => `<button type="button" class="link" data-code="${esc(x.code)}"><b>${esc(x.code)}</b> ${esc(x.name || "")}</button><small>${esc(x.industry || "")}</small>`, "s"],
    ["close", "終値", (x) => fmtPrice(x.close)], ["chg", "前日比", (x) => pctCell(x.chg, 2)],
    ["date", "信用 申込日", (x) => esc(x.date || "—"), "s"], ["ratio", "信用倍率", (x) => (x.ratio === null ? "—" : `${fmt(x.ratio, 2)}倍`)],
    ["buy", "買残(株)", (x) => fmt(x.buy)], ["sell", "売残(株)", (x) => fmt(x.sell)],
    ["buyAmount", "買残金額", (x) => oku(x.buyAmount)], ["sellAmount", "売残金額", (x) => oku(x.sellAmount)],
    ["buyPnl", "推定 買い方<br>評価損益率", (x) => (x.warmup && $("#rankNoWarm").checked ? '<span class="muted">—</span>' : pctCell(x.buyPnl))],
    ["sellPnl", "推定 売り方<br>評価損益率", (x) => (x.warmup && $("#rankNoWarm").checked ? '<span class="muted">—</span>' : pctCell(x.sellPnl))],
    ["buy4w", "買残 4週", (x) => pctCell(x.buy4w, 0)], ["sell4w", "売残 4週", (x) => pctCell(x.sell4w, 0)],
    ["buyDays", "買残/出来高", (x) => (x.buyDays === null ? "—" : `${fmt(x.buyDays, 1)}日`)], ["buyToMcap", "買残/発行株", (x) => (x.buyToMcap === null ? "—" : `${(x.buyToMcap * 100).toFixed(2)}%`)],
    ["mcap", "時価総額", (x) => oku(x.mcap)],
  ];
  function drawRankTable() {
    if (!S.rank) return;
    const q = $("#rankFilter").value.trim().toLowerCase(), ind = $("#rankIndustry").value, noWarm = $("#rankNoWarm").checked;
    let list = S.rank.filter((x) => (!q || x.code.toLowerCase().includes(q) || (x.name || "").toLowerCase().includes(q)) && (!ind || x.industry === ind));
    const key = RK.sort; const isStr = RANK_COLS.find((c) => c[0] === key)?.[3] === "s";
    const val = (x) => { if (noWarm && x.warmup && ["buyPnl", "sellPnl"].includes(key)) return null; return x[key]; };
    list.sort((a, b) => { const va = val(a), vb = val(b); if (va === null || va === undefined) return 1; if (vb === null || vb === undefined) return -1; const c = isStr ? String(va).localeCompare(String(vb), "ja") : va - vb; return RK.desc ? -c : c; });
    $("#rankCount").textContent = `${list.length}銘柄`;
    $("#rankTable").innerHTML = `<thead><tr><th>#</th>${RANK_COLS.map(([k, l]) => `<th data-sort="${k}" class="${RK.sort === k ? (RK.desc ? "desc" : "asc") : ""}">${l}</th>`).join("")}</tr></thead><tbody>${list.map((x, i) => `<tr><td class="muted">${i + 1}</td>${RANK_COLS.map(([k, , f], j) => (j === 0 ? `<th>${f(x)}</th>` : `<td>${f(x)}</td>`)).join("")}</tr>`).join("")}</tbody>`;
  }
  function drawRankAgg() {
    const list = S.rank || []; const agg = aggregateSeries(list); const box = $("#rankAgg");
    const valid = list.filter((x) => x.buyAmount !== null);
    const sumB = valid.reduce((s, x) => s + x.buyAmount, 0), sumS = valid.reduce((s, x) => s + (x.sellAmount || 0), 0);
    const lastA = agg.at(-1);
    box.innerHTML = `<div class="cards"><article><span>買残金額の合計</span><strong>${oku(sumB)}<small>円</small></strong><em>${valid.length}銘柄の最新申込日</em></article><article><span>売残金額の合計</span><strong>${oku(sumS)}<small>円</small></strong><em>金額ベースの信用倍率 ${sumS ? (sumB / sumS).toFixed(2) : "—"}倍</em></article><article><span>推定 買い方評価損益率(合計)</span><strong class="${cls(lastA?.buyPnl)}">${pct(lastA?.buyPnl)}</strong><em>${esc(lastA?.time || "")} 週 · 金額加重 · ${lastA?.n ?? 0}銘柄</em></article><article><span>推定 売り方評価損益率(合計)</span><strong class="${cls(lastA?.sellPnl)}">${pct(lastA?.sellPnl)}</strong><em>同上</em></article></div>
      <section class="panel"><div class="row-head"><h3>対象銘柄合計の推定信用評価損益率と信用倍率(週次)</h3><small>買い方が −20% 前後まで悪化すると投げ(セリング・クライマックス)が出やすい、と一般に言われる水準。あくまで stockAI の対象銘柄だけの推定</small></div><div id="rankAggChart" class="mini-chart"></div></section>`;
    rankChart?.remove(); rankChart = null;
    if (agg.length < 2) return;
    rankChart = LW.createChart($("#rankAggChart"), { autoSize: true, ...chartTheme(), localization: { locale: "ja-JP", dateFormat: "yyyy/MM/dd" }, rightPriceScale: { ...chartTheme().rightPriceScale }, leftPriceScale: { visible: true, borderColor: css("--tv-border") } });
    const pf = { type: "custom", formatter: (v) => `${v.toFixed(1)}%`, minMove: 0.1 };
    const b = rankChart.addSeries(LW.LineSeries, { color: css("--credit-buy"), lineWidth: 2, priceFormat: pf, title: "買い方" }); b.setData(agg.filter((o) => o.buyPnl !== null).map((o) => ({ time: o.time, value: o.buyPnl * 100 })));
    const s = rankChart.addSeries(LW.LineSeries, { color: css("--credit-sell"), lineWidth: 2, priceFormat: pf, title: "売り方" }); s.setData(agg.filter((o) => o.sellPnl !== null).map((o) => ({ time: o.time, value: o.sellPnl * 100 })));
    [0, -10, -20].forEach((lv) => b.createPriceLine({ price: lv, color: lv ? alpha(css("--down"), 0.5) : css("--tv-grid2"), lineStyle: LW.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: !!lv, title: lv ? `${lv}%` : "" }));
    const r = rankChart.addSeries(LW.LineSeries, { color: "#ffb300", lineWidth: 1, priceScaleId: "left", title: "信用倍率(金額)", priceFormat: { type: "price", precision: 2, minMove: 0.01 } }); r.setData(agg.filter((o) => o.ratio !== null).map((o) => ({ time: o.time, value: o.ratio })));
    rankChart.timeScale().fitContent();
  }

  // =====================================================================
  // マクロ・貿易
  // =====================================================================
  const MACRO_TABS = [["trade", "貿易統計"], ["export", "輸出・受注の指標"], ["econ", "経済指標"], ["markets", "市況・コモディティ"]];
  let macroChart = null; const MX = { flow: "export", area: "WORLD", item: null, cat: "all", sel: null, q: "", mk: null };
  async function renderMacro() {
    const tabs = $("#macroTabs");
    if (!tabs.dataset.built) { tabs.dataset.built = "1"; tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-mtab]"); if (!b) return; S.set.macroTab = b.dataset.mtab; saveSettings(); MX.sel = null; renderMacro(); }); }
    tabs.innerHTML = MACRO_TABS.map(([k, l]) => `<button type="button" data-mtab="${k}" class="${S.set.macroTab === k ? "active" : ""}">${l}</button>`).join("");
    const body = $("#macroBody");
    if (!S.macro) { body.innerHTML = '<p class="muted pad">読み込み中…</p>'; [S.macro, S.econ] = await Promise.all([SRData.fs("macro").catch(() => ({ error: true })), SRData.fs("econ").catch(() => ({ error: true }))]); }
    macroChart?.remove(); macroChart = null;
    const fn = { trade: mxTrade, export: mxExport, econ: mxEcon, markets: mxMarkets }[S.set.macroTab] || mxTrade;
    try { body.innerHTML = fn(); } catch (e) { console.error(e); body.innerHTML = `<p class="pad">表示できませんでした: ${esc(e.message)}</p>`; }
    $("#macroSub").textContent = S.macro?.generatedAt ? `stockAI(Future Sight)の書き出し ${String(S.macro.generatedAt).slice(0, 16).replace("T", " ")}` : "";
    bindMacro(body);
  }
  function bindMacro(body) {
    const on = (sel, fn) => $$(sel, body).forEach((el) => el.addEventListener("click", () => fn(el)));
    on("[data-flow]", (el) => { MX.flow = el.dataset.flow; MX.item = null; renderMacro(); });
    on("[data-area]", (el) => { MX.area = el.dataset.area; renderMacro(); });
    on("[data-item]", (el) => { MX.item = MX.item === el.dataset.item ? null : el.dataset.item; renderMacro(); });
    on("[data-ecat]", (el) => { MX.cat = el.dataset.ecat; renderMacro(); });
    on("[data-esel]", (el) => { MX.sel = MX.sel === el.dataset.esel ? null : el.dataset.esel; renderMacro(); requestAnimationFrame(() => $("#mxDetail")?.scrollIntoView({ behavior: "smooth", block: "nearest" })); });
    on("[data-mk]", (el) => { MX.mk = MX.mk === el.dataset.mk ? null : el.dataset.mk; renderMacro(); requestAnimationFrame(() => $("#mxDetail")?.scrollIntoView({ behavior: "smooth", block: "nearest" })); });
    const q = $("#econQ", body); if (q) q.addEventListener("input", () => { MX.q = q.value; const pos = q.selectionStart; renderMacro().then(() => { const n = $("#econQ"); n?.focus(); n?.setSelectionRange(pos, pos); }); });
    const det = $("#mxDetailChart", body); if (det && det.dataset.series) drawMacroChart(det, JSON.parse(det.dataset.series), det.dataset.kind);
  }
  // [[日付, 値], ...] の系列を折れ線(kind=bar なら棒)で描く
  function drawMacroChart(el, series, kind) {
    macroChart?.remove();
    macroChart = LW.createChart(el, { autoSize: true, ...chartTheme(), localization: { locale: "ja-JP", dateFormat: "yyyy/MM/dd" } });
    series.forEach((sr, i) => {
      const data = sr.points.map(([d, v]) => ({ time: normDate(d), value: num(v) })).filter((p) => p.time && p.value !== null).sort((a, b) => (a.time < b.time ? -1 : 1));
      const uniq = data.filter((p, j) => j === 0 || p.time !== data[j - 1].time);
      const maxAbs = Math.max(...uniq.map((p) => Math.abs(p.value)), 0);
      const priceFormat = { type: "custom", minMove: 0.01, formatter: (v) => v.toLocaleString("ja-JP", { maximumFractionDigits: maxAbs >= 1000 ? 0 : maxAbs >= 10 ? 1 : 2 }) };
      const s = kind === "bar" ? macroChart.addSeries(LW.HistogramSeries, { title: sr.name, priceLineVisible: false, priceFormat }) : macroChart.addSeries(LW.LineSeries, { color: sr.color || ["#2962ff", "#ff9800", "#26a69a"][i % 3], lineWidth: 2, title: sr.name, priceLineVisible: false, priceFormat });
      s.setData(kind === "bar" ? uniq.map((p) => ({ ...p, color: p.value >= 0 ? alpha(css("--up"), 0.8) : alpha(css("--down"), 0.8) })) : uniq);
    });
    macroChart.timeScale().fitContent();
  }
  function mxTrade() {
    const t = S.macro?.trade; if (!t?.available) return empty(t?.howToFetch ? `貿易統計はまだ取得されていません: ${t.howToFetch}` : "貿易統計のデータがありません。");
    const flowL = { export: "輸出", import: "輸入" }; const blocks = t.blocks?.[MX.flow] || {};
    if (!blocks[MX.area]) MX.area = "WORLD"; const rows = blocks[MX.area] || []; const n = t.months.length - 1;
    const ex = t.blocks?.export?.WORLD?.[0], im = t.blocks?.import?.WORLD?.[0];
    const bal = t.months.map((m, i) => [m, ex?.values?.[i] != null && im?.values?.[i] != null ? ex.values[i] - im.values[i] : null]);
    const focus = MX.flow === "export" ? /半導体等|自動車|鉄鋼|科学光学|電算機|原動機|非鉄金属|船舶/ : /原油|液化天然ガス|石炭|医薬品|半導体等|通信機|電算機|衣類|穀物/;
    const sel = MX.item ? rows.find((r) => r.name === MX.item) : null;
    const detail = sel ? { series: [{ name: `${sel.name}(${flowL[MX.flow]}・${t.areas[MX.area] || MX.area})`, points: t.months.map((m, i) => [m, sel.values[i]]) }], kind: "line", title: `${sel.name} の推移(億円)` } : { series: [{ name: "貿易収支", points: bal }], kind: "bar", title: "貿易収支(世界・月次・億円)" };
    const areaRows = sel ? Object.keys(t.areas).filter((a) => blocks[a]).map((a) => [a, blocks[a].find((r) => r.name === MX.item)]).filter(([, r]) => r) : [];
    return `<div class="cards"><article><span>輸出(世界・${esc(t.months[n])})</span><strong>${okuUnit(ex?.values?.[n])}</strong><em>前年比 ${pctCell(ex?.yoy)} · 3か月 ${pctCell(ex?.yoy3m)}</em></article><article><span>輸入</span><strong>${okuUnit(im?.values?.[n])}</strong><em>前年比 ${pctCell(im?.yoy)} · 3か月 ${pctCell(im?.yoy3m)}</em></article><article><span>貿易収支</span><strong class="${cls(bal[n]?.[1])}">${okuUnit(bal[n]?.[1])}</strong><em>輸出 − 輸入</em></article><article><span>期間</span><strong>${esc(t.months[0])}〜${esc(t.months[n])}</strong><em>${esc(t.fetchReport?.note || "")}</em></article></div>
      <section class="panel" id="mxDetail"><div class="row-head"><h3>${esc(detail.title)}</h3>${sel ? '<button type="button" class="btn" data-item="">収支に戻る</button>' : "<small>品目の行を押すと、その品目の推移に切り替わります</small>"}</div><div id="mxDetailChart" class="mini-chart" data-kind="${detail.kind}" data-series='${esc(JSON.stringify(detail.series))}'></div></section>
      <div class="row-head"><h3>品目別(${flowL[MX.flow]} · ${esc(t.areas[MX.area] || MX.area)} · 億円)</h3>${seg(Object.entries(flowL), MX.flow, "flow")}${seg(Object.keys(t.areas).filter((a) => blocks[a]).map((a) => [a, t.areas[a]]), MX.area, "area")}</div>
      <div class="table-wrap"><table class="grid left"><thead><tr><th>品目</th><th>${esc(t.months[n])}</th><th>前年同月比</th><th>3か月合計の前年比</th><th>3年の推移</th></tr></thead><tbody>${rows.map((r) => `<tr class="click ${r.code === "TOTAL" ? "total" : focus.test(r.name) ? "focus" : ""} ${MX.item === r.name ? "sel" : ""}" data-item="${esc(r.name)}"><th>${esc(r.name)}<small>${esc(r.code === "TOTAL" ? "" : r.code)}</small></th><td>${okuUnit(r.values[n])}</td><td>${pctCell(r.yoy)}</td><td>${pctCell(r.yoy3m)}</td><td>${spark(r.values.slice(-36), 160, 28, "var(--accent)")}</td></tr>`).join("")}</tbody></table></div>
      ${areaRows.length ? `<div class="row-head"><h3>${esc(MX.item)} の地域別</h3><small>地域別は各地域の上位20品目だけ</small></div><div class="table-wrap"><table class="grid left"><thead><tr><th>地域</th><th>${esc(t.months[n])}</th><th>前年同月比</th><th>3か月の前年比</th><th>推移</th></tr></thead><tbody>${areaRows.map(([a, r]) => `<tr><th>${esc(t.areas[a] || a)}</th><td>${okuUnit(r.values[n])}</td><td>${pctCell(r.yoy)}</td><td>${pctCell(r.yoy3m)}</td><td>${spark(r.values.slice(-36), 160, 28, "var(--accent)")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="foot">太字=注目品目。${(t.notes || []).map(esc).join(" ")} 出典: ${esc(t.source || "財務省 貿易統計")}。</p>`;
  }
  const EXPORT_RE = /輸出|輸入|貿易|出荷|受注|月次売上|販売高|TSMC|SEAJ|JEITA|WSTS|工作機械|半導体|DRAM|NAND|export|shipment/i;
  function econCards(items) {
    return `<div class="ec-grid">${items.map((it) => `<button type="button" class="ec-card ${it.available ? "" : "off"} ${MX.sel === it.id ? "sel" : ""}" data-esel="${esc(it.id)}"><header><b>${esc(it.name)}</b><small>${esc(it.catLabel || "")}${it.date ? ` · ${esc(it.date)}` : ""}</small></header>${it.available ? `<div class="ec-val"><strong>${fmt(it.last, Math.abs(num(it.last)) >= 1000 ? 0 : 2)}${it.unit && !["指数", "価格"].includes(it.unit) ? `<small> ${esc(it.unit)}</small>` : ""}</strong>${it.tName ? `<span>${esc(it.tName)} ${["yoy", "chg"].includes(it.transform) ? pctCell(it.tLast) : fmt(it.tLast, 2)}</span>` : ""}</div>${spark(it.spark, 220, 34)}` : `<p class="muted">未取得</p>`}</button>`).join("")}</div>`;
  }
  function econDetail(it) {
    if (!it) return "";
    const tSeries = it.tSeries?.length >= 6 && it.transform !== "level" ? it.tSeries : null;
    const series = [{ name: it.name, points: it.levelSeries || [] }];
    const tS = tSeries ? [{ name: `${it.tName || "変化"}${["yoy", "chg"].includes(it.transform) ? "(%)" : ""}`, points: tSeries.map(([d, v]) => [d, ["yoy", "chg"].includes(it.transform) && num(v) !== null ? v * 100 : v]) }] : null;
    const box = (t, v) => (v ? `<div><b>${t}</b><p>${esc(v)}</p></div>` : "");
    const rel = it.lastRelease;
    return `<section class="panel" id="mxDetail"><div class="row-head"><h3>${esc(it.name)}</h3><small>${esc(it.catLabel || "")} · ${esc(it.source || "")}${it.key ? ` ${esc(it.key)}` : ""} · ${esc(it.release || "")}</small><button type="button" class="btn" data-esel="${esc(it.id)}">閉じる</button></div>
      <div id="mxDetailChart" class="mini-chart" data-kind="line" data-series='${esc(JSON.stringify(tS || series))}'></div>
      <p class="foot">${tS ? `${esc(it.tName || "")}の推移。水準は最新 ${fmt(it.last, 2)}(前回 ${fmt(it.prior, 2)})。` : "水準の推移。"}</p>
      ${rel ? `<div class="read"><b>最新の発表(${esc(rel.period || "")})</b><p>結果 ${esc(rel.value ?? "—")}${esc(rel.unit || "")} · 前回 ${esc(rel.prior ?? "—")} · 予想 ${esc(rel.consensus ?? "—")} · 発表 ${esc(rel.released_at || "—")}</p>${rel.note ? `<p>${esc(rel.note)}</p>` : ""}</div>` : ""}
      <div class="learn">${box("何を測るデータか", it.measures)}${box("なぜ株に効くか", it.why)}${box("上がると", it.readUp)}${box("下がると", it.readDown)}${box("関係する日本株", it.jp)}${box("落とし穴", it.pitfalls)}</div></section>`;
  }
  function mxExport() {
    const e = S.econ; if (!e || e.error) return empty("経済指標(econ.json)を読めませんでした。");
    const items = (e.series || []).filter((it) => EXPORT_RE.test(`${it.name} ${it.measures || ""} ${it.key || ""}`));
    const rel = (e.releases || []).filter((r) => EXPORT_RE.test(`${r.name || ""} ${r.indicator || ""} ${r.note || ""}`));
    const sel = items.find((it) => it.id === MX.sel);
    return `<p class="foot">輸出・出荷・受注・月次売上に関係する指標(韓国の輸出、TSMC の月次売上、SEAJ・JEITA、工作機械受注など)を抜き出しています。財務省の貿易統計は「貿易統計」タブ。</p>${econDetail(sel)}${items.length ? econCards(items) : empty("該当する指標がまだありません。")}
      ${rel.length ? `<div class="row-head"><h3>発表データ(結果・前回・市場予想)</h3></div><div class="table-wrap"><table class="grid left"><thead><tr><th>指標</th><th>期間</th><th>結果</th><th>前回</th><th>予想</th><th>発表</th><th>メモ</th></tr></thead><tbody>${rel.slice().reverse().map((r) => `<tr><th>${esc(r.name || r.indicator || "")}</th><td>${esc(r.period || "")}</td><td>${esc(r.value ?? "—")}${esc(r.unit || "")}</td><td>${esc(r.prior ?? "—")}</td><td>${esc(r.consensus ?? "—")}</td><td>${esc(r.released_at || "")}</td><td><small>${esc(r.note || "")}</small></td></tr>`).join("")}</tbody></table></div>` : ""}`;
  }
  function mxEcon() {
    const e = S.econ; if (!e || e.error) return empty("経済指標(econ.json)を読めませんでした。");
    const cats = e.categories || {}; const items = e.series || [];
    const q = MX.q.trim().toLowerCase();
    const list = items.filter((it) => (MX.cat === "all" || it.cat === MX.cat) && (!q || `${it.name} ${it.catLabel || ""} ${it.measures || ""}`.toLowerCase().includes(q))).sort((a, b) => (b.available ? 1 : 0) - (a.available ? 1 : 0));
    const sel = items.find((it) => it.id === MX.sel);
    const catList = [["all", `すべて(${items.length})`], ...Object.entries(cats).map(([k, v]) => [k, `${typeof v === "string" ? v : v?.label || k}(${items.filter((it) => it.cat === k).length})`])];
    const rg = e.regime || {};
    return `${rg.quadrant ? `<div class="cards"><article><span>景気・物価の局面</span><strong>${esc(rg.quadrant)}</strong><em>${esc(rg.tilt || "")}</em></article><article><span>成長の勢い</span><strong>${fmt(rg.growth, 2)}</strong><em>${(rg.growthParts || []).map((p) => `${esc(p[1])} ${fmt(p[2], 1)}`).join(" · ")}</em></article><article><span>物価の勢い</span><strong>${fmt(rg.inflation, 2)}</strong><em>${(rg.inflationParts || []).map((p) => `${esc(p[1])} ${fmt(p[2], 1)}`).join(" · ")}</em></article></div>` : ""}
      <div class="filters">${seg(catList, MX.cat, "ecat")}<input id="econQ" type="search" placeholder="指標名で絞り込み" value="${esc(MX.q)}"></div>${econDetail(sel)}${econCards(list)}`;
  }
  function mxMarkets() {
    const m = S.macro || {}; const groups = [...(m.markets || []).map((s) => ({ label: s.label, items: s.items })), ...(m.commodities?.groups || []).map((g) => ({ label: g.label, items: g.items }))];
    if (!groups.length) return empty("市況データがありません。");
    const all = groups.flatMap((g) => g.items); const sel = all.find((it) => it.sym === MX.mk);
    const card = (it) => `<button type="button" class="ec-card ${it.available ? "" : "off"} ${MX.mk === it.sym ? "sel" : ""}" data-mk="${esc(it.sym)}"><header><b>${esc(it.name || it.sym)}</b><small>${esc(it.sym)}${it.unit ? ` · ${esc(it.unit)}` : ""}</small></header>${it.available ? `<div class="ec-val"><strong>${fmt(it.last, it.isRatio ? 3 : Math.abs(num(it.last)) >= 1000 ? 0 : 2)}</strong><span>${esc(it.date || "")}</span></div><div class="chgs"><span>1日 ${pctCell(it.chg1)}</span><span>20日 ${pctCell(it.chg20)}</span><span>1年 ${pctCell(it.chg250, 0)}</span></div>${spark(it.spark, 220, 34)}` : '<p class="muted">未取得</p>'}</button>`;
    return `${sel ? `<section class="panel" id="mxDetail"><div class="row-head"><h3>${esc(sel.name)}(${esc(sel.sym)})</h3><small>5年の週足</small><button type="button" class="btn" data-mk="${esc(sel.sym)}">閉じる</button></div><div id="mxDetailChart" class="mini-chart" data-kind="line" data-series='${esc(JSON.stringify([{ name: sel.name, points: sel.weekly || [] }]))}'></div></section>` : ""}${groups.map((g) => `<div class="row-head"><h3>${esc(g.label)}</h3></div><div class="ec-grid">${g.items.map(card).join("")}</div>`).join("")}<p class="foot">出典: stockAI の価格取得(Yahoo Finance 等)。カードを押すと5年の週足。</p>`;
  }

  // =====================================================================
  // 保存データ(株探=毎週の定期取得 / IRBANK=一度きりの保存)
  // =====================================================================
  async function renderArchive() {
    const body = $("#archiveBody");
    const need = ARCHIVE_SOURCES.filter(([k]) => S.archiveIndex[k] === undefined);
    if (need.length) {
      body.innerHTML = '<p class="muted pad">読み込み中…</p>';
      await Promise.all(need.map(async ([k]) => { S.archiveIndex[k] = await SRData.own(`${k}/index`).catch(() => null); }));
    }
    const how = `<section class="panel prose"><h3>取得のしかた</h3><ol>
      <li>株探・IRBANK とも GitHub のサーバーからの取得を拒否するため、取得は自分の PC で行います(README「自分の PC で実行」)。パスワードは実行時に入力します。</li>
      <li><b>株探(これからの定期取得・自分の PC で)</b>: 株探は GitHub Actions からの接続を拒否(HTTP 405)するので、PC で <code>scripts\\run_local.ps1 -Source kabutan -Mode full</code> を一度実行し、<code>scripts\\register_weekly_task.ps1</code> で毎週水曜の朝の自動実行を登録します。全銘柄の信用残(週次)・決算・銘柄トップを取り、信用残の履歴を積み増します。</li>
      <li><b>IRBANK(今回だけ・自分の PC で)</b>: IRBANK は GitHub Actions からの接続を拒否(HTTP 403)するので、自分の PC で <code>scripts\\run_local.ps1</code> を実行します(README「自分の PC で実行」)。使えなくなる前に、信用残・空売り・貸借などの個別ページを一度だけ全部保存します。途中で止めても、次の実行は未取得の銘柄から続けます。取得した表は暗号化して GitHub に送られ、このページに反映されます。</li>
      <li>表は JSON にして <code>data/kabutan/</code>・<code>data/irbank/</code> に暗号化して保存し、生の HTML は暗号化した tar を GitHub Release に置きます。</li></ol>
      <p class="muted">相手のサーバーへの負荷を抑えるため、robots.txt に従い、リクエストの間隔は既定で 1.5 秒以上あけています。</p></section>`;
    const section = ([key, label]) => {
      const ix = S.archiveIndex[key]; const name = label.replace("保存", "");
      const role = key === "kabutan" ? "毎週の定期取得" : "一度きりの保存";
      if (!ix) return `<section class="panel"><div class="row-head"><h3>${esc(name)}(${role})</h3></div>${empty("まだ保存データがありません(ワークフローが一度も成功していません)。")}</section>`;
      const stocks = Object.entries(ix.stocks || {}).sort((a, b) => a[0].localeCompare(b[0]));
      const done = stocks.filter(([, s]) => s.status === "ok").length;
      const pageNames = [...new Set(stocks.flatMap(([, s]) => Object.keys(s.pages || {})))].sort();
      return `<section class="panel"><div class="row-head"><h3>${esc(name)}(${role})</h3><small>最終更新 ${esc(String(ix.updatedAt || "").slice(0, 16).replace("T", " "))} · リクエスト累計 ${fmt(ix.requests)} 回</small></div>
        <div class="cards"><article><span>取得済み銘柄</span><strong>${done}<small>/ ${S.preds.length}</small></strong><em>${stocks.length - done ? `失敗 ${stocks.length - done}` : "失敗なし"}</em></article><article><span>信用残の履歴を持つ銘柄</span><strong>${stocks.filter(([, s]) => s.marginRows > 0).length}</strong><em>最古 ${esc(stocks.map(([, s]) => s.marginFrom).filter(Boolean).sort()[0] || "—")} · 最新 ${esc(stocks.map(([, s]) => s.marginTo).filter(Boolean).sort().at(-1) || "—")}</em></article><article><span>保存したページの種類</span><strong>${pageNames.length}</strong><em>${esc(pageNames.slice(0, 8).join(", "))}${pageNames.length > 8 ? "…" : ""}</em></article><article><span>生 HTML のアーカイブ</span><strong>${(ix.releases || []).length}<small>本</small></strong><em>${esc((ix.releases || []).at(-1)?.tag || "—")}</em></article></div>
        <div class="table-wrap tall"><table class="grid left"><thead><tr><th>銘柄</th><th>状態</th><th>取得日時</th><th>信用残の履歴</th><th>期間</th>${pageNames.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead><tbody>${stocks.map(([code, s]) => `<tr><th><button type="button" class="link" data-arch="${esc(code)}" data-archsrc="${key}"><b>${esc(code)}</b> ${esc(S.byCode.get(code)?.name || s.name || "")}</button></th><td>${s.status === "ok" ? `<span class="up">ok</span>${s.lastError ? ` <small title="${esc(s.lastError)}">(直近の失敗あり)</small>` : ""}` : `<span class="down">${esc(s.status || "")}</span>`}</td><td>${esc(String(s.fetchedAt || "").slice(0, 16).replace("T", " "))}</td><td>${fmt(s.marginRows)}回</td><td>${esc(s.marginFrom || "")}〜${esc(s.marginTo || "")}</td>${pageNames.map((p) => `<td>${s.pages?.[p] === undefined ? "" : s.pages[p] === 200 ? "✓" : esc(s.pages[p])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
    };
    body.innerHTML = ARCHIVE_SOURCES.map(section).join("") + how;
    $$("[data-arch]", body).forEach((b) => b.addEventListener("click", () => { S.set.bottomTab = "saved"; S.savedSrc = b.dataset.archsrc; S.irPage = null; saveSettings(); goChart(b.dataset.arch); }));
  }

  boot();
})();
