// reset-password.js（完全版 / selector+validator方式 / api.js非依存）
// public/js/reset-password.js
import api from './api.js';


(() => {
  "use strict";

  const form = document.querySelector("#resetForm");
  const passEl = document.querySelector("#password");
  const pass2El = document.querySelector("#password2");
  const msgEl = document.querySelector("#msg");

  const API_BASE =
    window.API_BASE ||
    (window.ENV && window.ENV.API_BASE) ||
    localStorage.getItem("API_BASE") ||
    "http://localhost:8200";

  function setMsg(text, type = "info") {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.dataset.type = type;
  }

  function getParam(name) {
    const u = new URL(location.href);
    return u.searchParams.get(name) || "";
  }

  async function postJSON(path, body) {
    const url = API_BASE.replace(/\/$/, "") + path;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw (data || { error: "http_error", status: res.status, body: text });
    return data || {};
  }

  if (!form) return;

  // メールのリンクは …/reset-password.html?selector=...&validator=...
  const selector = getParam("selector");
  const validator = getParam("validator");

  if (!selector || !validator) {
    setMsg("リンクが不正です（selector / validator がありません）。メールのURLを確認してください。", "error");
    // ここで送信自体も止める
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!selector || !validator) return;

    const password = (passEl?.value || "").trim();
    const password2 = (pass2El?.value || "").trim();

    if (!password || !password2) return setMsg("パスワードを入力してください。", "error");
    if (password !== password2) return setMsg("パスワードが一致しません。", "error");
    if (password.length < 8) return setMsg("パスワードは8文字以上にしてください。", "error");

    setMsg("更新中...", "info");

    try {
      await postJSON("/api/password/reset", { selector, validator, password });
      setMsg("パスワードを更新しました。ログインしてください。", "ok");
      form.reset();
      // 必要ならログインページへ
      // location.href = "./login.html";
    } catch (err) {
      console.error(err);
      const code = err?.error || "unknown";
      if (code === "invalid_token") {
        setMsg("トークンが無効です。再度「パスワードを忘れた」からやり直してください。", "error");
      } else if (code === "expired_token") {
        setMsg("期限切れです。再度「パスワードを忘れた」からやり直してください。", "error");
      } else {
        setMsg("更新に失敗しました。時間を置いて再試行してください。", "error");
      }
    }
  });
})();
