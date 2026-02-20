// forgot-password.js（完全版 / api.js非依存）

import api from './api.js';

(() => {
  "use strict";

  const form = document.querySelector("#forgotForm");
  const emailEl = document.querySelector("#email");
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

  async function postJSON(path, body) {
    const url = API_BASE.replace(/\/$/, "") + path;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });

    // 失敗時でも本文がJSONで返る前提（PHP側も json_out で統一）
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok) {
      const err = data || { error: "http_error", status: res.status, body: text };
      throw err;
    }
    return data || {};
  }

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (emailEl?.value || "").trim();
    if (!email) return setMsg("メールアドレスを入力してください。", "error");

    setMsg("送信中...", "info");

    try {
      await postJSON("/api/password/forgot", { email });
      // セキュリティ的に「存在する/しない」を出さない運用なら、この文言で固定が安全
      setMsg("再設定メールを送信しました。受信箱をご確認ください。", "ok");
      form.reset();
    } catch (err) {
      console.error(err);
      const code = err?.error || "unknown";
      if (code === "too_many_requests") {
        setMsg("短時間に送信しすぎです。しばらく待ってから再試行してください。", "error");
      } else if (code === "missing_fields") {
        setMsg("入力内容を確認してください。", "error");
      } else {
        setMsg("送信に失敗しました。時間を置いて再試行してください。", "error");
      }
    }
  });
})();
