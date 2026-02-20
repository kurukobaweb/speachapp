// /public/js/profile.js（完全版）
// - 未ログイン/トークン不正 → /login.html にリダイレクト
// - JWT payload から userId を取得（uid/userId/id/sub 揺れ対応）
// - /api/users/:id からプロフィール取得してフォームへ反映
// - コース/ロールを h2 右にバッジ表示（courseBadge / roleBadge）
// - course が pro 等のとき「アップグレード」ボタンは非表示
// - 更新（PUT）→ 成功で /index.html へ

import api from "./api.js";

document.addEventListener("DOMContentLoaded", () => {
  const LOGIN_URL = "/login.html";
  const HOME_URL  = "/index.html";

  // =========================
  // 1) トークン確認（未ログイン → login）
  // =========================
  const token = localStorage.getItem("authToken");
  if (!token) {
    window.location.href = LOGIN_URL;
    return;
  }

  // =========================
  // 2) JWT payload デコード（Unicode安全）
  // =========================
  let payload;
  try {
    payload = decodeJwtPayload(token);
  } catch (e) {
    console.warn("トークン解析エラー:", e);
    window.location.href = LOGIN_URL;
    return;
  }

  // JWT のキー揺れに対応（uid / userId / id / sub）
  const userId = String(payload?.uid ?? payload?.userId ?? payload?.id ?? payload?.sub ?? "").trim();
  if (!userId) {
    console.warn("userId がトークンから取得できません。payload=", payload);
    window.location.href = LOGIN_URL;
    return;
  }

  // =========================
  // 3) 要素取得
  // =========================
  const profileError = document.getElementById("profileError");
  const form         = document.getElementById("profileForm");
  const emailInput   = document.getElementById("profileEmail");
  const affInput     = document.getElementById("profileAffiliation");
  const nameInput    = document.getElementById("profileName");
  const pwdInput     = document.getElementById("profilePassword");
  const pwdCfmInput  = document.getElementById("profilePasswordConfirm");
  const cancelBtn    = document.getElementById("profileCancel");

  const courseBadge  = document.getElementById("courseBadge");
  const roleBadge    = document.getElementById("roleBadge");
  const btnPaid      = document.querySelector(".btn-paid");

  // 必須要素が無ければ以降を止める（HTMLのidズレ対策）
  if (!form || !cancelBtn || !emailInput || !nameInput || !affInput || !pwdInput || !pwdCfmInput || !profileError) {
    console.error("[profile] required elements missing. Check profile.html ids.");
    // 画面にも出す（任意）
    const el = document.getElementById("profileError");
    if (el) el.textContent = "画面の読み込みに失敗しました（要素が見つかりません）。";
    return;
  }

  // =========================
  // 4) 読み込み
  // =========================
  async function loadProfile() {
    try {
      const data = await api.get(`/api/users/${encodeURIComponent(userId)}`);

      // APIの返却が {ok:true, user:{...}} でも {...} でも拾えるようにする
      const u = data?.user ?? data ?? {};

      // ---------- course ----------
      const courseRaw = String(u.course_id ?? u.course ?? u.plan ?? u.tier ?? "free").trim().toLowerCase() || "free";

      if (courseBadge) {
        const labelMap = {
          free: "FREE",
          pro: "PRO",
          premium: "PREMIUM",
        };
        courseBadge.textContent = labelMap[courseRaw] ?? courseRaw.toUpperCase();
        courseBadge.hidden = false;
        courseBadge.dataset.course = courseRaw; // CSS色分け用（proを金色など）
      }

      // 有料プランボタン：pro以上（または有料判定）なら非表示
      // ※あなたの運用で「premium」も有料ならこのままでOK
      if (btnPaid) {
        const paidCourses = ["pro", "premium"];
        btnPaid.style.display = paidCourses.includes(courseRaw) ? "none" : "";
      }

      // ---------- role ----------
      const roleRaw = String(u.role ?? u.user_role ?? u.account_role ?? "user").trim().toLowerCase() || "user";

      if (roleBadge) {
        const roleLabelMap = {
          user: "USER",
          teacher: "TEACHER",
          admin: "ADMIN",
          owner: "OWNER",
        };
        roleBadge.textContent = roleLabelMap[roleRaw] ?? roleRaw.toUpperCase();
        roleBadge.hidden = false;
        roleBadge.dataset.role = roleRaw; // CSS色分け用
      }

      // ---------- form fill ----------
      nameInput.value  = (u.display_name || u.name || u.username || "") ?? "";
      emailInput.value = (u.email || u.mail || "") ?? "";
      affInput.value   = (u.affiliation || u.org || u.organization || "") ?? "";

      // Email は基本変更させない（サーバ側も更新してない前提）
      emailInput.readOnly = true;

      profileError.textContent = "";
    } catch (err) {
      const msg =
        (err?.body?.error ||
          err?.body?.message ||
          err?.message ||
          "プロフィール取得に失敗しました");
      profileError.textContent = msg;
      console.error("[profile] loadProfile failed:", err);
    }
  }

  // =========================
  // 5) 更新
  // =========================
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    profileError.textContent = "";

    const affiliation = affInput.value.trim();
    const name = nameInput.value.trim();

    if (!name) {
      profileError.textContent = "名前は必須です";
      return;
    }
    if ((pwdInput.value || pwdCfmInput.value) && pwdInput.value !== pwdCfmInput.value) {
      profileError.textContent = "パスワードが一致しません";
      return;
    }

    // サーバ側の期待キーに合わせる（display_name / affiliation）
    const body = { affiliation, display_name: name };

    if (pwdInput.value) body.password = pwdInput.value;

    try {
      await api.put(`/api/users/${encodeURIComponent(userId)}`, body);
      alert("プロフィールを更新しました");
      window.location.href = HOME_URL;
    } catch (err) {
      const msg =
        (err?.body?.error ||
          err?.body?.message ||
          err?.message ||
          "更新に失敗しました");
      profileError.textContent = msg;
      console.error("[profile] update failed:", err);
    }
  });

  // =========================
  // 6) キャンセル
  // =========================
  cancelBtn.addEventListener("click", () => {
    window.location.href = HOME_URL;
  });

  // =========================
  // 7) 初回ロード
  // =========================
  loadProfile();

  // =========================
  // util: JWT payload decode
  // =========================
  function decodeJwtPayload(jwt) {
    const b64 = (jwt.split(".")[1] || "");
    const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (norm.length % 4)) % 4);
    const bin = atob(norm + pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  }
});
