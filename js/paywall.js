// public/js/paywall.js
// - free期限切れ / 期限間近 のポップアップを表示する
// - openPaywallModal({type, freeUntil, daysLeft})
// - closePaywallModal()

(function () {
  const MODAL_ID = "paywallModal";

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;

    const el = document.createElement("div");
    el.id = MODAL_ID;
    el.style.cssText = [
      "position:fixed",
      "inset:0",
      "display:none",
      "z-index:99999",
    ].join(";");

    el.innerHTML = `
      <div data-backdrop style="
        position:absolute; inset:0;
        background:rgba(0,0,0,.45);
      "></div>

      <div role="dialog" aria-modal="true" style="
        position:relative;
        max-width:520px;
        margin:10vh auto 0;
        background:#fff;
        border-radius:14px;
        box-shadow:0 12px 40px rgba(0,0,0,.25);
        padding:18px 18px 14px;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans JP', sans-serif;
      ">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="font-size:18px; font-weight:700;" id="paywallTitle">ご案内</div>
          <button data-close aria-label="閉じる" style="
            border:none;background:transparent;cursor:pointer;
            font-size:18px;line-height:1;
          ">✕</button>
        </div>

        <div style="margin-top:10px; color:#222; font-size:14px; line-height:1.55;">
          <div id="paywallMessage"></div>
          <div id="paywallMeta" style="margin-top:10px; color:#555; font-size:12.5px;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-top:14px; justify-content:flex-end; flex-wrap:wrap;">
          <button data-later style="
            padding:10px 12px; border-radius:10px;
            border:1px solid rgba(0,0,0,.15);
            background:#fff; cursor:pointer; font-weight:600;
          ">後で</button>

          <a data-upgrade href="#" style="
            display:inline-flex; align-items:center; justify-content:center;
            padding:10px 12px; border-radius:10px;
            border:0; text-decoration:none;
            background:#111; color:#fff; cursor:pointer; font-weight:700;
          ">有料プランを見る</a>
        </div>
      </div>
    `;

    document.body.appendChild(el);

  // ===============================
  // ★ ここに置く（この位置が正解）
  // ===============================
  const LOGIN_URL = window.LOGIN_URL || "/login.html";

  const goLogin = () => {
    closePaywallModal();
    location.href = LOGIN_URL;
  };

  // ===============================
  // event bindings
  // ===============================
el.querySelector("[data-close]")?.addEventListener("click", goLogin);
el.querySelector("[data-later]")?.addEventListener("click", goLogin);
el.querySelector("[data-backdrop]")?.addEventListener("click", goLogin);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") goLogin();
});
  }

  function formatJst(dtStr) {
    if (!dtStr) return "";
    // "YYYY-MM-DD HH:mm:ss" をそのまま見せる（必要なら整形）
    return dtStr.replace("T", " ");
  }

  // 公開API
  window.openPaywallModal = function ({ type = "expired", freeUntil = "", daysLeft = 0, upgradeUrl = "" } = {}) {
    ensureModal();
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const title = modal.querySelector("#paywallTitle");
    const msg = modal.querySelector("#paywallMessage");
    const meta = modal.querySelector("#paywallMeta");
    const upgrade = modal.querySelector("[data-upgrade]");

    // 課金ページURL（あなたのLPやStripe Checkoutなどに差し替え）
    const url = upgradeUrl || window.UPGRADE_URL || "/pricing.html";
    upgrade.setAttribute("href", url);

    if (type === "warning") {
      title.textContent = "無料期間の終了が近いです";
      msg.innerHTML = `
        無料プランは一定期間のみご利用いただけます。<br>
        有料プランへ切り替えると、引き続きご利用いただけます。
      `;
      meta.textContent = daysLeft ? `残り ${daysLeft} 日（期限：${formatJst(freeUntil)}）` : `期限：${formatJst(freeUntil)}`;
    } else {
      title.textContent = "無料期間が終了しました";
      msg.innerHTML = `
        無料期間が終了したため、この機能はご利用いただけません。<br>
        有料プランへ切り替えると、すぐに再開できます。
      `;
      meta.textContent = freeUntil ? `無料期限：${formatJst(freeUntil)}` : "";
    }

    modal.style.display = "block";
  };

  window.closePaywallModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = "none";
  };
})();
