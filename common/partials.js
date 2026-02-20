// /japanesespeech/common/partials.js
(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", init);

  async function init(){
    // 1) 共通パーツ挿入（header / sidebar）
    await Promise.all([
      inject("siteHeader",  "data-header-src"),
      inject("siteSidebar", "data-sidebar-src"),
      inject("siteBottomNav", "data-bottom-src"),

    ]);

    // 2) 右メニュー（drawer）を必ずバインド
    //    header.html 内の id に合わせています: #drawerToggle, #drawer, #drawerClose, #drawerBackdrop
    bindDrawer({
      btn:  ["#drawerToggle", ".hamburger", "[data-role='menu-toggle']"],
      menu: ["#drawer", "[data-role='right-menu']"],
      close:["#drawerClose", "[data-action='close-right']"],
      backdrop:["#drawerBackdrop", ".menu-overlay"]
    });

    // 3) 現在地ハイライト
    markActiveByDataMatch(document);

    // 右メニュー内リンクも常時補正
fixDrawerLinks();

function fixDrawerLinks(){
  const host = document.getElementById('siteHeader');
  if (!host) return;
  // 基準パスを再取得
  const src = host.getAttribute('data-header-src') || '';
  const base = getProjectBaseFrom(src);

  const run = (root) => rewriteUrls(root, base);

  // 初回：現在の drawer を補正
  const drawer = host.querySelector('#drawer, [data-role="right-menu"]');
  if (drawer) run(drawer);

  // 以後：drawer 内に追加されたノードも補正
  const obs = new MutationObserver(muts=>{
    for (const m of muts){
      for (const n of m.addedNodes || []){
        if (!(n instanceof Element)) continue;
        if (n.matches && (n.matches('#drawer, [data-role="right-menu"]') || n.closest && n.closest('#drawer, [data-role="right-menu"]'))){
          run(n);
        }
      }
    }
  });
  obs.observe(host, {childList:true, subtree:true});
}

  }

  // ------- HTMLフラグメント挿入 + 相対URL補正 -------
  async function inject(hostId, attrName){
    const host = document.getElementById(hostId);
    if (!host) return;

    const src = host.getAttribute(attrName);
    if (!src) return;

    let html = await fetchWithPagespeedFallback(src).catch(e=>{
      console.error(`[partials] load failed: ${src}`, e);
      host.innerHTML = `<div style="padding:8px;color:#b91c1c;">共通パーツの読み込みに失敗しました (${src})</div>`;
      return null;
    });
    if (html == null) return;

    host.innerHTML = html;

    // basePath = /japanesespeech （/common/ の手前まで）
    const basePath = getProjectBaseFrom(src);
    rewriteUrls(host, basePath);
  }

  async function fetchWithPagespeedFallback(urlStr){
    const res = await fetch(urlStr, { credentials:"include", cache:"no-cache" });
    if (res.ok) return await res.text();

    // PageSpeed/リバプロ由来の化け対処: ?ModPagespeed=off で再試行
    const u = new URL(urlStr, location.href);
    u.searchParams.set("ModPagespeed","off");
    const res2 = await fetch(u.toString(), { credentials:"include", cache:"no-cache" });
    if (!res2.ok) throw new Error(`HTTP ${res.status} then ${res2.status}`);
    return await res2.text();
  }

  function getProjectBaseFrom(partPath){
    const p = new URL(partPath, location.href).pathname;
    const i = p.indexOf("/common/");
    return (i >= 0) ? p.slice(0, i) : "";
  }

// 旧 rewriteUrls を置換
function rewriteUrls(root, base){
  const isExternal = u => /^([a-z][a-z0-9+\-.]*:|\/\/)/i.test(u);
  const isRootAbs  = u => u.startsWith('/');
  const isSkippable= u => !u || isExternal(u) || u.startsWith('#') ||
                          u.toLowerCase().startsWith('javascript:') ||
                          u.toLowerCase().startsWith('mailto:') ||
                          u.toLowerCase().startsWith('tel:') ||
                          u.toLowerCase().startsWith('data:');
  const resolveRel = (href) => {
    try {
      const u = new URL(href, location.origin + (base.endsWith('/')?base:base+'/'));
      return u.pathname + u.search + u.hash;
    } catch { return href; }
  };

  root.querySelectorAll('a[href]').forEach(a=>{
    const href = a.getAttribute('href');
    if (isSkippable(href) || isRootAbs(href)) return;
    a.setAttribute('href', resolveRel(href));
  });

  root.querySelectorAll('[src]').forEach(el=>{
    const src = el.getAttribute('src');
    if (isSkippable(src) || isRootAbs(src)) return;
    el.setAttribute('src', resolveRel(src));
  });

  root.querySelectorAll('link[href]').forEach(link=>{
    const href = link.getAttribute('href');
    if (isSkippable(href) || isRootAbs(href)) return;
    link.setAttribute('href', resolveRel(href));
  });
}



  function markActiveByDataMatch(root){
    const path = location.pathname;
    root.querySelectorAll("[data-match]").forEach(el=>{
      const key = el.getAttribute("data-match");
      if (key && path.includes(key)) el.classList.add("is-active");
    });
  }

  // ------- 右メニュー（drawer）バインド -------
  function bindDrawer(sel){
    // ヘッダーが遅れても拾えるように再試行
    const started = performance.now();
    const timeoutMs = 10000;

    const ensureCSS = (menuSel) => {
      if (document.getElementById("drawer-hotfix")) return;
      const st = document.createElement("style");
      st.id = "drawer-hotfix";
      st.textContent = `
        ${menuSel}{
          position:fixed; top:0; right:0; height:100dvh; width:min(86vw,360px);
          transform:translateX(100%); transition:transform .25s ease;
          background:#fff; box-shadow:-2px 0 16px rgba(0,0,0,.15);
          z-index:2147483000; display:block;
        }
        ${menuSel}.is-open{ transform:translateX(0); }
        .menu-overlay{
          position:fixed; inset:0; background:rgba(0,0,0,.35);
          z-index:2147482999; display:none;
        }
        .menu-overlay.is-open{ display:block; }
      `;
      document.head.appendChild(st);
    };

    const pick = (selectors, root=document) => {
      for(const s of selectors){
        const el = root.querySelector(s);
        if (el) return {el, sel:s};
      }
      return null;
    };

    const search = () => {
      // 通常DOMと #siteHeader 内、ShadowRoot 内も探索
      const roots = [document];
      const host = document.getElementById("siteHeader");
      if (host) roots.push(host);
      document.querySelectorAll("*").forEach(n=>{ if(n.shadowRoot) roots.push(n.shadowRoot); });

      for (const r of roots){
        const btn  = pick(sel.btn, r);
        const menu = pick(sel.menu, r);
        if (btn && menu){
          const close    = pick(sel.close, r);
          const backdrop = pick(sel.backdrop, r);
          return {btn, menu, close, backdrop, root:r};
        }
      }
      return null;
    };

    const tryBind = () => {
      const found = search();
      if (found){
        ensureCSS(found.menu.sel);

        let overlay = found.backdrop?.el || document.querySelector(".menu-overlay");
        if (!overlay){
          overlay = document.createElement("div");
          overlay.className = "menu-overlay";
          document.body.appendChild(overlay);
        }

        const open  = () => {
          found.menu.el.classList.add("is-open"); overlay.classList.add("is-open");
          // 開いたタイミングでもう一度補正
          const host = document.getElementById('siteHeader');
          const src  = host?.getAttribute('data-header-src') || '';
          const base = getProjectBaseFrom(src);
          rewriteUrls(found.menu.el, base);
        };
        const close = () => { found.menu.el.classList.remove("is-open"); overlay.classList.remove("is-open"); };

        found.btn.el.addEventListener("click", e=>{ e.preventDefault(); open(); }, {passive:false});
        (found.close?.el || overlay).addEventListener("click", close);
        document.addEventListener("keydown", e=>{ if(e.key==="Escape") close(); });

        console.log("[drawer] bound", {
          btnSel: found.btn.sel, menuSel: found.menu.sel,
          closeSel: found.close?.sel, backdropSel: found.backdrop?.sel
        });
        return;
      }
      if (performance.now() - started > timeoutMs){
        console.warn("[drawer] not found. header insertion or selectors may be wrong.");
        return;
      }
      setTimeout(tryBind, 150);
    };

    // 変化監視（挿入後すぐ拾う）
    const obs = new MutationObserver(()=>{ /* 変化が来れば tryBind が拾う */});
    obs.observe(document.documentElement, {childList:true, subtree:true});
    tryBind();
  }
})();