// Stock Rank — データの取得と復号
//
// stockAI(Future Sight)の公開データは AES-GCM で暗号化されている(gate.js と同じ形式:
//   PBKDF2-SHA256(パスワード, enc-meta.json の salt, iter) → AES-256-GCM / 先頭12バイトが IV / 中身は gzip した JSON)。
// このページは同じパスワードで Future Sight のデータを直接読み、Stock Rank 独自の保存データ(IRBANK アーカイブ)も同じ鍵で読む。
// 同じ github.io のオリジンなら、Future Sight で「この端末で覚える」にした鍵をそのまま使える。
(function (root) {
  "use strict";
  const FS_REPO = "future.insight.stockAI.si";
  const FS_OWNER = "closeai-astra";

  function fsBases() {
    const { hostname, origin } = location;
    const list = [];
    if (hostname.endsWith(".github.io") || hostname === "localhost" || hostname === "127.0.0.1") list.push(`${origin}/${FS_REPO}/`);
    if (!hostname.endsWith(".github.io")) list.push(`https://${FS_OWNER}.github.io/${FS_REPO}/`);
    list.push(`https://raw.githubusercontent.com/${FS_OWNER}/${FS_REPO}/main/`);
    return [...new Set(list)];
  }

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const OWN_STORE = "stockrank-key";

  const state = { base: null, meta: null, key: null };
  const cache = new Map();

  async function fetchWithTimeout(url, ms = 30000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { cache: "no-cache", signal: ctl.signal }); } finally { clearTimeout(t); }
  }

  // 使える配信元を順に試し、enc-meta.json が読めた所を使う
  async function loadMeta() {
    let lastErr = null;
    for (const base of fsBases()) {
      try {
        const r = await fetchWithTimeout(`${base}enc-meta.json`, 15000);
        if (!r.ok) { lastErr = new Error(`${base} (${r.status})`); continue; }
        state.meta = await r.json(); state.base = base; return state.meta;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("enc-meta.json を取得できませんでした");
  }

  async function derive(password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(state.meta.salt), iterations: state.meta.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function decryptBytes(buf, key = state.key) {
    const u = new Uint8Array(buf);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  async function checkKey(key) {
    try { return new TextDecoder().decode(await decryptBytes(b64(state.meta.check), key)) === "future-sight-ok"; } catch { return false; }
  }

  // 保存済みの鍵: Stock Rank 自身のもの → Future Sight の gate.js が保存したもの(同一オリジンのとき)
  async function tryStoredKeys() {
    for (const storeName of ["sessionStorage", "localStorage"]) {
      let store; try { store = root[storeName]; if (!store) continue; } catch { continue; }
      const names = [];
      try { for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k === OWN_STORE || k.startsWith("fs-pages-key:")) names.push(k); } } catch { continue; }
      names.sort((a, b) => (a === OWN_STORE ? -1 : b === OWN_STORE ? 1 : 0));
      for (const k of names) {
        try {
          const saved = JSON.parse(store.getItem(k) || "null");
          if (!saved || saved.salt !== state.meta.salt) continue;
          const key = await crypto.subtle.importKey("raw", b64(saved.raw), { name: "AES-GCM" }, false, ["decrypt"]);
          if (await checkKey(key)) { state.key = key; return true; }
        } catch { /* 壊れた保存値は無視 */ }
      }
    }
    return false;
  }

  async function unlock(password, remember) {
    const key = await derive(password);
    if (!(await checkKey(key))) return false;
    state.key = key;
    try {
      const raw = toB64(await crypto.subtle.exportKey("raw", key));
      (remember ? localStorage : sessionStorage).setItem(OWN_STORE, JSON.stringify({ salt: state.meta.salt, raw }));
    } catch { /* 保存できない環境では毎回入力 */ }
    return true;
  }
  function forget() { try { localStorage.removeItem(OWN_STORE); sessionStorage.removeItem(OWN_STORE); } catch { /* */ } }

  async function getEnc(url) {
    const r = await fetchWithTimeout(url);
    if (!r.ok) { const e = new Error(`取得失敗 ${url} (${r.status})`); e.status = r.status; throw e; }
    return JSON.parse(new TextDecoder().decode(await decryptBytes(await r.arrayBuffer())));
  }
  // 同じ URL の同時取得は1本にまとめる。失敗は保存しない
  function cached(url) {
    if (!cache.has(url)) cache.set(url, getEnc(url).catch((e) => { cache.delete(url); throw e; }));
    return cache.get(url);
  }
  // Future Sight 側: fs("dashboard") → data/dashboard.json.enc
  const fs = (name) => cached(`${state.base}data/${name}.json.enc`);
  // Stock Rank 側(このリポジトリの data/)
  const own = (name) => cached(new URL(`data/${name}.json.enc`, document.baseURI).href);

  async function chartDoc(code) {
    const index = await fs("chart-index"); const chunk = index?.[code];
    if (!chunk) return null;
    const bundle = await fs(`chart-chunks/${encodeURIComponent(chunk)}`);
    return bundle?.[code] || null;
  }
  async function detailDoc(code) {
    const index = await fs("stock-detail-index"); const chunk = index?.[code];
    if (!chunk) return null;
    const bundle = await fs(`stock-detail/${encodeURIComponent(chunk)}`);
    return bundle?.[code] || null;
  }
  // Future Sight と同じ形にほどく: d=[[日付,始,高,安,終,出来高]], w=週足(日足より古い期間), p=予測の履歴, s=分割
  function decodeChart(doc) {
    if (!doc) return { daily: [], weekly: [], splits: [] };
    if (Array.isArray(doc)) return { daily: doc, weekly: [], splits: [] };
    const row = (a) => ({ d: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] });
    return { daily: (doc.d || []).map(row), weekly: (doc.w || []).map(row), splits: Array.isArray(doc.s) ? doc.s : [], preds: doc.p || {} };
  }
  // 全銘柄の一括読み込み(ランキング用)。数十MBになるので cache に置かず、pick で必要な所だけ残す
  async function allChunks(kind, pick, onProgress) {
    const index = await fs(kind === "chart" ? "chart-index" : "stock-detail-index");
    const chunks = [...new Set(Object.values(index || {}))].sort();
    let done = 0; const out = {};
    const queue = chunks.slice();
    const worker = async () => {
      while (queue.length) {
        const c = queue.shift();
        try {
          const bundle = await getEnc(`${state.base}data/${kind === "chart" ? "chart-chunks" : "stock-detail"}/${encodeURIComponent(c)}.json.enc`);
          Object.entries(bundle || {}).forEach(([code, doc]) => { out[code] = pick(doc, code); });
        } catch (e) { console.warn(e); }
        done++; onProgress?.(done, chunks.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }

  root.SRData = { loadMeta, tryStoredKeys, unlock, forget, fs, own, chartDoc, detailDoc, decodeChart, allChunks, get base() { return state.base; }, get meta() { return state.meta; } };
})(window);
