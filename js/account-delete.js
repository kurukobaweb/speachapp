import api from "./api.js";

(() => {
  const LOGIN_URL = window.LOGIN_URL || "/login.html";
  const PROFILE_URL = window.PROFILE_URL || "/profile.html";

  // 要素
  const form = document.getElementById("deleteForm");
  const usernameEl = document.getElementById("username");
  const emailEl = document.getElementById("email");
  const passEl = document.getElementById("password");

  const warnBox = document.getElementById("warnBox");
  const okBox = document.getElementById("okBox");

  // モーダル
  const termsModal = document.getElementById("termsModal");
  const confirmModal = document.getElementById("confirmModal");

  const chkAgree = document.getElementById("chkAgree");
  const termsWarn = document.getElementById("termsWarn");
  const confirmWarn = document.getElementById("confirmWarn");

  // ボタン
  const btnCancel = document.getElementById("btnCancel");

  const termsClose = document.getElementById("termsClose");
  const termsBack = document.getElementById("termsBack");
  const termsOk = document.getElementById("termsOk");

  const confirmClose = document.getElementById("confirmClose");
  const confirmBack = document.getElementById("confirmBack");
  const confirmDo = document.getElementById("confirmDo");

  // 認証前提（ログインしていないならログインへ）
  const token = localStorage.getItem("authToken");
  if (!token) {
    location.href = LOGIN_URL;
    return;
  }

  function show(el, msg) {
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function openModal(modal) {
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(modal) {
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  // 背景クリックで閉じる（terms/confirm共通）
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.matches(".modal__backdrop[data-close='1']")) {
      const modal = t.closest(".modal");
      if (modal) closeModal(modal);
    }
  });

  btnCancel.addEventListener("click", () => {
    // 仕様：キャンセルは前の画面へ（例：profile）
    location.href = PROFILE_URL;
  });

  // 1段階目：フォーム送信で「規約モーダル」を出す
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    show(warnBox, "");
    show(okBox, "");

    const username = (usernameEl.value || "").trim();
    const email = (emailEl.value || "").trim();
    const password = (passEl.value || "").trim();

    if (!username || !email || !password) {
      show(warnBox, "ユーザー名・メールアドレス・パスワードをすべて入力してください。");
      return;
    }

    // 規約確認へ
    chkAgree.checked = false;
    show(termsWarn, "");
    openModal(termsModal);
  });

  // 規約モーダル操作
  termsClose.addEventListener("click", () => closeModal(termsModal));
  termsBack.addEventListener("click", () => closeModal(termsModal));

  termsOk.addEventListener("click", () => {
    show(termsWarn, "");
    if (!chkAgree.checked) {
      show(termsWarn, "同意チェックが必要です。");
      return;
    }
    closeModal(termsModal);
    show(confirmWarn, "");
    openModal(confirmModal);
  });

  // 最終確認モーダル操作
  confirmClose.addEventListener("click", () => closeModal(confirmModal));
  confirmBack.addEventListener("click", () => closeModal(confirmModal));

  // 削除実行
  confirmDo.addEventListener("click", async () => {
    show(confirmWarn, "");
    confirmDo.disabled = true;

    try {
      const username = (usernameEl.value || "").trim();
      const email = (emailEl.value || "").trim();
      const password = (passEl.value || "").trim();

      // サーバー側で「本人確認（username/email/password一致）」＋削除を実施する
      const res = await api.post("/api/account/delete", { username, email, password });

      if (!res?.ok) {
        // 想定エラー例：invalid_credentials / rate_limited / has_active_subscription など
        const code = res?.error || "delete_failed";
        const msg =
          code === "invalid_credentials" ? "ユーザー名・メールアドレス・パスワードが一致しません。" :
          code === "has_active_subscription" ? "有料プラン利用中のため削除できません（先に解約が必要です）。" :
          "削除に失敗しました。時間をおいて再度お試しください。";

        show(confirmWarn, msg);
        confirmDo.disabled = false;
        return;
      }

      // 成功：ログアウト・トークン破棄・遷移
      closeModal(confirmModal);
      show(okBox, "アカウント削除が完了しました。ログイン画面へ移動します。");

      localStorage.removeItem("authToken");
      // もし他にも保持しているならここで削除
      // localStorage.removeItem("userProfile");
      // localStorage.removeItem("courseCache");

      setTimeout(() => { location.href = LOGIN_URL; }, 600);

    } catch (err) {
      console.error(err);
      show(confirmWarn, "通信エラーが発生しました。ネットワーク状況をご確認ください。");
      confirmDo.disabled = false;
    }
  });
})();
