// Stock Rank — 描画の前に読む小さな処理(CSP でインラインのスクリプトを禁止したので index.html から移した)
(function () {
  "use strict";
  // 他のサイトの枠(iframe)の中で開かれたら中身を出さない(クリックジャッキング対策。GitHub Pages はヘッダーで禁止できないため)
  try {
    if (window.top !== window.self) {
      document.documentElement.style.display = "none";
      try { window.top.location = window.self.location.href; } catch (e) { /* 別のオリジンの枠は移動できない。表示しないままにする */ }
    }
  } catch (e) { document.documentElement.style.display = "none"; }
  // テーマ・サイドバーは Future Sight と同じ保存先(同じ github.io なら両方に効く)。読み込み前に当てて、ちらつきを防ぐ
  try { if (localStorage.getItem("stockrank-sidebar") === "closed") document.documentElement.classList.add("sidebar-closed"); } catch (e) { /* */ }
  try { const t = localStorage.getItem("future-sight-theme"); if (["light", "dark", "prototype", "earth"].includes(t)) document.documentElement.dataset.fsTheme = t; } catch (e) { /* */ }
})();
