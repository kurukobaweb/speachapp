// toggleEye.js

// SVG は register.js 等からコピペでOK
// 目アイコン（表示用）
(() => {
const OPEN = `
<svg fill="currentColor" width="20" height="20" viewBox="0 0 20 20"
     xmlns="http://www.w3.org/2000/svg">
  <path d="M3.26 11.6A6.97 6.97 0 0 1 10 6c3.2 0 6.06 2.33 
           6.74 5.6a.5.5 0 0 0 .98-.2A7.97 7.97 0 0 0 10 5a7.97 
           7.97 0 0 0-7.72 6.4.5.5 0 0 0 .98.2ZM10 8a3.5 3.5 
           0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm-2.5 
           3.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z" />
</svg>`;

// 目にバツアイコン（非表示用）
const CLOSED = `
<svg fill="currentColor" width="20" height="20" viewBox="0 0 20 20"
     xmlns="http://www.w3.org/2000/svg">
  <path d="M2.85 2.15a.5.5 0 1 0-.7.7l3.5 3.5a8.1 8.1 
           0 0 0-3.37 5.05.5.5 0 1 0 .98.2 7.09 7.09 0 
           0 1 3.1-4.53l1.6 1.59a3.5 3.5 0 1 0 4.88 4.89l4.3 
           4.3a.5.5 0 0 0 .71-.7l-15-15Zm9.27 
           10.68a2.5 2.5 0 1 1-3.45-3.45l3.45 
           3.45Zm-2-4.83 3.38 3.38A3.5 3.5 0 0 0 
           10.12 8ZM10 6c-.57 0-1.13.07-1.67.21l-.8-.8A7.65 
           7.65 0 0 1 10 5c3.7 0 6.94 2.67 7.72 
           6.4a.5.5 0 0 1-.98.2A6.97 6.97 0 0 0 10 6Z" />
</svg>`;

  function resolveInput(span) {
    const id = span.getAttribute('data-target');
    if (id) return document.getElementById(id);
    const prev = span.previousElementSibling;
    return (prev && prev.tagName === 'INPUT') ? prev : null;
  }

  function bindOne(span) {
    if (!span || span.dataset.teBound === '1') return; // 多重バインド防止
    const input = resolveInput(span);
    if (!input) return;

    span.dataset.teBound = '1';
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    span.setAttribute('aria-label', 'パスワード表示切替');

    // 初期アイコン
    span.innerHTML = (input.type === 'password') ? CLOSED : OPEN;

    const toggle = () => {
      if (input.type === 'password') {
        input.type = 'text';
        span.innerHTML = OPEN;
      } else {
        input.type = 'password';
        span.innerHTML = CLOSED;
      }
    };
    span.addEventListener('click', toggle);
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }

  function init(container = document) {
    container.querySelectorAll('.toggle-eye').forEach(bindOne);
  }

  // 自動初期化（ページ初回）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }

  // admin.js から呼べるようにグローバル公開（ESMでもOK）
  window.initEyeToggle = init;
})();