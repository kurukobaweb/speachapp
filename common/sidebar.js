// /common/sidebar.js — 管理者判定を強化した完全版
(() => {
  "use strict";

  const DEBUG = true; // 必要なければ false

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    const mount = document.getElementById("siteSidebar");
    if (!mount) return;

    const src =
      mount.getAttribute("data-sidebar-src") ||
      "/common/sidebar.html";

    try {
      const res = await fetch(src, { credentials: "include", cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mount.innerHTML = await res.text();
    } catch (e) {
      console.error("Sidebar load failed:", e);
      mount.innerHTML = `<div style="padding:12px;color:#b91c1c;">サイドバーの読み込みに失敗しました</div>`;
      return;
    }

    // 役割を検出して表示制御
    const role = detectCurrentRole();
    if (DEBUG) console.log("[sidebar] detected role:", role);
    applyRoleVisibility(role);
       // 後から追加された data-requires-role 要素にも即時適用
   const mo = new MutationObserver(() => applyRoleVisibility(role));
   mo.observe(mount, { childList: true, subtree: true });
   // グローバルに保持（必要なら停止できるように）
   window.__sidebarRoleObserver = mo;

    // 例：sidebar.js の init() の末尾
    window.__initSidebarMessages && window.__initSidebarMessages();
  }

  /** 役割検出（できるだけ多くの場所を見にいく） */
  function detectCurrentRole() {
    // 0) デバッグ用オーバーライド (?forceRole=admin)
    const q = new URLSearchParams(location.search);
    const force = q.get("forceRole");
    if (force) return normalizeRole(force);

    // 1) JWT (localStorage.authToken)
    const token = localStorage.getItem("authToken");
    if (token && token.split(".").length === 3) {
      try {
        const payload = JSON.parse(base64UrlDecode(token.split(".")[1]));
               // 期限切れならログアウト相当
       if (typeof payload.exp === "number") {
         const now = Math.floor(Date.now() / 1000) + 5; // 5秒バッファ
         if (payload.exp <= now) {
           try {
             localStorage.removeItem("authToken");
           } catch {}
           return "user";
         }
       }
        // 1-1) role 文字列
        if (typeof payload.role === "string") return normalizeRole(payload.role);
        // 1-2) roles 配列
        if (Array.isArray(payload.roles) && payload.roles.length) {
          const norm = payload.roles.map(normalizeRole);
          if (norm.includes("admin")) return "admin";
          if (norm.includes("user"))  return "user";
          return norm[0];
        }
        // 1-3) isAdmin 真偽
        if (payload.isAdmin === true) return "admin";
      } catch (e) {
        if (DEBUG) console.warn("[sidebar] JWT parse fail:", e);
      }
    }

    // 2) localStorage.userRole（ログイン時に保存している想定）
    const lsRole = localStorage.getItem("userRole");
    if (lsRole) return normalizeRole(lsRole);

    // 3) localStorage.userProfile（{ role: "...", isAdmin: true } など）
    try {
      const profile = JSON.parse(localStorage.getItem("userProfile") || "null");
      if (profile) {
        if (typeof profile.role === "string") return normalizeRole(profile.role);
        if (profile.isAdmin === true) return "admin";
      }
    } catch {}

    // 既定は "user"
    return "user";
  }

  /** data-requires-role の要素を出し分け */
/** data-requires-role / data-required の要素を出し分け */
function applyRoleVisibility(currentRole) {
  const els = document.querySelectorAll("[data-requires-role], [data-required]");
  els.forEach(el => {
    // ← ここがポイント：両方の属性をサポートしつつ未定義を空文字に
    const requiredRaw =
      el.getAttribute("data-requires-role") ??
      el.getAttribute("data-required") ??
      "";

    const required = String(requiredRaw).trim().toLowerCase();

    // "admin,owner" = OR, "admin+teacher" = AND
    const groups = required
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const ok = groups.length
      ? groups.some(group => {
          const needs = group
            .split("+")
            .map(s => s.trim())
            .filter(Boolean);
          return needs.every(req => hasRole(currentRole, req));
        })
      : true; // 指定がなければ表示

    if (!ok) {
      el.style.display = "none";
    } else if (el.style.display === "none") {
      // 必要なら表示に戻す
      el.style.display = "";
    }
  });
}


  /** 要求ロールに対して現在ロールが満たすか */
  function hasRole(current, required) {
    const c = normalizeRole(current);
    const r = normalizeRole(required);
    if (!r) return true;            // 要求なしは誰でもOK
    if (!c) return false;

    // 役割の意味づけ：
    // owner … adminと同等以上
    // admin … 管理者
    // teacher … 自所属ユーザーを管理できる
    // user … 一般ユーザー
    if (r === "owner")   return c === "owner";
    if (r === "admin")   return c === "admin" || c === "owner";      // owner≒admin
    if (r === "teacher") return c === "teacher" || c === "admin" || c === "owner";
    if (r === "user")    return ["user","teacher","admin","owner"].includes(c);
    return c === r;
  }

  /** 文字列/配列/真偽値/大小混在を正規化 */
  function normalizeRole(val) {
    if (val == null) return "";
    if (typeof val === "boolean") return val ? "admin" : "user";
    if (Array.isArray(val)) {
      const norm = val.map(normalizeRole);
      if (norm.includes("admin")) return "admin";
      if (norm.includes("user"))  return "user";
      return norm[0] || "";
    }
    return String(val).trim().toLowerCase();
  }

  /** base64url デコード（atob互換） */
  function base64UrlDecode(b64url) {
   const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
   const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
   const bin = atob(b64);
   const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
   return new TextDecoder("utf-8").decode(bytes);
  }
})();


/* ========== メッセージ（モーダル）— 固定HTML本文を表示（衝突回避の専用クラス版） ========== */
(() => {
  "use strict";

  /* ---- CSS を一度だけ注入（他UIとクラス名衝突しない `.msg-modal*` 専用） ---- */
  function ensureMessageStyles(){
    if (document.getElementById("messages-style")) return;
    const css = `
      .msg-modal{position:fixed;inset:0;display:none;z-index:20000;background:transparent}
      .msg-modal.is-open{display:block}
      .msg-modal__overlay{position:absolute;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(2px)}
      .msg-modal__dialog{position:relative;margin:6vh auto;width:clamp(320px,92vw,720px);max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.2);display:flex;flex-direction:column}
      .msg-modal__header{padding:12px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
      .msg-modal__title{font-size:16px;font-weight:700}
      .msg-modal__close{background:transparent;border:0;font-size:20px;line-height:1;cursor:pointer}
      .msg-modal__body{padding:16px 18px;overflow:auto}
      @media (max-width:768px){.msg-modal__dialog{margin:0;width:100vw;height:100vh;max-height:none;border-radius:0}}
      body.msg-modal-open{overflow:hidden}
      .msg-article h3{margin:0 0 8px;font-size:18px}
      .msg-article p{line-height:1.9}
    `;
    const style = document.createElement("style");
    style.id = "messages-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---- モーダルDOMを用意（本文は #messagesBody に流し込む） ---- */
  function ensureMessagesModal(){
    let m = document.getElementById("messagesModal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "messagesModal";
    m.className = "msg-modal";
    m.innerHTML = `
      <div class="msg-modal__overlay" data-close="1"></div>
      <div class="msg-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="messagesTitle">
        <div class="msg-modal__header">
          <div id="messagesTitle" class="msg-modal__title">メッセージ</div>
          <button class="msg-modal__close" data-close="1" aria-label="閉じる">×</button>
        </div>
        <div class="msg-modal__body">
          <article id="messagesBody" class="msg-article"></article>
        </div>
      </div>
    `;
    document.body.appendChild(m);

    m.addEventListener("click", (e)=>{ if (e.target && e.target.closest("[data-close]")) closeMessages(); });
document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closeMessages(); });
    return m;
  }

   let lastFocusEl = null;
 const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
 function trapFocus(e, container) {
   if (e.key !== "Tab") return;
   const items = [...container.querySelectorAll(FOCUSABLE)]
     .filter(el => !el.hasAttribute("disabled") && (el.offsetParent !== null || el.getClientRects().length));
   if (!items.length) return;
   const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
   else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
 }

  function openMessages(){
    ensureMessageStyles();
   const modal = ensureMessagesModal();
   lastFocusEl = document.activeElement;
   modal.classList.add("is-open");
    document.body.classList.add("msg-modal-open");
   const first = modal.querySelector(FOCUSABLE) || modal;
   setTimeout(()=> first.focus(), 0);
   document.addEventListener("keydown", onKey);
   function onKey(e){ trapFocus(e, modal); }
   modal.__offKey = onKey;
  }
  function closeMessages(){
    const m = document.getElementById("messagesModal");
   if (m) {
     m.classList.remove("is-open");
     document.removeEventListener("keydown", m.__offKey || (()=>{}));
   }
   document.body.classList.remove("msg-modal-open");
   if (lastFocusEl && typeof lastFocusEl.focus === "function") lastFocusEl.focus();
  }

  /* ---- 固定本文（このHTMLがそのまま表示されます） ---- */
  const STATIC_MESSAGE_HTML = `
      <h3>NPO法人日本語スピーチ協会　笈川幸司</h3>
      <p>
        今回、日本語学習者のために「日本語スピーチアプリ」を開発してもらいました。<br>
        このアプリは、発話の「時間」と「文字数」を意識することを目的にしています。<br>
        設定はとてもシンプルです。発話時間が 50秒、発話文字数が 250字以上 のときに、100点満点となるように設計されています。<br>
        逆に、19秒以内や61秒以上の場合は不合格。短すぎても、長すぎてもダメ。<br>
        ちょうどよい時間で、自分の考えを言葉にする力を育てていくのです。<br>
        そして大切なのは、「文法が間違っていても、アクセントが違っていてもいい」ということです。<br>
        たとえ不完全な日本語であっても、20秒間話し続ければ、聞く人は必ずあなたの言葉に耳を傾け、真剣に聞いてくれます。<br>
        これこそが、言葉の力です。<br>
        そこに必要なのは、あなたの勇気です。<br>
        20秒話すためには、ちょっとしたコツがあります。<br>
        それは「答え」と「理由」と「簡単なエピソード」を話すこと。<br>
        さらに、2つの理由と2つのエピソードを話すことができれば、自然と発話時間が40秒に近づいていきます。<br>
        気がつけば、あなたの言葉はより豊かに、より深く、人の心に届くようになるでしょう。<br>
        このアプリを通して、私がみなさんに伝えたいのは、勇気を出して、2つの理由と2つのエピソードを話せるように頑張ってもらいたい、ということです。<br>
        その挑戦は、きっとあなたの日本語人生を大きく変えるでしょう。<br>
        自分の言葉で、自分の思いを語れるようになったとき、世界は必ずあなたに微笑みかけてくれるはずです。<br>
        頑張ってください💪
      </p>
  `;

  function renderStaticMessage(){
    const $body = document.getElementById("messagesBody");
    if (!$body) return;
    $body.innerHTML = STATIC_MESSAGE_HTML.trim();
  }

  /* ---- 右ドロワー等を“だいたい閉じる”汎用処理 ---- */
  function closeRightDrawerIfAny(){
    try{
      const candidates = [
        '#rightMenu', '#offcanvasRight', '#siteRightMenu',
        '.right-drawer', '.offcanvas', '.drawer', '.hamburger-menu', '.menu-panel'
      ];
      document.querySelectorAll(candidates.join(',')).forEach(el => {
        el.classList.remove('is-open','open','active','show');
        el.setAttribute('aria-hidden','true');
      });
      document.querySelectorAll('input[type="checkbox"][id*="menu"],input[type="checkbox"][id*="drawer"]').forEach(cb => { cb.checked = false; });
      document.body.classList.remove('drawer-open','offcanvas-open','menu-open');
      if (window.closeRightMenu) window.closeRightMenu();
    }catch{}
  }

  /* ---- トリガをグローバル委譲（右メニューでも確実に拾う） ---- */
  const MESSAGE_TRIGGER_SELECTOR = [
    '[data-open="messages"]',          // 推奨：右メニュー用
    'a[data-match="messages"]',        // サイドバー/右メニュー共通
    'button[data-match="messages"]',
    'a[href="#messages"]',
    'a.side-item[data-match="messages"]'
  ].join(', ');

  function bindMessagesGlobalDelegation(){
    if (document.documentElement.dataset.boundMessagesGlobal) return;
    document.documentElement.dataset.boundMessagesGlobal = "1";

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest(MESSAGE_TRIGGER_SELECTOR);
      if (!trigger) return;

      e.preventDefault();
      closeRightDrawerIfAny();
      setTimeout(() => {
        openMessages();
        renderStaticMessage();
      }, 30);
    }, true); // captureで先に拾う
  }

  /* ---- init フック：sidebar.js の init() から呼ぶ ---- */
  window.__initSidebarMessages = function initSidebarMessages(){
    ensureMessageStyles();
    ensureMessagesModal();
    bindMessagesGlobalDelegation();
  };
})();