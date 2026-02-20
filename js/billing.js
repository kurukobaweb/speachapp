// /js/billing.js
// 有料プラン登録ページ：月額のみ（年額なし）
// - GET  /api/me                        : ログイン状態/プラン状態取得（必須）
// - GET  /api/plans                     : プラン一覧（無くてもOK。404等はダミーへフォールバック）
// - POST /api/billing/checkout-session  : Stripe Checkout URL 取得 → 遷移
// - POST /api/billing/portal-session    : 請求管理（任意。契約中のみ表示）

const API_BASE  = window.API_BASE  || "";
const LOGIN_URL = window.LOGIN_URL || "/login.html";

const $ = (sel) => document.querySelector(sel);

const els = {
  statusBox: $("#statusBox"),
  errorBox: $("#errorBox"),
  errorText: $("#errorText"),
  successBox: $("#successBox"),
  successText: $("#successText"),

  plansGrid: $("#plansGrid"),

  btnReload: $("#btnReload"),
  btnLogout: $("#btnLogout"),
  btnPortal: $("#btnPortal"),
};

const state = {
  me: null,
  plans: [],
};

// -----------------------------
// UI helpers
// -----------------------------
function setStatus(title, sub) {
  if (!els.statusBox) return;
  const t = els.statusBox.querySelector(".billing__statusTitle");
  const s = els.statusBox.querySelector(".billing__statusSub");
  if (t) t.textContent = title || "";
  if (s) s.textContent = sub || "";
  els.statusBox.hidden = false;
}

function hideStatus() {
  if (!els.statusBox) return;
  els.statusBox.hidden = true;
}

function showError(msg) {
  if (!els.errorBox || !els.errorText) return;
  els.errorText.textContent = msg || "不明なエラーが発生しました。";
  els.errorBox.hidden = false;
}

function clearError() {
  if (!els.errorBox || !els.errorText) return;
  els.errorText.textContent = "";
  els.errorBox.hidden = true;
}

function showSuccess(msg) {
  if (!els.successBox || !els.successText) return;
  els.successText.textContent = msg || "";
  els.successBox.hidden = false;
}

function clearSuccess() {
  if (!els.successBox || !els.successText) return;
  els.successText.textContent = "";
  els.successBox.hidden = true;
}

function yen(n) {
  try { return new Intl.NumberFormat("ja-JP").format(n); }
  catch { return String(n); }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authToken() {
  return localStorage.getItem("authToken") || "";
}

function goLoginSoon(message) {
  hideStatus();
  showError(message || "ログイン情報が見つかりません。ログインしてから再度アクセスしてください。");

  // ログインへのボタンを出したい場合（HTMLに置いてないなら alert の文言で案内）
  const box = document.createElement("div");
  box.style.marginTop = "10px";
  box.innerHTML = `
    <a class="btn" href="${LOGIN_URL}">ログイン画面へ</a>
  `;
  els.errorBox?.appendChild(box);
}


// -----------------------------
// API
// -----------------------------
async function apiFetch(path, opts = {}) {
  const url = path.startsWith("http") ? path : (API_BASE + path);

  const headers = {
    "Accept": "application/json",
    ...(opts.headers || {}),
  };

  // JSON body の場合は Content-Type を付ける
  if (opts.body != null && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const t = authToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(url, { ...opts, headers });

  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data.message || data.error)) ||
      (typeof data === "string" && data) ||
      `${res.status} ${res.statusText}`;

    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function loadMe() {
  return await apiFetch("/api/me", { method: "GET" });
}

// 404でも必ずfallbackする（プランAPI未実装でもUIが動く）
async function loadPlans() {
  try {
    const data = await apiFetch("/api/plans", { method: "GET" });

    // どんな形式でも配列を取り出す（推奨は {plans:[...]}）
    const plans = (data && (data.plans || data.data || data)) || [];
    if (Array.isArray(plans) && plans.length) return plans;

    return fallbackPlans();
  } catch (e) {
    console.warn("[billing] /api/plans unavailable -> fallback:", e?.status, e?.message);
    return fallbackPlans();
  }
}

// UI確認用のダミー（月額のみ）
function fallbackPlans() {
  return [
    {
      key: "pro_monthly",
      name: "Pro",
      billing_cycle: "monthly",
      price_id: "price_xxx_monthly", // ★後でStripeの本物に差し替え
      amount: 1980,
      currency: "jpy",
      desc: "月額。いつでも解約できます。",
      features: ["全機能利用", "学習履歴保存"],
      highlight: "おすすめ",
    },
  ];
}

// -----------------------------
// Render
// -----------------------------
function normalizePlans(plans) {
  return (plans || []).map(p => ({
    key: p.key ?? p.id ?? p.plan_key ?? "",
    name: p.name ?? p.title ?? "プラン",
    billing_cycle: p.billing_cycle ?? p.cycle ?? p.interval ?? "monthly",
    price_id: p.price_id ?? p.stripe_price_id ?? p.priceId ?? "",
    amount: Number(p.amount ?? p.unit_amount ?? 0),
    currency: (p.currency ?? "jpy").toLowerCase(),
    desc: p.desc ?? p.description ?? "",
    features: Array.isArray(p.features) ? p.features : [],
    highlight: p.highlight ?? p.badge ?? "",
  }));
}

function planCardHTML(p) {
  const badge = p.highlight ? `<span class="plan__badge">${escapeHtml(p.highlight)}</span>` : "";
  const desc = p.desc ? `<div class="plan__desc">${escapeHtml(p.desc)}</div>` : "";
  const features = (p.features && p.features.length)
    ? `<ul class="plan__list">${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
    : "";

  const disabled = !p.price_id;
  const btnLabel = disabled ? "準備中" : "支払いへ進む";
  const btnAttr = disabled ? "disabled" : "";

  return `
    <article class="plan">
      <div class="plan__top">
        <div>
          <div class="plan__name">${escapeHtml(p.name)}</div>
          ${desc}
        </div>
        ${badge}
      </div>

      <div class="plan__priceRow">
        <span class="plan__price">¥${yen(p.amount)}</span>
        <span class="plan__period">/ 月</span>
      </div>

      ${features}

      <button class="btn plan__btn"
        type="button"
        data-action="checkout"
        data-price-id="${escapeHtml(p.price_id || "")}"
        ${btnAttr}
      >${btnLabel}</button>
    </article>
  `;
}

function renderPlans() {
  if (!els.plansGrid) return;

  // 年額なし → monthly固定
  const plans = normalizePlans(state.plans).filter(p => p.billing_cycle === "monthly");

  if (!plans.length) {
    els.plansGrid.innerHTML = `
      <div class="alert alert--danger">
        <div class="alert__title">プランがありません</div>
        <div class="alert__text">月額プランが見つかりませんでした。</div>
      </div>
    `;
    return;
  }

  els.plansGrid.innerHTML = plans.map(planCardHTML).join("");

  els.plansGrid.querySelectorAll("[data-action='checkout']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const priceId = btn.dataset.priceId || "";
      await startCheckout(priceId);
    });
  });
}

function disableCheckoutButtons(disabled) {
  document.querySelectorAll("[data-action='checkout']").forEach(b => {
    // 元々 disabled のものは維持
    if (disabled) {
      if (!b.disabled) b.dataset._disabledByFlow = "1";
      b.disabled = true;
    } else {
      if (b.dataset._disabledByFlow === "1") {
        b.disabled = false;
        delete b.dataset._disabledByFlow;
      }
    }
  });
}

// -----------------------------
// Actions
// -----------------------------
async function startCheckout(priceId) {
  clearError();
  clearSuccess();

  if (!authToken()) {
    goLoginSoon("ログイン情報が見つかりません。ログイン画面へ移動します。");
    return;
  }
  if (!priceId) {
    showError("このプランはまだ準備中です（price_id が未設定）。");
    return;
  }

  disableCheckoutButtons(true);

  try {
    setStatus("Stripe 決済ページを準備しています…", "");

    const data = await apiFetch("/api/billing/checkout-session", {
      method: "POST",
      body: JSON.stringify({ price_id: priceId }),
    });

    const url = data?.url || data?.checkout_url;
    if (!url) throw new Error("checkout-session の url が返りませんでした。");

    // Stripe Checkout へ
    location.href = url;
  } catch (e) {
    hideStatus();
    showError(`決済ページの作成に失敗しました：${e.message}`);
    disableCheckoutButtons(false);
  }
}

async function openPortal() {
  clearError();
  clearSuccess();

  try {
    setStatus("請求管理ページを準備しています…", "");
    const data = await apiFetch("/api/billing/portal-session", { method: "POST" });
    const url = data?.url;
    if (!url) throw new Error("portal-session の url が返りませんでした。");
    location.href = url;
  } catch (e) {
    hideStatus();
    showError(`請求管理ページを開けませんでした：${e.message}`);
  }
}

function logout() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");
  location.href = LOGIN_URL;
}

// -----------------------------
// Init
// -----------------------------
async function init() {
  clearError();
  clearSuccess();

  if (!authToken()) {
    goLoginSoon();
    return;
  }

  try {
    setStatus("読み込み中…", "ユーザー情報を確認しています");
    const me = await loadMe();
    state.me = me;

    // すでに契約中なら「請求管理」を表示
    const planStatus = String(me?.plan_status ?? me?.status ?? "").toLowerCase();
    const isActive = (planStatus === "active" || planStatus === "trialing");

    if (isActive) {
      showSuccess("すでに有料プラン契約中です。請求管理からカード変更や解約ができます。");
      if (els.btnPortal) els.btnPortal.hidden = false;
    } else {
      if (els.btnPortal) els.btnPortal.hidden = true;
    }

    setStatus("読み込み中…", "プラン一覧を取得しています");
    state.plans = await loadPlans();

    hideStatus();
    renderPlans();
  } catch (e) {
    hideStatus();

    // 認証系はログインへ
    if (e.status === 401 || e.status === 403) {
      goLoginSoon("ログイン期限が切れました。ログイン画面へ移動します。");
      return;
    }

    // /api/me が無い（404）場合は設計上致命的なので明示
    if (e.status === 404) {
      showError("APIが見つかりません（/api/me）。API_BASE が正しいか、バックエンドに /api/me を実装してください。");
      return;
    }

    showError(`初期化に失敗しました：${e.message}`);
  }
}

// bind events
if (els.btnReload) els.btnReload.addEventListener("click", init);
if (els.btnLogout) els.btnLogout.addEventListener("click", logout);
if (els.btnPortal) els.btnPortal.addEventListener("click", openPortal);

// start
init();
