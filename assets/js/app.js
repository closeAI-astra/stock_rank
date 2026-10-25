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
  const DEFAULTS = { interval: "1d", type: "candle", ind: ["ma5", "ma25", "ma75", "vol"], panes: ["credit", "pnl"], horizon: 20, model: "ADOPTED", ai: true, past: false, scale: 0, bottomTab: "credit", creditMethod: "fifo6m", watch: "all", watchSort: "rank", macroTab: "trade" };
  const S = {
    dash: null, preds: [], byCode: new Map(), catalog: {}, code: null, view: "chart",
    set: { ...DEFAULTS, ...LS.get("stockrank-settings", {}) },
    favs: new Set(LS.get("stockrank-favs", [])),
    cur: null, // 表示中の銘柄 {code, daily, weekly, splits, detail, archives: {kabutan, irbank}, est, credit}
    archiveIndex: {}, // 取得元ごとの index(未読込は undefined、無ければ null)
    tool: "cursor", pending: null,
  };
  const saveSettings = () => LS.set("stockrank-settings", S.set);
  const STOCK_HORIZONS = [1, 3, 5, 10, 20, 60, 126, 180, 252];
  const horizonLabel = (h) => ({ 126: "半年(126日)", 180: "3Q(180日)", 252: "1年(252日)" }[h] || `${h}営業日`);

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
    S.catalog = await SRData.fs("field-catalog").catch(() => ({}));
    $("#asOf").textContent = S.dash.asOf ? `${String(S.dash.asOf).slice(0, 16).replace("T", " ")} 時点` : "";
    document.body.classList.remove("loading");
    buildToolbar(); bindChartUi(); bindSearch(); bindWatch(); renderWatch();
    window.addEventListener("hashchange", route);
    route();
  }

  // =====================================================================
  // 画面の切り替え
  // =====================================================================
  function route() {
    const h = location.hash.replace(/^#/, "");
    const [view, arg] = h.split("/");
    const v = ["chart", "rank", "macro", "archive", "about"].includes(view) ? view : "chart";
    S.view = v;
    $$(".view").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === v));
    document.body.dataset.view = v;
    if (v === "chart") {
      const code = arg && S.byCode.has(arg) ? arg : S.code || LS.get("stockrank-last", null) || (S.byCode.has("7203") ? "7203" : S.preds[0]?.code);
      if (code && code !== S.code) loadSymbol(code);
      if (!arg && code) history.replaceState(null, "", `#chart/${code}`);
    }
    if (v === "rank") renderRank();
    if (v === "macro") renderMacro();
    if (v === "archive") renderArchive();
  }
  const goChart = (code) => { location.hash = `#chart/${code}`; };

  // ---------- 銘柄検索(上部) ----------
  function candidates(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    return S.preds.filter((r) => r.code.toLowerCase().startsWith(q) || (r.name || "").toLowerCase().includes(q)).slice(0, 12);
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
    document.addEventListener("click", (e) => { if (!e.target.closest(".symsearch")) box.hidden = true; });
    $("#tvSymbol").addEventListener("click", () => { input.focus(); });
    // TradingView のように、チャート上で英数字を打つと検索欄へ
    document.addEventListener("keydown", (e) => {
      if (S.view !== "chart" || e.ctrlKey || e.metaKey || e.altKey || /input|select|textarea/i.test(document.activeElement?.tagName || "")) return;
      if (/^[0-9a-zA-Z]$/.test(e.key)) { input.focus(); }
    });
    $("#themeBtn").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      const next = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next;
      try { localStorage.setItem("stockrank-theme", next); } catch { /* */ }
      applyChartTheme(); if (S.cur) renderChart(true);
      rankChart?.applyOptions(chartTheme()); macroChart?.applyOptions(chartTheme());
    });
  }

  // =====================================================================
  // ウォッチリスト(右)
  // =====================================================================
  function ai20(r) { return num(r.periods?.["20"]?.return); }
  function renderWatch() {
    const list = $("#watchList"); if (!list) return;
    const q = ($("#watchFilter").value || "").trim().toLowerCase();
    let rows = S.preds.filter((r) => (S.set.watch !== "fav" || S.favs.has(r.code)) && (!q || r.code.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)));
    const sorters = { rank: (a, b) => (a.rank || 1e9) - (b.rank || 1e9), chg: (a, b) => (num(b.change1d) ?? -9) - (num(a.change1d) ?? -9), ai: (a, b) => (ai20(b) ?? -9) - (ai20(a) ?? -9), code: (a, b) => a.code.localeCompare(b.code) };
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
  function mergeCredit(base, archives) {
    return SRCredit.mergeSources([[base, (r) => r.source || (r.date >= "2026-09-25" ? "JPX" : "stockAI")], ...ARCHIVE_SOURCES.map(([k, label]) => [archives?.[k]?.margin, label])]);
  }
  function priceRowsForCredit(cur) {
    const first = cur.daily[0]?.d || "9999";
    return [...cur.weekly.filter((r) => r.d < first), ...cur.daily];
  }
  function computeEst(cur) {
    cur.credit = mergeCredit(cur.detail?.credit, cur.archives);
    cur.est = SRCredit.estimateCredit(cur.credit, priceRowsForCredit(cur), cur.splits, { method: S.set.creditMethod });
  }

  async function loadSymbol(code) {
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
    S.drawings = LS.get(`stockrank-draw-${code}`, { h: [], t: [] });
    S.pending = null;
    computeEst(S.cur);
    renderChart(false);
    renderSymCard();
    renderBottom();
  }

  // =====================================================================
  // チャート(Lightweight Charts)
  // =====================================================================
  let chart = null; let mainSeries = null; let overlay = []; let drawingObjs = []; let paneSeries = [];
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
      crosshair: { ...chartTheme().crosshair, mode: LW.CrosshairMode.Normal },
      timeScale: { ...chartTheme().timeScale, rightOffset: 6, barSpacing: 7, minBarSpacing: 0.5 },
      localization: { locale: "ja-JP", dateFormat: "yyyy/MM/dd" },
    });
    chart.subscribeCrosshairMove(onCrosshair);
    chart.subscribeClick(onChartClick);
    return chart;
  }
  function applyChartTheme() { chart?.applyOptions(chartTheme()); }
  const UP = () => css("--up"), DOWN = () => css("--down");
  const alpha = (hex, a) => { const m = hex.match(/^#([0-9a-f]{6})$/i); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const lineOpts = (color, extra = {}) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });

  const IND_MENU = [["ma5", "移動平均 5"], ["ma25", "移動平均 25"], ["ma75", "移動平均 75"], ["ma200", "移動平均 200"], ["bb", "ボリンジャーバンド 20, 2σ"], ["ichimoku", "一目均衡表"], ["vol", "出来高"], ["avgcost", "信用買い方の推定平均取得単価"]];
  const PANE_MENU = [["credit", "信用残(買残・売残)"], ["ratio", "信用倍率"], ["pnl", "推定 信用評価損益率"], ["amount", "信用残の金額"], ["rsi", "RSI 14"], ["macd", "MACD 12, 26, 9"], ["stoch", "ストキャスティクス 14, 3"]];
  const IND_COLORS = { ma5: "#2962ff", ma25: "#ff9800", ma75: "#ab47bc", ma200: "#26a69a" };

  function buildToolbar() {
    $("#tvIndMenu").innerHTML = IND_MENU.map(([k, l]) => `<label><input type="checkbox" data-ind="${k}" ${S.set.ind.includes(k) ? "checked" : ""}> ${l}</label>`).join("");
    $("#tvPaneMenu").innerHTML = PANE_MENU.map(([k, l]) => `<label><input type="checkbox" data-pane="${k}" ${S.set.panes.includes(k) ? "checked" : ""}> ${l}</label>`).join("");
    $("#tvHorizon").innerHTML = STOCK_HORIZONS.map((h) => `<option value="${h}">${horizonLabel(h)}</option>`).join("");
    $("#tvHorizon").value = String(S.set.horizon); $("#tvModel").value = S.set.model; $("#tvType").value = S.set.type;
    $("#tvAi").checked = S.set.ai; $("#tvPast").checked = S.set.past;
    $$("[data-interval]").forEach((b) => b.classList.toggle("active", b.dataset.interval === S.set.interval));
    $$("[data-scale]").forEach((b) => b.classList.toggle("active", Number(b.dataset.scale) === S.set.scale));
  }
  function bindChartUi() {
    const rerender = () => { saveSettings(); if (S.cur) renderChart(true); };
    $$("[data-interval]").forEach((b) => b.addEventListener("click", () => { S.set.interval = b.dataset.interval; $$("[data-interval]").forEach((x) => x.classList.toggle("active", x === b)); saveSettings(); if (S.cur) renderChart(false); }));
    $$("[data-scale]").forEach((b) => b.addEventListener("click", () => { S.set.scale = Number(b.dataset.scale); $$("[data-scale]").forEach((x) => x.classList.toggle("active", x === b)); saveSettings(); chart?.priceScale("right", 0).applyOptions({ mode: S.set.scale }); }));
    $("#tvType").addEventListener("change", (e) => { S.set.type = e.target.value; rerender(); });
    $("#tvIndMenu").addEventListener("change", (e) => { const k = e.target.dataset.ind; if (!k) return; S.set.ind = e.target.checked ? [...new Set([...S.set.ind, k])] : S.set.ind.filter((x) => x !== k); rerender(); });
    $("#tvPaneMenu").addEventListener("change", (e) => { const k = e.target.dataset.pane; if (!k) return; S.set.panes = e.target.checked ? PANE_MENU.map(([x]) => x).filter((x) => x === k || S.set.panes.includes(x)) : S.set.panes.filter((x) => x !== k); rerender(); });
    $("#tvHorizon").addEventListener("change", (e) => { S.set.horizon = Number(e.target.value); rerender(); renderSymCard(); });
    $("#tvModel").addEventListener("change", (e) => { S.set.model = e.target.value; rerender(); });
    $("#tvAi").addEventListener("change", (e) => { S.set.ai = e.target.checked; rerender(); });
    $("#tvPast").addEventListener("change", (e) => { S.set.past = e.target.checked; rerender(); });
    $("#tvFit").addEventListener("click", () => chart?.timeScale().fitContent());
    $("#tvShot").addEventListener("click", () => { if (!chart) return; const c = chart.takeScreenshot(true); c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${S.code}_${S.set.interval}.png`; a.click(); }); });
    $("#tvFull").addEventListener("click", () => { const el = $('[data-view="chart"]'); if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => el.classList.toggle("pseudo-full")); });
    $$("[data-tool]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.tool === "clear") { S.drawings = { h: [], t: [] }; LS.set(`stockrank-draw-${S.code}`, S.drawings); S.pending = null; renderDrawings(); setTool("cursor"); toast("この銘柄の描画を消しました"); return; }
      setTool(b.dataset.tool);
    }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.tool !== "cursor") setTool("cursor"); });
    // 開いたメニューは外側のクリックで閉じる
    document.addEventListener("click", (e) => { $$(".tv-menu[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
  }
  function setTool(t) {
    S.tool = t; S.pending = null;
    $$("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    $("#tvChart").classList.toggle("drawing", t !== "cursor");
    const hint = $("#tvHint"); hint.hidden = t === "cursor";
    hint.textContent = t === "hline" ? "水平線: 価格をクリック(Esc で中止)" : t === "trend" ? "トレンドライン: 始点をクリック(Esc で中止)" : "";
  }

  // 表示中の足(週足・月足は time=期間の最初の取引日)
  function barIndexAt(rows, date) { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].start <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
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

  function forecastFor(row, h, model) {
    const p = row?.periods?.[String(h)]; if (!p) return null;
    let price = num(p.price), ret = num(p.return), label = `主役 ${p.adopted || ""}`, lo68 = num(p.low68), hi68 = num(p.high68);
    if (["CURRENT", "GBM", "DNN"].includes(model)) { const m = p.models?.[model]; if (!m) return null; price = num(m.price); ret = num(m.return); label = model; }
    if (model === "CLAUDE") { if (!p.claude) return null; price = num(p.claude.price); ret = num(p.claude.return); label = "Claude"; if (num(p.claude.low68) !== null) { lo68 = num(p.claude.low68); hi68 = num(p.claude.high68); } }
    if (price === null && ret !== null && num(row.close) !== null) price = row.close * (1 + ret);
    if (price === null) return null;
    return { h, price, ret, label, lo68, hi68, lo90: num(p.low90), hi90: num(p.high90), touchUp: num(p.touchUp), touchDown: num(p.touchDown), adopted: p.adopted, models: p.models || {} };
  }

  function renderChart(keepRange) {
    const cur = S.cur; if (!cur) return;
    ensureChart();
    const range = keepRange ? chart.timeScale().getVisibleLogicalRange() : null;
    [mainSeries, ...overlay, ...paneSeries, ...drawingObjs.filter((o) => o.series).map((o) => o.series)].forEach((s) => { if (s) try { chart.removeSeries(s); } catch { /* */ } });
    overlay = []; paneSeries = []; drawingObjs = []; mainSeries = null;
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
    if (t === "line") { mainSeries = chart.addSeries(LW.LineSeries, { color: css("--accent"), lineWidth: 2, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, value: r.c }))); }
    else if (t === "area") { mainSeries = chart.addSeries(LW.AreaSeries, { lineColor: css("--accent"), topColor: alpha(css("--accent"), 0.35), bottomColor: alpha(css("--accent"), 0.02), lineWidth: 2, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, value: r.c }))); }
    else if (t === "bar") { mainSeries = chart.addSeries(LW.BarSeries, { upColor: up, downColor: down, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, open: r.o, high: r.h, low: r.l, close: r.c }))); }
    else { mainSeries = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat }); mainSeries.setData(shown.map((r) => ({ time: r.time, open: r.o, high: r.h, low: r.l, close: r.c }))); }
    chart.priceScale("right", 0).applyOptions({ mode: S.set.scale, scaleMargins: { top: 0.08, bottom: S.set.ind.includes("vol") ? 0.2 : 0.06 } });

    const closes = bars.map((r) => r.c);
    const addLine = (values, color, extra, pane = 0) => { const s = chart.addSeries(LW.LineSeries, lineOpts(color, { priceFormat, ...extra }), pane); s.setData(bars.map((r, i) => (Number.isFinite(values[i]) ? { time: r.time, value: values[i] } : { time: r.time }))); (pane ? paneSeries : overlay).push(s); return s; };
    const ind = S.set.ind;
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
    // 信用残を足に載せる
    const cb = creditOnBars(cur.est, bars);
    if (ind.includes("avgcost") && cb.length) {
      const s = chart.addSeries(LW.LineSeries, lineOpts(css("--credit-buy"), { lineStyle: LW.LineStyle.Dotted, lineWidth: 2, lineType: LW.LineType.WithSteps, priceFormat, lastValueVisible: true, title: "買い方平均" }));
      s.setData(cb.filter((x) => num(x.r.buyAvgPrice) !== null && !x.r.warmup).map((x) => ({ time: x.time, value: x.r.buyAvgPrice })));
      overlay.push(s);
    }
    // AI 予測(最終日 → 期限の日)
    const fc = S.set.ai ? forecastFor(cur.row, S.set.horizon, S.set.model) : null;
    S.fc = fc;
    if (fc) {
      const fdate = SRInd.addBusinessDays(last.end, fc.h);
      const times = futureTimes(interval, last.time, fdate); const end = times.at(-1);
      // 未来の足のぶんだけ時間軸を伸ばす(空白データ)
      const ws = chart.addSeries(LW.LineSeries, lineOpts("rgba(0,0,0,0)", { priceFormat })); ws.setData(times.map((time) => ({ time }))); overlay.push(ws);
      const color = { CURRENT: "#26a69a", GBM: "#ffa726", DNN: "#ab47bc", CLAUDE: "#ec407a" }[S.set.model] || css("--accent");
      const seg = (v, style, width, title, lastVisible) => { if (v === null) return; const s = chart.addSeries(LW.LineSeries, lineOpts(color, { lineStyle: style, lineWidth: width, priceFormat, lastValueVisible: lastVisible, title })); s.setData([{ time: last.time, value: last.c }, { time: end, value: v }]); overlay.push(s); return s; };
      const ps = seg(fc.price, LW.LineStyle.Dashed, 2, `AI ${fc.h}日`, true);
      seg(fc.hi68, LW.LineStyle.Dotted, 1, "", false); seg(fc.lo68, LW.LineStyle.Dotted, 1, "", false);
      const c90 = alpha(color.startsWith("#") ? color : "#2962ff", 0.35);
      [fc.hi90, fc.lo90].forEach((v) => { if (v === null) return; const s = chart.addSeries(LW.LineSeries, lineOpts(c90, { lineStyle: LW.LineStyle.SparseDotted, priceFormat })); s.setData([{ time: last.time, value: last.c }, { time: end, value: v }]); overlay.push(s); });
      if (ps) LW.createSeriesMarkers(ps, [{ time: end, position: "inBar", color, shape: "circle", size: 1 }]);
      fc.end = end; fc.fdate = fdate;
    }
    // 過去の予測(保存済み、日足のみ)
    if (S.set.past && interval === "1d") {
      const preds = (cur.detail?.research?.predictions || []).filter((p) => Number(p[1]) === Number(S.set.horizon));
      const idx = { ADOPTED: 3, CURRENT: 4, GBM: 5, DNN: 6 }[S.set.model] ?? 3;
      const pts = new Map();
      preds.forEach((p) => { const ret = num(p[idx]), base = num(p[8]); if (ret === null || base === null) return; const target = SRInd.addBusinessDays(p[0], Number(p[1])); const i = barIndexAt(bars, target); if (i < 0 || target > last.end) return; pts.set(bars[i].time, base * (1 + ret)); });
      if (pts.size) { const s = chart.addSeries(LW.LineSeries, lineOpts(css("--past"), { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2.5, priceFormat })); s.setData([...pts.entries()].sort().map(([time, value]) => ({ time, value }))); overlay.push(s); }
    }
    // サブチャート
    let pane = 0;
    const addPaneLine = (p, data, color, extra = {}) => { const s = chart.addSeries(LW.LineSeries, lineOpts(color, { lineWidth: 1.5, lastValueVisible: true, ...extra }), p); s.setData(data); paneSeries.push(s); return s; };
    const pctFmt = { type: "custom", formatter: (v) => `${(v).toFixed(1)}%`, minMove: 0.1 };
    for (const k of S.set.panes) {
      if (["credit", "ratio", "pnl", "amount"].includes(k) && !cb.length) continue;
      pane++;
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
    // サブチャートが多いときは主チャートが潰れないよう、高さを足して主チャートの比率も上げる
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(3.2, (panes.length - 1) * 1.1) : 1));
    $('[data-view="chart"]').style.setProperty("--tv-extra", `${Math.max(0, panes.length - 3) * 80}px`);
    S.paneKeys = ["main", ...S.set.panes.filter((k) => !["credit", "ratio", "pnl", "amount"].includes(k) || cb.length)];
    $("#tvChart").dataset.panes = String(panes.length);
    renderDrawings();
    if (range) chart.timeScale().setVisibleLogicalRange(range);
    else {
      const n = bars.length; const show = { "1d": 160, "1w": 156, "1mo": 120 }[interval];
      const extra = fc ? Math.min(60, futureTimes(interval, last.time, fc.fdate).length + 4) : 6;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - show), to: n + extra });
    }
    renderLegend(null);
  }

  // ---------- 凡例(左上の OHLC) ----------
  function renderLegend(time) {
    const bars = S.bars || []; if (!bars.length) return;
    let i = time ? S.barByTime.get(time) : bars.length - 1; if (i === undefined) i = bars.length - 1;
    const r = bars[i], p = bars[i - 1];
    const chg = p ? r.c - p.c : null, ch = p ? r.c / p.c - 1 : null; const k = cls(chg);
    const row = S.cur.row;
    const iv = { "1d": "1日", "1w": "1週", "1mo": "1か月" }[S.set.interval];
    const closes = S.legendCache?.key === `${S.code}${S.set.interval}` ? S.legendCache : (S.legendCache = { key: `${S.code}${S.set.interval}`, ...Object.fromEntries(["ma5", "ma25", "ma75", "ma200"].map((m) => [m, SRInd.sma(bars.map((b) => b.c), Number(m.slice(2)))])) });
    const ma = ["ma5", "ma25", "ma75", "ma200"].filter((m) => S.set.ind.includes(m)).map((m) => `<b style="color:${IND_COLORS[m]}">MA${m.slice(2)} ${fmtPrice(closes[m][i])}</b>`).join(" ");
    // その足の時点の最新の信用残
    let cr = null; for (const x of S.cur.est.rows) { if (x.date <= r.end) cr = x; else break; }
    const crLine = cr ? `<div class="lg-line lg-credit"><em>信用 ${esc(cr.date)}</em> <span>買残 <b class="cb">${fmt(cr.buy)}</b></span> <span>売残 <b class="cs">${fmt(cr.sell)}</b></span> <span>倍率 <b>${fmt(cr.ratio, 2)}</b></span> <span>買残金額 <b>${oku(cr.buyAmount)}</b></span> <span>推定損益 買 <b class="${cls(cr.buyPnl)}">${pct(cr.buyPnl)}</b> / 売 <b class="${cls(cr.sellPnl)}">${pct(cr.sellPnl)}</b>${cr.warmup ? ' <small title="履歴の最初の半年は推定が不安定">(参考)</small>' : ""}</span></div>` : "";
    const fc = S.fc;
    const fcLine = fc ? `<div class="lg-line lg-ai"><em>AI予測 ${esc(horizonLabel(fc.h))}</em> <b>${esc(fc.label)} 期間VWAP ${fmtPrice(fc.price)} (${pct(fc.ret)})</b> <span>68% ${fmtPrice(fc.lo68)}〜${fmtPrice(fc.hi68)}</span> <span>90% ${fmtPrice(fc.lo90)}〜${fmtPrice(fc.hi90)}</span> <small>期限 ${esc(fc.fdate)} 頃</small></div>` : "";
    $("#tvLegend").innerHTML = `<div class="lg-line"><strong>${esc(S.code)} · ${esc(row?.name || "")} · ${iv} · 東証</strong> <span>始<b class="${k}">${fmtPrice(r.o)}</b></span><span>高<b class="${k}">${fmtPrice(r.h)}</b></span><span>安<b class="${k}">${fmtPrice(r.l)}</b></span><span>終<b class="${k}">${fmtPrice(r.c)}</b></span>${chg === null ? "" : `<b class="${k}">${chg >= 0 ? "+" : ""}${fmtPrice(chg)} (${pct(ch, 2)})</b>`} <span>出来高<b>${vol(r.v)}</b></span> <small>${esc(r.start === r.end ? r.start : `${r.start}〜${r.end}`)}</small></div>${ma ? `<div class="lg-line">${ma}</div>` : ""}${fcLine}${crLine}`;
  }
  function onCrosshair(param) { if (!S.cur) return; renderLegend(param?.time !== undefined ? timeKey(param.time) : null); }

  // ---------- 描画ツール ----------
  function snapTime(t) { const bars = S.bars || []; const i = barIndexAt(bars, t); return i >= 0 ? bars[i].time : t; }
  function onChartClick(param) {
    if (S.tool === "cursor" || !param.point || param.time === undefined || !mainSeries) return;
    if (param.paneIndex && param.paneIndex !== 0) return;
    const price = mainSeries.coordinateToPrice(param.point.y); if (price === null) return;
    const time = timeKey(param.time);
    if (S.tool === "hline") { S.drawings.h.push(price); saveDrawings(); setTool("cursor"); return; }
    if (S.tool === "trend") {
      if (!S.pending) { S.pending = { time, price }; $("#tvHint").textContent = "トレンドライン: 終点をクリック"; return; }
      if (S.pending.time !== time) S.drawings.t.push({ a: S.pending, b: { time, price } });
      saveDrawings(); setTool("cursor");
    }
  }
  function saveDrawings() { LS.set(`stockrank-draw-${S.code}`, S.drawings); renderDrawings(); }
  function renderDrawings() {
    drawingObjs.forEach((o) => { try { if (o.line) mainSeries?.removePriceLine(o.line); if (o.series) chart.removeSeries(o.series); } catch { /* */ } });
    drawingObjs = []; if (!mainSeries) return;
    const c = css("--draw");
    (S.drawings?.h || []).forEach((price) => drawingObjs.push({ line: mainSeries.createPriceLine({ price, color: c, lineWidth: 1, lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: "" }) }));
    (S.drawings?.t || []).forEach((d) => {
      const a = { time: snapTime(d.a.time), value: d.a.price }, b = { time: snapTime(d.b.time), value: d.b.price };
      if (a.time === b.time) return;
      const s = chart.addSeries(LW.LineSeries, lineOpts(c, { lineWidth: 2, pointMarkersVisible: true, pointMarkersRadius: 3 })); s.setData([a, b].sort((x, y) => (x.time < y.time ? -1 : 1))); drawingObjs.push({ series: s });
    });
  }

  // =====================================================================
  // 銘柄カード(右下)
  // =====================================================================
  function renderSymCard() {
    const cur = S.cur; const box = $("#symCard"); if (!cur || !box) return;
    const r = cur.row || {}; const last = cur.daily.at(-1) || {}; const prev = cur.daily.at(-2) || {};
    const chg = last.c != null && prev.c != null ? last.c - prev.c : null;
    const sec = cur.detail?.irbank?.security || {};
    const cr = cur.est.rows.at(-1);
    const shares = num(sec.issued_shares);
    const fcRows = STOCK_HORIZONS.map((h) => ({ h, f: forecastFor(r, h, "ADOPTED") })).filter((x) => x.f);
    box.innerHTML = `<div class="sc-head"><div><b>${esc(r.name || cur.code)}</b><small>${esc(cur.code)} · ${esc(r.market || sec.market || "")} · ${esc(r.industry || sec.industry || "")}</small></div><button type="button" class="star-btn ${S.favs.has(cur.code) ? "on" : ""}" data-fav-card title="お気に入り">★</button></div>
      <div class="sc-price"><strong>${fmtPrice(last.c ?? r.close)}</strong><span class="${cls(chg)}">${chg === null ? "" : `${chg >= 0 ? "+" : ""}${fmtPrice(chg)} (${pct(chg / prev.c, 2)})`}</span><small>${esc(last.d || "")}</small></div>
      <dl class="sc-kv"><div><dt>時価総額</dt><dd>${shares && last.c ? oku(shares * last.c) : "—"}</dd></div><div><dt>売買代金順位</dt><dd>${r.rank ? `#${r.rank}` : "—"}</dd></div>
      <div><dt>信用倍率</dt><dd>${cr ? `${fmt(cr.ratio, 2)}倍` : "—"}</dd></div><div><dt>買残 / 売残</dt><dd>${cr ? `${oku(cr.buyAmount)} / ${oku(cr.sellAmount)}` : "—"}</dd></div>
      <div><dt>推定 買い方損益</dt><dd class="${cr ? cls(cr.buyPnl) : ""}">${cr ? pct(cr.buyPnl) : "—"}</dd></div><div><dt>推定 売り方損益</dt><dd class="${cr ? cls(cr.sellPnl) : ""}">${cr ? pct(cr.sellPnl) : "—"}</dd></div></dl>
      ${fcRows.length ? `<table class="mini"><thead><tr><th>AI予測</th><th>期間VWAP</th><th>騰落</th><th>68%</th></tr></thead><tbody>${fcRows.map(({ h, f }) => `<tr class="${h === S.set.horizon ? "sel" : ""}" data-h="${h}"><th>${h}日</th><td>${fmtPrice(f.price)}</td><td class="${cls(f.ret)}">${pct(f.ret)}</td><td><small>${fmtPrice(f.lo68)}〜${fmtPrice(f.hi68)}</small></td></tr>`).join("")}</tbody></table><p class="foot">主役モデル · ${esc(String(S.dash.asOf || "").slice(0, 10))} 時点</p>` : '<p class="muted">この銘柄の AI 予測はありません。</p>'}
      <div class="sc-links"><a href="https://kabutan.jp/stock/?code=${esc(cur.code)}" target="_blank" rel="noopener">株探</a><a href="https://irbank.net/${esc(cur.code)}" target="_blank" rel="noopener">IRBANK</a><a href="https://www.tradingview.com/chart/?symbol=TSE%3A${esc(cur.code)}" target="_blank" rel="noopener">TradingView</a></div>`;
    $("[data-fav-card]", box).addEventListener("click", () => { const c = cur.code; if (S.favs.has(c)) S.favs.delete(c); else S.favs.add(c); LS.set("stockrank-favs", [...S.favs]); renderSymCard(); renderWatch(); });
    $$("tr[data-h]", box).forEach((tr) => tr.addEventListener("click", () => { S.set.horizon = Number(tr.dataset.h); $("#tvHorizon").value = tr.dataset.h; saveSettings(); renderChart(true); renderSymCard(); }));
  }

  // =====================================================================
  // 下段のタブ(信用残・株探/IRBANK の企業データ)
  // =====================================================================
  const BOTTOM_TABS = [["credit", "信用残・金額・評価損益"], ["perf", "業績"], ["quarter", "四半期"], ["fin", "財務"], ["ind", "指標"], ["val", "株価指標"], ["div", "配当"], ["seg", "セグメント"], ["peers", "競合"], ["ai", "AI予測"], ["saved", "株探・IRBANK 保存"]];
  function renderBottom() {
    const tabs = $("#bottomTabs");
    if (!tabs.dataset.built) {
      tabs.innerHTML = BOTTOM_TABS.map(([k, l]) => `<button type="button" role="tab" data-btab="${k}">${l}</button>`).join("");
      tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-btab]"); if (!b) return; S.set.bottomTab = b.dataset.btab; saveSettings(); renderBottom(); });
      tabs.dataset.built = "1";
    }
    $$("[data-btab]").forEach((b) => b.classList.toggle("active", b.dataset.btab === S.set.bottomTab));
    const cur = S.cur; const body = $("#bottomBody"); if (!cur) return;
    const fn = { credit: tabCredit, perf: tabPerf, quarter: tabQuarter, fin: tabFin, ind: tabInd, val: tabVal, div: tabDiv, seg: tabSeg, peers: tabPeers, ai: tabAi, saved: tabSaved }[S.set.bottomTab] || tabCredit;
    const d = cur.detail || {};
    try { body.innerHTML = fn(d, cur); } catch (e) { console.error(e); body.innerHTML = `<p class="muted pad">表示できませんでした: ${esc(e.message)}</p>`; }
    $$("[data-method]", body).forEach((b) => b.addEventListener("click", () => { S.set.creditMethod = b.dataset.method; saveSettings(); computeEst(cur); renderChart(true); renderSymCard(); renderBottom(); }));
    $$("[data-csv]", body).forEach((b) => b.addEventListener("click", () => creditCsv(cur)));
    $$("[data-group]", body).forEach((b) => b.addEventListener("click", () => { S.finGroup = b.dataset.group; renderBottom(); }));
    $$("[data-indcat]", body).forEach((b) => b.addEventListener("click", () => { S.indCat = b.dataset.indcat; renderBottom(); }));
    $$("[data-aih]", body).forEach((b) => b.addEventListener("click", () => { S.aiH = Number(b.dataset.aih); renderBottom(); }));
    $$("[data-irpage]", body).forEach((b) => b.addEventListener("click", () => { S.irPage = b.dataset.irpage; renderBottom(); }));
    $$("[data-savedsrc]", body).forEach((b) => b.addEventListener("click", () => { S.savedSrc = b.dataset.savedsrc; S.irPage = null; renderBottom(); }));
    $$("[data-code]", body).forEach((b) => b.addEventListener("click", () => goChart(b.dataset.code)));
  }
  const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
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
    const table = `<div class="table-wrap tall"><table class="grid"><thead><tr><th>申込日</th><th>終値</th><th>売残(株)</th><th>前回比</th><th>買残(株)</th><th>前回比</th><th>信用倍率</th><th>売残金額</th><th>買残金額</th><th>買−売 金額</th><th>推定 買い方<br>評価損益率</th><th>推定 売り方<br>評価損益率</th><th>買い方<br>推定取得単価</th><th>買残/出来高</th><th>出典</th></tr></thead><tbody>${rows.slice().reverse().map((r) => `<tr class="${r.warmup ? "warm" : ""}"><th>${esc(r.date)}</th><td>${fmtPrice(r.closeRaw)}</td><td>${fmt(r.sell)}</td><td>${diffCell(r.sellChg)}</td><td>${fmt(r.buy)}</td><td>${diffCell(r.buyChg)}</td><td>${fmt(r.ratio, 2)}</td><td>${oku(r.sellAmount)}</td><td>${oku(r.buyAmount)}</td><td class="${cls(r.netAmount)}">${oku(r.netAmount)}</td><td class="${cls(r.buyPnl)}">${pct(r.buyPnl)}</td><td class="${cls(r.sellPnl)}">${pct(r.sellPnl)}</td><td>${fmtPrice(r.buyAvgPrice === null ? null : r.buyAvgPrice * r.priceFactor)}</td><td>${fmt(r.buyDays, 1)}日</td><td><small>${esc(r.source || "")}</small></td></tr>`).join("")}</tbody></table></div>`;
    return `${cards}<div class="row-head"><h3>信用残の全履歴(${rows.length}回)</h3>${methods}<button type="button" class="btn" data-csv>CSV で保存</button></div>${table}
      <p class="foot">金額 = 残高 × 申込日の終値(実際の株価。分割前は分割前の株価)。推定評価損益率は残高の増減と期間 VWAP から取得コストを追った推定値で、薄い行は履歴の最初の半年(推定が不安定)。${est.unadjusted ? "この銘柄の信用残は株式分割で未調整と判定したので、分割比率で揃えて計算しています。" : ""}出典: ${esc(sources.join(" / "))}(〜2026-09 は週次、2026-09-25 申込分から JPX の日次)。</p>`;
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
  function tabAi(d, cur) {
    const r = cur.row || {};
    const models = ["CURRENT", "GBM", "DNN"];
    const now = STOCK_HORIZONS.map((h) => ({ h, p: r.periods?.[String(h)] })).filter((x) => x.p);
    const nowTable = now.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>期限</th><th>主役</th><th>予測(期間VWAP)</th><th>騰落</th>${models.map((m) => `<th>${m}</th>`).join("")}<th>Claude</th><th>68%</th><th>90%</th><th>上抜け確率</th><th>下抜け確率</th></tr></thead><tbody>${now.map(({ h, p }) => `<tr><th>${esc(horizonLabel(h))}</th><td>${esc(p.adopted || "")}</td><td>${fmtPrice(p.price)}</td><td class="${cls(p.return)}">${pct(p.return)}</td>${models.map((m) => `<td class="${cls(p.models?.[m]?.return)}">${pct(p.models?.[m]?.return)}</td>`).join("")}<td class="${cls(p.claude?.return)}">${p.claude ? pct(p.claude.return) : "—"}</td><td><small>${fmtPrice(p.low68)}〜${fmtPrice(p.high68)}</small></td><td><small>${fmtPrice(p.low90)}〜${fmtPrice(p.high90)}</small></td><td>${num(p.touchUp) === null ? "—" : `${(p.touchUp * 100).toFixed(0)}%`}</td><td>${num(p.touchDown) === null ? "—" : `${(p.touchDown * 100).toFixed(0)}%`}</td></tr>`).join("")}</tbody></table></div>` : empty("この銘柄の現在の予測はありません。");
    const hist = d.research?.predictions || []; const hs = [...new Set(hist.map((p) => p[1]))].sort((a, b) => a - b); const H = hs.includes(S.aiH) ? S.aiH : (hs.includes(20) ? 20 : hs[0]);
    const preds = hist.filter((p) => p[1] === H); const settled = preds.filter((p) => num(p[7]) !== null); const hit = settled.filter((p) => Math.sign(p[3]) === Math.sign(p[7])).length;
    const histTable = preds.length ? `<div class="row-head"><h3>保存済み予測の履歴(${H}日先)</h3>${seg(hs.map((h) => [String(h), `${h}日`]), String(H), "aih")}<small>${settled.length ? `方向一致 ${hit}/${settled.length}` : "確定待ち"}</small></div><div class="table-wrap tall"><table class="grid"><thead><tr><th>基準日</th><th>採用</th><th>採用予測</th><th>CURRENT</th><th>GBM</th><th>DNN</th><th>実績</th><th>基準日終値</th></tr></thead><tbody>${preds.slice().reverse().map((p) => `<tr><th>${esc(p[0])}</th><td>${esc(p[2] || "")}</td><td class="${cls(p[3])}">${pct(p[3], 2)}</td><td>${pct(p[4], 2)}</td><td>${pct(p[5], 2)}</td><td>${pct(p[6], 2)}</td><td class="${cls(p[7])}">${num(p[7]) === null ? "確定待ち" : pct(p[7], 2)}</td><td>${fmtPrice(p[8])}</td></tr>`).join("")}</tbody></table></div>` : "";
    return `<div class="row-head"><h3>現在の AI 予測</h3><small>${esc(String(S.dash.asOf || "").slice(0, 16))} 時点 · 予測の対象は期間 VWAP</small></div>${nowTable}${histTable}`;
  }
  function tabSaved(d, cur) {
    const have = ARCHIVE_SOURCES.filter(([k]) => cur.archives?.[k]);
    if (!have.length) return `<div class="empty">この銘柄の保存データはまだありません。<br><small>GitHub Actions の「Kabutan weekly」(毎週の株探)・「IRBANK archive」(一度きり)を実行すると、ここに信用残の履歴やページの表が入ります(「保存データ」ページを参照)。</small></div>`;
    const srcKey = have.some(([k]) => k === S.savedSrc) ? S.savedSrc : have[0][0];
    const srcLabel = { kabutan: "株探", irbank: "IRBANK" }[srcKey];
    const a = cur.archives[srcKey];
    const pages = a.pages || [];
    const sel = pages.find((p) => p.name === S.irPage) || pages.find((p) => p.name === "margin") || pages[0];
    const tables = (sel?.tables || []).map((t, i) => `<div class="row-head"><h3>${esc(t.title || `表 ${i + 1}`)}</h3><small>${t.rows.length}行</small></div><div class="table-wrap tall"><table class="grid left">${t.headers?.length ? `<thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : ""}<tbody>${t.rows.slice(0, 2000).map((r) => `<tr>${r.map((c, j) => (j === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`).join("");
    const used = cur.credit.filter((r) => r.source === `${srcLabel}保存`).length;
    return `<div class="row-head">${seg(ARCHIVE_SOURCES.map(([k, l]) => [k, `${l.replace("保存", "")}${cur.archives?.[k] ? "" : "(なし)"}`]), srcKey, "savedsrc")}<h3>${esc(srcLabel)} 保存分(${esc(String(a.fetchedAt || "").slice(0, 16).replace("T", " "))} 取得)</h3>${seg(pages.map((p) => [p.name, `${p.label || p.name}${p.status && p.status !== 200 ? ` (${p.status})` : ""}`]), sel?.name, "irpage")}</div>
      ${a.margin?.length ? `<p class="foot">信用残の履歴 ${a.margin.length} 回(${esc(a.margin[0].date)}〜${esc(a.margin.at(-1).date)})。このうち stockAI に無い日付の ${used} 回を「信用残」タブとチャートにつないでいます(同じ日付は stockAI を優先)。</p>` : ""}
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
      const est = d && c ? SRCredit.estimateCredit(d.credit, c.prices, c.splits, { method }) : { rows: [] };
      const rows = est.rows; const last = rows.at(-1) || null; const price = c?.prices.at(-1)?.c ?? p.close;
      return {
        code: p.code, name: p.name, industry: p.industry, close: price, chg: num(p.change1d), ai20: ai20(p), rank: p.rank,
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
      $("#rankMethod").addEventListener("change", () => { S.rank = computeRank(S.rankData); drawRankTable(); drawRankAgg(); });
      table.addEventListener("click", (e) => { const th = e.target.closest("th[data-sort]"); if (th) { const k = th.dataset.sort; RK.desc = RK.sort === k ? !RK.desc : true; RK.sort = k; drawRankTable(); return; } const b = e.target.closest("[data-code]"); if (b) goChart(b.dataset.code); });
    }
    if (S.rank) { drawRankTable(); return; }
    table.innerHTML = '<tbody><tr><td class="muted pad">全銘柄の信用残と株価を読み込んでいます…(初回は十数MBの復号があります)</td></tr></tbody>';
    try { S.rankData = await loadRankData(); } catch (e) { table.innerHTML = `<tbody><tr><td class="pad">読み込めませんでした: ${esc(e.message)}</td></tr></tbody>`; return; }
    S.rank = computeRank(S.rankData); drawRankTable(); drawRankAgg();
  }
  const RANK_COLS = [
    ["code", "銘柄", (x) => `<button type="button" class="link" data-code="${esc(x.code)}"><b>${esc(x.code)}</b> ${esc(x.name || "")}</button><small>${esc(x.industry || "")}</small>`, "s"],
    ["close", "終値", (x) => fmtPrice(x.close)], ["chg", "前日比", (x) => pctCell(x.chg, 2)], ["ai20", "AI 20日", (x) => pctCell(x.ai20)],
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
  const EXPORT_RE = /輸出|輸入|貿易|出荷|受注|月次売上|売上高|TSMC|SEAJ|JEITA|工作機械|半導体|export|shipment|order/i;
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
      <p class="foot">${tS ? `${esc(it.tName || "")}の推移。水準は最新 ${fmt(it.last, 2)}(前回 ${fmt(it.prior, 2)})。` : "水準の推移。"}${it.forecast?.h1 ? ` 簡易予測(${esc(it.forecast.model || "")}): 次回 ${esc(it.forecast.h1.date || "")} ${fmt(["yoy", "chg"].includes(it.transform) ? num(it.forecast.h1.v) * 100 : it.forecast.h1.v, 2)}${["yoy", "chg"].includes(it.transform) ? "%" : ""}。` : ""}</p>
      ${rel ? `<div class="read"><b>最新の発表(${esc(rel.period || "")})</b><p>結果 ${esc(rel.value ?? "—")}${esc(rel.unit || "")} · 前回 ${esc(rel.prior ?? "—")} · 予想 ${esc(rel.consensus ?? "—")} · 発表 ${esc(rel.released_at || "—")}</p>${rel.note ? `<p>${esc(rel.note)}</p>` : ""}</div>` : ""}
      ${it.comment ? `<div class="read"><b>コメント</b><p>${esc(it.comment)}</p></div>` : ""}
      <div class="learn">${box("何を測るデータか", it.measures)}${box("なぜ株に効くか", it.why)}${box("上がると", it.readUp)}${box("下がると", it.readDown)}${box("関係する日本株", it.jp)}${box("落とし穴", it.pitfalls)}</div></section>`;
  }
  function mxExport() {
    const e = S.econ; if (!e || e.error) return empty("経済指標(econ.json)を読めませんでした。");
    const items = (e.series || []).filter((it) => EXPORT_RE.test(`${it.name} ${it.measures || ""} ${it.key || ""}`));
    const rel = (e.releases || []).filter((r) => EXPORT_RE.test(`${r.name || ""} ${r.indicator || ""} ${r.note || ""}`));
    const sel = items.find((it) => it.id === MX.sel);
    return `<p class="foot">輸出・出荷・受注・月次売上に関係する指標(韓国の輸出、TSMC の月次売上、SEAJ・JEITA、工作機械受注など)を抜き出しています。財務省の貿易統計は「貿易統計」タブ。</p>${econDetail(sel)}${items.length ? econCards(items) : empty("該当する指標がまだありません。")}
      ${rel.length ? `<div class="row-head"><h3>発表データ(Claude の定期タスクが拾ったもの)</h3></div><div class="table-wrap"><table class="grid left"><thead><tr><th>指標</th><th>期間</th><th>結果</th><th>前回</th><th>予想</th><th>発表</th><th>メモ</th></tr></thead><tbody>${rel.slice().reverse().map((r) => `<tr><th>${esc(r.name || r.indicator || "")}</th><td>${esc(r.period || "")}</td><td>${esc(r.value ?? "—")}${esc(r.unit || "")}</td><td>${esc(r.prior ?? "—")}</td><td>${esc(r.consensus ?? "—")}</td><td>${esc(r.released_at || "")}</td><td><small>${esc(r.note || "")}</small></td></tr>`).join("")}</tbody></table></div>` : ""}`;
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
      <li>GitHub のこのリポジトリの <b>Settings → Secrets and variables → Actions</b> に <code>FS_PAGES_PASSWORD</code>(このページと同じパスワード)を登録。</li>
      <li><b>株探(これからの定期取得)</b>: <b>Actions → Kabutan weekly</b>。毎週水曜の朝に自動で、全銘柄の信用残(週次)と銘柄トップを取り、信用残の履歴を積み増します。初回は Run workflow で <code>mode=full</code> にすると、信用残の過去ページ・決算・大株主などもまとめて取ります。</li>
      <li><b>IRBANK(今回だけ)</b>: <b>Actions → IRBANK archive</b>。使えなくなる前に、信用残・空売り・貸借などの個別ページを一度だけ全部保存します。1回は約5時間で区切り、全銘柄そろうまで毎日続きを取り、そろった後は IRBANK に接続しません(不要になったらワークフローを無効にしてかまいません)。</li>
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
