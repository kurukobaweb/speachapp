// public/js/dashboard.js
import api from './api.js';

document.addEventListener('DOMContentLoaded', () => {
  // ==== 認証（そのまま） ====
  const token = localStorage.getItem('authToken');
  if (!token) { window.location.href = 'login.html'; return; }

  let payload;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    payload = JSON.parse(decodeURIComponent(escape(window.atob(b64))));
  } catch (e) {
    console.warn('トークン解析エラー:', e);
    window.location.href = 'login.html';
    return;
  }

  // ==== 画面ボタン ====
  const btnSetting         = document.getElementById('btnSetting');
  const btnStartApp        = document.getElementById('btnStartApp');
  const btnProfile         = document.getElementById('btnProfile');
  const btnUserManagement  = document.getElementById('btnUserManagement');
  const btnThemeManagement = document.getElementById('btnThemeManagement');
  const btnLogout          = document.getElementById('btnLogout');

  btnStartApp?.addEventListener('click', () => { window.location.href = 'index.html'; });
  if (btnProfile) {
    btnProfile.style.display = '';
    btnProfile.addEventListener('click', () => { window.location.href = 'profile.html'; });
  }
  if (payload.role === 'admin') {
    if (btnUserManagement) {
      btnUserManagement.style.display = '';
      btnUserManagement.addEventListener('click', () => { window.location.href = 'admin.html'; });
    }
    if (btnThemeManagement) {
      btnThemeManagement.style.display = '';
      btnThemeManagement.addEventListener('click', () => { window.location.href = 'bulk-themes.html'; });
    }
  }
  if (btnLogout) {
    btnLogout.style.display = '';
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('authToken');
      window.location.href = 'login.html';
    });
  }

  // ==== お題一覧モーダル ====
  const btnPromptList   = document.getElementById('btnPromptList');
  const promptListModal = document.getElementById('promptListModal');
  const promptListDiv   = document.getElementById('promptList'); // tbody
  const paginationDiv   = document.getElementById('pagination');
  const closePromptList = document.getElementById('closePromptList');
  const filterLevel     = document.getElementById('filterLevel');
  const filterType      = document.getElementById('filterType');
  const filterReset     = document.getElementById('filterReset');

  let allPrompts = [];
  let levelList = [];
  let typeList = [];
  let currentPage = 1;
  let pageSize = getResponsivePageSize();

  function getResponsivePageSize(){ return window.innerWidth <= 600 ? 3 : 8; }

  window.addEventListener('resize', () => {
    const newSize = getResponsivePageSize();
    if (pageSize !== newSize) {
      pageSize = newSize;
      currentPage = 1;
      renderPromptList();
    }
  });

  // ==== テーマ一覧ボタン ====
  btnPromptList?.addEventListener('click', async () => {
    pageSize = getResponsivePageSize();
    if (promptListDiv)  promptListDiv.innerHTML = '<tr><td colspan="4">読み込み中...</td></tr>';
    if (paginationDiv)  paginationDiv.innerHTML = '';
    allPrompts = [];

    try {
      // 共通クライアント：自動で JSON 化、2xx 以外は例外
      allPrompts = await api.get('/api/themes', { authToken: token });
      if (!Array.isArray(allPrompts) || allPrompts.length === 0) {
        promptListDiv.innerHTML = `<tr><td colspan="4">お題がありません</td></tr>`;
        return;
      }
    } catch (e) {
      const msg = e?.body?.error || e?.message || '取得に失敗しました';
      promptListDiv.innerHTML = `<tr><td colspan="4">${escapeHtml(msg)}</td></tr>`;
      return;
    }

    // フィルター候補
    levelList = [...new Set(allPrompts.map(p => p.level).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ja'));
    typeList  = [...new Set(allPrompts.map(p => p.type ).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ja'));

    if (filterLevel) filterLevel.innerHTML = '<option value="">全てのレベル</option>' + levelList.map(l=>`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
    if (filterType)  filterType.innerHTML  = '<option value="">全てのタイプ</option>' + typeList.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if (filterLevel) filterLevel.value = '';
    if (filterType)  filterType.value  = '';

    currentPage = 1;
    renderPromptList();
    if (promptListModal) promptListModal.style.display = 'block';
  });

  function renderPromptList(){
    if (!promptListDiv) return;
    const lv = filterLevel ? filterLevel.value : '';
    const tp = filterType ? filterType.value : '';

    let list = allPrompts.filter(p => (!lv || p.level === lv) && (!tp || p.type === tp));
    list.sort((a, b) => {
      if (a.level !== b.level) return String(a.level).localeCompare(String(b.level),'ja');
      const anum = Number(a.sub), bnum = Number(b.sub);
      if (!Number.isNaN(anum) && !Number.isNaN(bnum)) return anum - bnum;
      return String(a.sub).localeCompare(String(b.sub),'ja');
    });

    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * pageSize;
    const pageList = list.slice(start, start + pageSize);

    promptListDiv.innerHTML = '';
    if (pageList.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" style="text-align:center;">該当するお題がありません</td>`;
      promptListDiv.appendChild(tr);
    } else {
      pageList.forEach(prompt => {
        const tr = document.createElement('tr');
        tr.className = 'finder-row';
        tr.tabIndex = 0;
        tr.innerHTML = `
          <td>${escapeHtml(prompt.level || '')}</td>
          <td>${escapeHtml(String(prompt.sub ?? ''))}</td>
          <td>${escapeHtml(prompt.type || '')}</td>
          <td>${safeQuestion(prompt.question)}</td>
        `;
        tr.onclick = () => {
          try { localStorage.setItem('selectedPrompt', JSON.stringify(prompt)); } catch {}
          window.location.href = 'index.html';
        };
        tr.onkeydown = (e) => { if (e.key === 'Enter') tr.onclick(); };
        promptListDiv.appendChild(tr);
      });
    }

    // ページャ
    if (!paginationDiv) return;
    if (totalPages <= 1) { paginationDiv.innerHTML = ''; return; }

    paginationDiv.innerHTML = `
      <button class="btn-page" id="pagePrev" ${currentPage === 1 ? 'disabled' : ''} aria-label="前のページ">←</button>
      <span class="page-indicator" aria-live="polite">${currentPage} / ${totalPages}</span>
      <button class="btn-page" id="pageNext" ${currentPage === totalPages ? 'disabled' : ''} aria-label="次のページ">→</button>
    `;
    document.getElementById('pagePrev')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderPromptList(); } });
    document.getElementById('pageNext')?.addEventListener('click', () => {
      const max = Math.ceil(getFiltered().length / pageSize) || 1;
      if (currentPage < max) { currentPage++; renderPromptList(); }
    });
  }

  function getFiltered(){
    const lv = filterLevel ? filterLevel.value : '';
    const tp = filterType ? filterType.value : '';
    return allPrompts.filter(p => (!lv || p.level === lv) && (!tp || p.type === tp));
  }

  // フィルター
  filterLevel?.addEventListener('change', () => { currentPage = 1; renderPromptList(); });
  filterType ?.addEventListener('change', () => { currentPage = 1; renderPromptList(); });
  filterReset?.addEventListener('click', () => {
    if (filterLevel) filterLevel.value = '';
    if (filterType)  filterType.value  = '';
    currentPage = 1;
    renderPromptList();
  });

  // モーダル閉じる
  closePromptList?.addEventListener('click', () => { if (promptListModal) promptListModal.style.display = 'none'; });
  promptListModal?.addEventListener('mousedown', e => {
    if (e.target === promptListModal) promptListModal.style.display = 'none';
  });
});

/* ==== 小物ユーティリティ ==== */
function escapeHtml(s=''){
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

// question は <ruby>/<rt>/<rb>/<rp>/<br>/<b>/<i>/<strong>/<em> のみ許可
function safeQuestion(html=''){
  const ALLOW = new Set(['RUBY','RT','RB','RP','BR','B','I','STRONG','EM']);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`,'text/html');
  const root = doc.body.firstElementChild;
  function rebuild(node){
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || '');
    if (node.nodeType === Node.ELEMENT_NODE){
      const tag = node.tagName.toUpperCase();
      if (ALLOW.has(tag)){
        const open = `<${tag.toLowerCase()}>`;
        const close = `</${tag.toLowerCase()}>`;
        let inner = '';
        node.childNodes.forEach(ch => { inner += typeof ch === 'string' ? escapeHtml(ch) : rebuild(ch); });
        return open + inner + close;
      }
      let inner = '';
      node.childNodes.forEach(ch => { inner += typeof ch === 'string' ? escapeHtml(ch) : rebuild(ch); });
      return inner;
    }
    return '';
  }
  let out = '';
  root?.childNodes.forEach(n => { out += (typeof n === 'string') ? escapeHtml(n) : rebuild(n); });
  return out || '';
}
