// bottom-nav を読み込むローダー（header/sidebarと同パターン）
(async () => {
  const mountId = 'siteBottomNav';
  let mount = document.getElementById(mountId);
  if (!mount) {
    mount = document.createElement('div');
    mount.id = mountId;
    document.body.appendChild(mount);      // ← body直下に挿入（固定配置なので）
  }

  const explicit = mount.getAttribute('data-bottom-src');
  const nearby   = new URL('./bottom-nav.html', (document.currentScript && document.currentScript.src) || location.href).href;
  const defaults = `${location.origin}/oikawaapp/oikawashikiappcommon/bottom-nav.html`;
  const candidates = [explicit, nearby, defaults, './bottom-nav.html'].filter(Boolean);

  let lastErr;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { credentials: 'include', cache: 'no-cache' });
      if (!res.ok) throw new Error(res.statusText);
      mount.innerHTML = await res.text();
      return;
    } catch (e) { lastErr = e; }
  }
  console.error('BottomNav load failed:', lastErr, { candidates });
})();
