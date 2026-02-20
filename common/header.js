// /common/header.js — 共通ヘッダー読込 + LogIn/Out 切替 + モバイルドロワー（委譲対応・完全版）
(() => {
  "use strict";

  const FOCUSABLE =
    'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  let lastFocus = null;
  let logoutDelegationBound = false;

  if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

  window.addEventListener("storage", (e) => {
    if (e.key === "authToken") initAuthLinks();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") initAuthLinks();
  });
  window.addEventListener("pageshow", () => {
    initAuthLinks();
  });

  // =========================
  // init: ヘッダー読込 → 初期化
  // =========================
  async function init() {
    const host = document.getElementById("siteHeader");
    if (!host) return;

    const src = host.getAttribute("data-header-src") || "/common/header.html";
    try {
      const res = await fetch(src, { credentials: "include", cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      host.innerHTML = await res.text();
    } catch (e) {
      console.error("Header load failed:", e);
      host.innerHTML = `<div style="padding:8px;color:#b91c1c;">ヘッダーの読み込みに失敗しました</div>`;
      return;
    }

    // 先に LogIn/Out リンクを“属性で”整える（イベントは後述の委譲で拾う）
    initAuthLinks();
    setTimeout(initAuthLinks, 0);


    // ドロワー初期化（旧 initHamburger 互換も提供）
    window.initHamburger = initHamburgerDrawer;
    initHamburgerDrawer();

    // （重要）ログアウトは委譲で1回だけバインド → クローンにも効く
    bindGlobalLogoutDelegation();
  }

  // =========================
  // ログイン状態（JWT exp 優先）
  // =========================
  function isLoggedIn() {
    const t = localStorage.getItem("authToken");
    if (!t) return false;
    const parts = t.split(".");
    if (parts.length !== 3) return true;
    try {
      const payload = JSON.parse(base64UrlDecode(parts[1]));
      if (typeof payload.exp === "number") {
        const now = Math.floor(Date.now() / 1000) + 5; // 5秒バッファ
        return payload.exp > now;
      }
      return true;
    } catch {
      return true;
    }
  }

  // =========================
  // LogIn/Out リンク更新（全インスタンス対象）
  // =========================
function initAuthLinks() {
  const loggedIn = isLoggedIn();

  // ▼ Profile：未ログイン時は非表示
  document
    .querySelectorAll('.nav-item.profile')
    .forEach(el => {
      el.style.display = loggedIn ? '' : 'none';
    });

  // ▼ Setting：未ログイン時は非表示（★追加）
  document
    .querySelectorAll('.btn-setting')
    .forEach(el => {
      el.style.display = loggedIn ? '' : 'none';
    });

  // 既存の Login / Logout 切替処理
  const links = document.querySelectorAll(
    '#authLink, #headerLoginLink, a[data-auth="link"]'
  );
  if (!links.length) return;

  links.forEach(link => {
    const textNode =
      link.querySelector("[data-auth-text]") ||
      link.querySelector("#authText") ||
      link.querySelector("span");

    const useEl = link.querySelector("svg use");

    if (loggedIn) {
      if (textNode) textNode.textContent = "Log Out";
      if (useEl) safeSetUseHref(useEl, "#bi-box-arrow-right");
      link.href = "#";
      link.setAttribute("data-action", "logout");
    } else {
      if (textNode) textNode.textContent = "Log In";
      if (useEl) safeSetUseHref(useEl, "#bi-box-arrow-in-right");
      link.removeAttribute("data-action");
      link.href = "/login.html";
    }
  });
}



  // クリック委譲（ログアウト）：クローンでも確実に動作
  function bindGlobalLogoutDelegation(){
    if (logoutDelegationBound) return;
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-action="logout"]');
      if (!a) return;
      e.preventDefault();
      doLogout();
    });
    logoutDelegationBound = true;
  }

  // =========================
  // ドロワー（モバイル用）
  // =========================
  function initHamburgerDrawer() {
    const btn       = document.getElementById("menuToggle");
    let   drawer    = document.getElementById("mobileDrawer");
    const closeBtn  = document.getElementById("drawerClose");
    let   backdrop  = document.getElementById("drawerBackdrop");
    const body      = document.getElementById("drawerBody");
    if (!btn || !drawer || !body) return;

    // ドロワー/Backdrop を body 直下へ（inert の影響を避ける）
    if (drawer.parentElement !== document.body) document.body.appendChild(drawer);
    if (backdrop && backdrop.parentElement !== document.body) document.body.appendChild(backdrop);

    // 中身（ヘッダーナビ + サイドバー）を一度だけ複製
    if (!body.dataset.filled) {
      const frag = document.createDocumentFragment();

      const siteNav = document.getElementById("siteNav");
      if (siteNav) {
        const navClone = siteNav.cloneNode(true);
        navClone.id = "siteNavClone";
              navClone.querySelectorAll('[id]').forEach(el => {
         if (!['siteNavClone'].includes(el.id)) el.removeAttribute('id');
       });
        frag.appendChild(navClone);
      }

      const side = document.getElementById("appSidebar")
        || document.querySelector(".sidebar,.app-sidebar,.sidebar-sp");
      if (side) {
        const sideClone = side.cloneNode(true);
        sideClone.id = "appSidebarClone";
               sideClone.querySelectorAll('[id]').forEach(el => {
         if (!['appSidebarClone'].includes(el.id)) el.removeAttribute('id');
       });
        frag.appendChild(sideClone);
      }

      body.appendChild(frag);
      body.dataset.filled = "1";

      // クローンにも LogIn/Out の“属性更新”を適用（イベントは委譲）
      initAuthLinks();
    }

    const isDesktop = () => window.matchMedia("(min-width:1025px)").matches;

    const onKeydown = (e) => {
      if (e.key === "Escape") close();
      else trapFocus(e, drawer);
    };

    const open = () => {
      if (isDesktop()) return; // PCでは開かない
      lastFocus = document.activeElement;

      drawer.hidden = false;
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
      btn.setAttribute("aria-expanded", "true");
      if (backdrop) backdrop.hidden = false;

      setBackgroundInertExcept([drawer, backdrop], true);

      const f = firstFocusable(drawer) || closeBtn || btn;
      setTimeout(() => f && f.focus(), 0);

      document.addEventListener("keydown", onKeydown);
    };

    const close = () => {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      drawer.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (backdrop) backdrop.hidden = true;

      setBackgroundInertExcept([drawer, backdrop], false);

      document.removeEventListener("keydown", onKeydown);
      (lastFocus && typeof lastFocus.focus === "function" ? lastFocus : btn).focus();
    };
    
    // ★ ドロワー内の「設定」を押したら、先にドロワーを閉じる（モーダル操作を確実にする）
    drawer.addEventListener("click", (e) => {
      // 設定ボタン/リンクの実体に合わせてセレクタを増やせます
      const settingHit =
        e.target.closest('[data-action="open-setting"]') ||
        e.target.closest('[data-action="setting"]') ||
        e.target.closest('a[href*="setting"]') ||
        e.target.closest('.btn-setting, [data-open="setting"], [aria-controls="settingModal"]');

      if (!settingHit) return;

      // ここで閉じる（この後 setting.js の click 委譲が動いてモーダルが開く想定）
      close();
    }, true);

    // 起動時は必ず閉じる（PCで見える事故防止）
    close();

    btn.addEventListener("click", () => {
      drawer.classList.contains("is-open") ? close() : open();
    });
    closeBtn && closeBtn.addEventListener("click", close);
    backdrop && backdrop.addEventListener("click", close);
    window.addEventListener("resize", () => { if (isDesktop()) close(); });
  }

  // =========================
  // ユーティリティ
  // =========================
  function firstFocusable(container) {
    return container.querySelector(FOCUSABLE);
  }

  function trapFocus(e, container) {
    if (e.key !== "Tab") return;
    const items = [...container.querySelectorAll(FOCUSABLE)]
      .filter(el => !el.hasAttribute("disabled") && (el.offsetParent !== null || el.getClientRects().length));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus(); e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus(); e.preventDefault();
    }
  }

  // body 直下の要素を対象に、許可（ドロワー/Backdrop）以外を inert
  function setBackgroundInertExcept(allowedEls, on) {
    const allowedTop = new Set();
    allowedEls.filter(Boolean).forEach(el => {
      let top = el;
      while (top && top.parentElement !== document.body) top = top.parentElement;
      if (top) allowedTop.add(top);
    });
    [...document.body.children].forEach(el => {
      if (allowedTop.has(el)) return;
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  /** <use> の href/xlink:href を安全に更新 */
  function safeSetUseHref(useEl, val) {
    try {
      useEl.setAttribute("href", val);
      useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", val);
    } catch {}
  }

  /** ログアウト */
  function doLogout() {
    try {
      localStorage.removeItem("authToken");
      localStorage.removeItem("userRole");
      localStorage.removeItem("userProfile");
      localStorage.removeItem("selectedPrompt");
    } catch {}
    location.href = "/login.html";
  }

  /** base64url デコード（Unicode安全） */
  function base64UrlDecode(b64url) {
    const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const dec = new TextDecoder("utf-8");
    return dec.decode(bytes);
  }
})();