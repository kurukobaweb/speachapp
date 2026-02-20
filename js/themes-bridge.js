// /js/themes-bridge.js
document.addEventListener('DOMContentLoaded', () => {
  // menu.js で使う要素が存在すれば、一覧を自動ロード
  const btn = document.getElementById('btnPromptList');
  if (btn) {
    // menu.js が登録した click ハンドラを利用
    // → API取得・フィルタ・ページネーション・行クリックの遷移まで既存ロジックが動く
    btn.click();
  }

  // 「閉じる」相当は不要（別ページだから）
  const closeBtn = document.getElementById('closePromptList');
  if (closeBtn) closeBtn.style.display = 'none';

  // オーバーレイの外側クリックで閉じる挙動を無効化
  const modal = document.getElementById('promptListModal');
  if (modal) {
    modal.removeEventListener?.('mousedown', () => {});
    modal.style.display = 'block';
    modal.style.pointerEvents = 'auto';
  }
});
