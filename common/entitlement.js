// common/entitlement.js
// 依存: api.js の authFetchJSON もしくは fetch で Authorization が付く仕組み

async function getMe() {
  // 既存の authFetchJSON がある想定。無ければ fetch に置換してください。
  if (typeof authFetchJSON === "function") {
    return await authFetchJSON("/api/me");
  }
  // fallback
  const t = localStorage.getItem("authToken");
  const r = await fetch("/api/me", {
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {})
    }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("me_failed"), { status: r.status, body: j });
  return j;
}

function ensurePaywallStyles() {
  if (document.getElementById("paywallStyles")) return;
  const s = document.createElement("style");
  s.id = "paywallStyles";
  s.textContent = `
    .paywall-overlay{
      position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      padding:16px;
    }
    .paywall-card{
      width:min(560px, 100%);
      background:#fff; border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,.25);
      padding:18px 18px 14px;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif;
    }
    .paywall-title{ font-size:18px; font-weight:700; margin:0 0 8px; }
    .paywall-text{ font-size:14px; line-height:1.6; margin:0 0 12px; color:#333; }
    .paywall-actions{ display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
    .paywall-btn{
      border:0; border-radius:10px; padding:10px 12px; cursor:pointer;
      font-weight:700; font-size:14px;
    }
    .paywall-primary{ background:#111; color:#fff; }
    .paywall-ghost{ background:#f2f2f2; color:#111; }
    .paywall-badge{
      display:inline-block; font-size:12px; font-weight:700;
      background:#f2f2f2; padding:4px 8px; border-radius:999px; margin-bottom:10px;
    }
  `;
  document.head.appendChild(s);
}

function fmtRemaining(ent) {
  const sec = ent?.remainingSeconds;
  if (typeof sec !== "number") return null;
  if (sec <= 0) return "期限切れ";
  const days = Math.floor(sec / 86400);
  if (days >= 1) return `残り ${days} 日`;
  const hours = Math.floor(sec / 3600);
  if (hours >= 1) return `残り ${hours} 時間`;
  const mins = Math.floor(sec / 60);
  return `残り ${Math.max(1, mins)} 分`;
}

function showUpsellModal({ mode, ent, onUpgrade, onClose }) {
  ensurePaywallStyles();

  const overlay = document.createElement("div");
  overlay.className = "paywall-overlay";

  const card = document.createElement("div");
  card.className = "paywall-card";

  const badge = document.createElement("div");
  badge.className = "paywall-badge";

  const title = document.createElement("h2");
  title.className = "paywall-title";

  const text = document.createElement("p");
  text.className = "paywall-text";

  const actions = document.createElement("div");
  actions.className = "paywall-actions";

  const btnUpgrade = document.createElement("button");
  btnUpgrade.className = "paywall-btn paywall-primary";
  btnUpgrade.textContent = "有料プランへ";

  const btnLater = document.createElement("button");
  btnLater.className = "paywall-btn paywall-ghost";
  btnLater.textContent = "後で";

  const remaining = fmtRemaining(ent);

  if (mode === "blocked") {
    badge.textContent = "利用期限が切れました";
    title.textContent = "この機能を利用するにはプランの更新が必要です";
    text.textContent = "無料利用期間が終了しました。有料プランに切り替えると、引き続きご利用いただけます。";
  } else {
    badge.textContent = "無料期間のご案内";
    title.textContent = "無料期間が終了する前にご確認ください";
    text.textContent = `無料利用期間中です。${remaining ? remaining + "。" : ""} 継続利用する場合は有料プランをご検討ください。`;
  }

  btnUpgrade.onclick = () => {
    try { onUpgrade?.(); } finally {}
  };

  if (mode === "blocked") {
    // 強制ブロック：閉じられない
    actions.appendChild(btnUpgrade);
  } else {
    btnLater.onclick = () => {
      overlay.remove();
      onClose?.();
    };
    actions.appendChild(btnLater);
    actions.appendChild(btnUpgrade);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        onClose?.();
      }
    });
  }

  card.appendChild(badge);
  card.appendChild(title);
  card.appendChild(text);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  return overlay;
}

/**
 * これを各ページで1回呼ぶ。
 * - 期限切れなら強制ブロック（閉じられない）
 * - 期限間近なら任意ポップアップ（閉じられる）
 */
export async function initEntitlementGate(opts = {}) {
  const {
    // 例: () => location.href = "/pricing.html"
    onUpgrade = () => { location.href = "/pricing.html"; },

    // 期限間近ポップアップを「1日1回」にしたい場合
    throttleKey = "upsell_last_shown_at",
    throttleHours = 24,
  } = opts;

  let me;
  try {
    me = await getMe();
  } catch (e) {
    // 未ログイン等はここで止めない（各アプリ仕様に合わせて）
    return { ok: false, error: e };
  }

  const ent = me?.entitlement;
  if (!ent) return { ok: false, error: "no_entitlement" };

  // 強制ブロック
  if (!ent.canUseApp) {
    showUpsellModal({
      mode: "blocked",
      ent,
      onUpgrade,
    });
    return { ok: true, blocked: true, me };
  }

  // 任意ポップアップ（trial_expiring_soon のとき）
  if (ent.showUpsellPopup && ent.popupType === "trial_expiring_soon") {
    // 1日1回制御（任意）
    const last = Number(localStorage.getItem(throttleKey) || "0");
    const now = Date.now();
    const okToShow = !last || (now - last) > (throttleHours * 3600 * 1000);

    if (okToShow) {
      localStorage.setItem(throttleKey, String(now));
      showUpsellModal({
        mode: "soft",
        ent,
        onUpgrade,
      });
    }
  }

  return { ok: true, blocked: false, me };
}
