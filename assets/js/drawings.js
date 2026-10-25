// Stock Rank — チャートの描画ツール(TradingView 風)。Lightweight Charts の「シリーズ プリミティブ」として主系列に付ける。
//
// 描画は日付と価格で持つ(足を切り替えても同じ位置に出る)。画面の座標への変換は app 側が渡す
//   toX(date) … 日付 → x 座標(未来の日付も概算で置ける)
//   toY(price) … 価格 → y 座標
// 種類: trend(トレンドライン)/ ray(水平レイ)/ hline(水平線)/ vline(垂直線)/ rect(長方形)/
//       fib(フィボナッチ・リトレースメント)/ measure(計測・保存しない)/ text(テキスト)
(function (root) {
  "use strict";
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const FIB_COLORS = ["#787b86", "#f23645", "#ff9800", "#4caf50", "#089981", "#00bcd4", "#787b86"];

  class DrawingLayer {
    constructor(opts) {
      this.opts = opts; // { toX, toY, fmt(price), color() }
      this.items = []; this.preview = null; this.selected = -1; this.hidden = false;
      this._view = { zOrder: () => "top", renderer: () => ({ draw: (target) => this._draw(target) }) };
    }
    attached({ requestUpdate }) { this._req = requestUpdate; }
    detached() { this._req = null; }
    update() { this._req?.(); }
    updateAllViews() {}
    paneViews() { return [this._view]; }
    // 水平線・水平レイの価格を価格軸にラベルで出す(TradingView と同じ)
    priceAxisViews() {
      if (this.hidden) return [];
      return this.items.map((it, i) => ({ it, i })).filter(({ it }) => it.type === "hline" || it.type === "ray").map(({ it, i }) => ({
        coordinate: () => this.opts.toY(it.a.p) ?? -100, text: () => this.opts.fmt(it.a.p), textColor: () => "#ffffff",
        backColor: () => (i === this.selected ? "#2962ff" : it.color || this.opts.color()), visible: () => true, tickVisible: () => true,
      }));
    }
    _pt(a) { const x = this.opts.toX(a.t), y = this.opts.toY(a.p); return x === null || y === null ? null : { x, y }; }

    _draw(target) {
      if (this.hidden) return;
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize: size }) => {
        const all = [...this.items.map((it, i) => ({ it, sel: i === this.selected })), ...(this.preview ? [{ it: this.preview, sel: true, preview: true }] : [])];
        all.forEach(({ it, sel }) => this._drawItem(ctx, size, it, sel));
      });
    }
    _drawItem(ctx, size, it, sel) {
      const color = it.color || this.opts.color();
      ctx.save(); ctx.lineWidth = sel ? 2 : 1.5; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.font = "11px -apple-system, 'Segoe UI', 'Noto Sans JP', sans-serif";
      const A = it.a ? this._pt(it.a) : null, B = it.b ? this._pt(it.b) : null;
      const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      const handle = (p) => { if (!p || !sel) return; ctx.save(); ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#2962ff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); };
      switch (it.type) {
        case "trend": if (A && B) { line(A.x, A.y, B.x, B.y); handle(A); handle(B); } break;
        case "ray": if (A) { line(A.x, A.y, size.width, A.y); handle(A); } break;
        case "hline": if (A) { line(0, A.y, size.width, A.y); handle(A); } break;
        case "vline": { const x = this.opts.toX(it.a.t); if (x !== null) { line(x, 0, x, size.height); if (sel) handle({ x, y: size.height / 2 }); } break; }
        case "rect": if (A && B) { ctx.globalAlpha = 0.15; ctx.fillRect(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(B.x - A.x), Math.abs(B.y - A.y)); ctx.globalAlpha = 1; ctx.strokeRect(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(B.x - A.x), Math.abs(B.y - A.y)); handle(A); handle(B); } break;
        case "fib": if (A && B) {
          const x1 = Math.min(A.x, B.x), x2 = Math.max(A.x, B.x, x1 + 40);
          FIB.forEach((lv, k) => {
            const price = it.b.p + (it.a.p - it.b.p) * lv; const y = this.opts.toY(price); if (y === null) return;
            ctx.strokeStyle = FIB_COLORS[k]; ctx.fillStyle = FIB_COLORS[k]; line(x1, y, x2, y);
            ctx.textAlign = "left"; ctx.fillText(`${lv} (${this.opts.fmt(price)})`, x2 + 4, y + 4);
          });
          ctx.strokeStyle = color; ctx.setLineDash([3, 3]); line(A.x, A.y, B.x, B.y); ctx.setLineDash([]); handle(A); handle(B);
        } break;
        case "measure": if (A && B) {
          const up = it.b.p >= it.a.p; const c = up ? "#2962ff" : "#f23645";
          ctx.fillStyle = c; ctx.globalAlpha = 0.15; ctx.fillRect(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(B.x - A.x), Math.abs(B.y - A.y)); ctx.globalAlpha = 1;
          ctx.strokeStyle = c; line(A.x, (A.y + B.y) / 2, B.x, (A.y + B.y) / 2); line((A.x + B.x) / 2, A.y, (A.x + B.x) / 2, B.y);
          const d = it.b.p - it.a.p, pct = it.a.p ? d / it.a.p * 100 : 0; const bars = this.opts.bars?.(it.a.t, it.b.t);
          const label = `${d >= 0 ? "+" : ""}${this.opts.fmt(d)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)${bars !== null && bars !== undefined ? ` · ${bars}本` : ""}`;
          const w = ctx.measureText(label).width + 14; const lx = (A.x + B.x) / 2 - w / 2, ly = (up ? Math.min(A.y, B.y) - 26 : Math.max(A.y, B.y) + 6);
          ctx.fillStyle = c; ctx.fillRect(lx, ly, w, 20); ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText(label, lx + w / 2, ly + 14);
        } break;
        case "text": if (A) { ctx.font = "13px -apple-system, 'Segoe UI', 'Noto Sans JP', sans-serif"; ctx.textAlign = "left"; ctx.fillText(it.text || "", A.x + 4, A.y - 4); if (sel) { const w = ctx.measureText(it.text || "").width; ctx.strokeRect(A.x, A.y - 20, w + 8, 22); } } break;
      }
      ctx.restore();
    }

    // 画面上の点 (x, y) に一番近い描画の番号(8px 以内)。無ければ -1
    hitTest2(x, y) {
      let best = -1, bestD = 8;
      const segD = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; const L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0; return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); };
      this.items.forEach((it, i) => {
        const A = it.a ? this._pt(it.a) : null, B = it.b ? this._pt(it.b) : null; let d = Infinity;
        if (it.type === "trend" && A && B) d = segD(x, y, A.x, A.y, B.x, B.y);
        if (it.type === "hline" && A) d = Math.abs(y - A.y);
        if (it.type === "ray" && A) d = x >= A.x - 4 ? Math.abs(y - A.y) : Infinity;
        if (it.type === "vline") { const vx = this.opts.toX(it.a.t); if (vx !== null) d = Math.abs(x - vx); }
        if ((it.type === "rect" || it.type === "fib") && A && B) { const inX = x >= Math.min(A.x, B.x) - 4 && x <= Math.max(A.x, B.x) + 4, inY = y >= Math.min(A.y, B.y) - 4 && y <= Math.max(A.y, B.y) + 4; d = inX && inY ? Math.min(Math.abs(x - A.x), Math.abs(x - B.x), Math.abs(y - A.y), Math.abs(y - B.y), it.type === "fib" ? 0 : 99) : Infinity; }
        if (it.type === "text" && A) d = x >= A.x - 4 && x <= A.x + 200 && y >= A.y - 22 && y <= A.y + 4 ? 0 : Infinity;
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    }
  }

  // 何点で描くか
  const POINTS = { trend: 2, ray: 1, hline: 1, vline: 1, rect: 2, fib: 2, measure: 2, text: 1 };
  root.SRDraw = { DrawingLayer, POINTS };
})(window);
