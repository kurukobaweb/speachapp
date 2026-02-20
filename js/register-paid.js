// /js/register-paid.js — 有料プラン最初から登録用（登録→自動ログイン→pay.htmlへ）
// ベース：register.js（3ステップ：メール認証→コード確認→本登録）
// 差分：本登録成功後に login.html ではなく pay.html に遷移（planも引き継ぎ）

import api from './api.js';

(() => {
  "use strict";

  // ===== 要素 =====
  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  const step3 = document.getElementById("step3");

  const emailForVerif = document.getElementById("emailForVerif");
  const sendCodeBtn   = document.getElementById("sendCodeBtn");
  const step1Error    = document.getElementById("step1Error");

  const codeInput     = document.getElementById("codeInput");
  const verifyCodeBtn = document.getElementById("verifyCodeBtn");
  const step2Error    = document.getElementById("step2Error");

  const regName      = document.getElementById("regName");
  const regAff       = document.getElementById("regAff");
  const regPwd       = document.getElementById("regPwd");
  const regPwdC      = document.getElementById("regPwdC");
  const regSubmitBtn = document.getElementById("regSubmitBtn");
  const step3Error   = document.getElementById("step3Error");

  const cancelBtns = Array.from(document.querySelectorAll('#regCancelBtn, .reg-cancel'));
  const stepperItems = Array.from(document.querySelectorAll(".stepper li"));
  const statusText   = document.getElementById("regStatus");

  let emailVerified = false;
  let inFlight = false;

  // ===== 有料プランID（pay.html に渡す）=====
  // 例：register-paid.html?plan=pro_monthly
  const planId = (new URLSearchParams(location.search).get("plan") || "pro_monthly").trim();

  // ===== toggleeye 初期化 =====
  function initToggles() {
    if (typeof window.initEyeToggle === "function") {
      try { window.initEyeToggle(); } catch {}
    } else {
      document.querySelectorAll(".toggle-eye").forEach(btn => {
        const id = btn.getAttribute("data-target");
        const input = id ? document.getElementById(id) : null;
        if (!input) return;
        if (btn.dataset.bound === "1") return;
        btn.dataset.bound = "1";
        const toggle = () => { input.type = (input.type === "password" ? "text" : "password"); };
        btn.setAttribute("role","button");
        btn.setAttribute("tabindex","0");
        btn.addEventListener("click", toggle);
        btn.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
      });
    }
  }

  // ===== ユーティリティ =====
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const setErr = (el,msg) => { if (el) el.textContent = msg || ""; };
  const focusSel = el => { if (!el) return; el.focus(); if (el.select) el.select(); };
  const show = el => { if (el) el.style.display = ""; };
  const hide = el => { if (el) el.style.display = "none"; };
  function setActiveStep(n){
    if (!stepperItems.length) return;
    stepperItems.forEach(li => li.classList.toggle("is-active", String(li.dataset.step) === String(n)));
  }
  const setStatus = txt => { if (statusText) statusText.textContent = txt; };
  const guard = fn => async (...a) => {
    if (inFlight) return;
    inFlight = true;
    try { await fn(...a); } finally { inFlight = false; }
  };

  // ===== STEP1: 認証コード送信 =====
  sendCodeBtn?.addEventListener("click", guard(async () => {
    setErr(step1Error, "");
    const email = (emailForVerif?.value || "").trim();
    if (!email) { setErr(step1Error, "メールアドレスを入力してください"); focusSel(emailForVerif); return; }
    if (!emailRe.test(email)) { setErr(step1Error, "メールアドレスの形式が正しくありません"); focusSel(emailForVerif); return; }

    try {
      sendCodeBtn.disabled = true;
      await api.post("/api/register/email", { email });
      hide(step1); show(step2);
      setActiveStep(2); setStatus("コード確認");
      focusSel(codeInput);
    } catch (e) {
      setErr(step1Error, e?.body?.error || e?.message || "認証コード送信に失敗しました");
    } finally {
      sendCodeBtn.disabled = false;
    }
  }));
  emailForVerif?.addEventListener("keydown", e => {
    if (e.key === "Enter"){ e.preventDefault(); sendCodeBtn?.click(); }
  });

  // ===== STEP2: コード照合 =====
  verifyCodeBtn?.addEventListener("click", guard(async () => {
    setErr(step2Error, "");
    const code  = (codeInput?.value || "").trim();
    const email = (emailForVerif?.value || "").trim();

    if (!/^\d{6}$/.test(code)) {
      setErr(step2Error,"6桁の数字を入力してください");
      focusSel(codeInput);
      return;
    }

    try {
      verifyCodeBtn.disabled = true;
      await api.post("/api/register/verify", { email, code });
      emailVerified = true;

      hide(step2); show(step3);
      setActiveStep(3); setStatus("本登録");
      focusSel(regName);
      initToggles(); // STEP3 を開いた直後に
    } catch(e) {
      setErr(step2Error, e?.body?.error || e?.message || "認証コードが違います");
    } finally {
      verifyCodeBtn.disabled = false;
    }
  }));
  codeInput?.addEventListener("keydown", e => {
    if (e.key === "Enter"){ e.preventDefault(); verifyCodeBtn?.click(); }
  });

  // ===== STEP3: 本登録（有料版：登録→自動ログイン→pay.html）=====
  regSubmitBtn?.addEventListener("click", guard(async () => {
    setErr(step3Error, "");
    if (!emailVerified){
      setErr(step3Error, "メール認証を先に完了してください");
      return;
    }

    const name  = (regName?.value || "").trim();
    const aff   = (regAff?.value  || "").trim();
    const pwd   = regPwd?.value || "";
    const pwdC  = regPwdC?.value || "";
    const email = (emailForVerif?.value || "").trim();

    if (!name){ setErr(step3Error,"名前を入力してください"); focusSel(regName); return; }
    if (!aff){  setErr(step3Error,"所属を入力してください"); focusSel(regAff); return; }
    if (pwd.length < 8){ setErr(step3Error,"パスワードは8文字以上にしてください"); focusSel(regPwd); return; }
    if (pwd !== pwdC){   setErr(step3Error,"パスワードが一致しません"); focusSel(regPwdC); return; }

    try {
      regSubmitBtn.disabled = true;

      // 1) ユーザー作成
      await api.post("/api/users", {
        email,
        name,
        affiliation: aff,
        password: pwd,
        verification: true
      });

      // 2) 自動ログイン（authToken を保存）
      //    ※バックエンドが token を返す前提（あなたのlogin実装に合わせて調整）
      const loginRes = await api.post("/api/login", { email, password: pwd });
      const token = loginRes?.token || loginRes?.access_token || loginRes?.authToken;
      if (token) localStorage.setItem("authToken", token);

      // 3) 支払い開始ページへ（共通ページ）
      //    plan を引き継いで pay.html 側が Checkout Session を作成→Stripeへリダイレクト
      const q = new URLSearchParams();
      q.set("plan", planId || "pro_monthly");
      location.href = `/pay.html?${q.toString()}`;

    } catch(e) {
      setErr(step3Error, e?.body?.error || e?.message || "登録に失敗しました");
    } finally {
      regSubmitBtn.disabled = false;
    }
  }));
  [regName, regAff, regPwd, regPwdC].forEach(el => {
    el?.addEventListener("keydown", e => {
      if (e.key === "Enter"){ e.preventDefault(); regSubmitBtn?.click(); }
    });
  });

  // ===== キャンセル =====
  // register-paid は「最初から有料」導線なので、キャンセルは login.html に戻す（必要なら howto.html に変えてOK）
  cancelBtns.forEach(btn => btn.addEventListener("click", () => {
    window.location.href = "login.html";
  }));

  // ===== 初期表示 =====
  setActiveStep(1);
  setStatus("認証");
  initToggles();
})();
