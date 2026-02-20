// ヘッダーは header.js が読み込んでくれる想定

// BottomNav の active 表示（ダミー）
document.querySelectorAll('.bottom-nav .bn-item').forEach((a) => {
  a.addEventListener('click', (e) => {
    document.querySelectorAll('.bottom-nav .bn-item').forEach(x => x.classList.remove('is-active'));
    a.classList.add('is-active');
  });
});

// サイドバーの active 表示（ダミー）
document.querySelectorAll('.side-item').forEach((a) => {
  a.addEventListener('click', (e) => {
    document.querySelectorAll('.side-item').forEach(x => x.classList.remove('is-active'));
    a.classList.add('is-active');
  });
});

// 日本語ラベルに整形
function jpLabel(setting){
  return {
    level: setting.level, // 初級/中級/上級（そのまま）
    mode: setting.mode === 'random' ? 'ランダム' : '順番通り',
    max: `${setting.maxTime}秒`,
    timer: setting.timerType === 'countdown' ? 'カウントダウン' : 'カウントアップ',
    force: setting.forceEnd === 'on' ? 'あり' : 'なし',
    trans: setting.transcript === 'on' ? 'あり' : 'なし'
  };
}

// サマリー反映
function renderSettingSummary(s){
  const L = jpLabel(s);
  document.getElementById('sum-level').textContent = L.level;
  document.getElementById('sum-mode').textContent  = L.mode;
  document.getElementById('sum-max').textContent   = L.max;
  document.getElementById('sum-timer').textContent = L.timer;
  document.getElementById('sum-force').textContent = L.force;
  document.getElementById('sum-trans').textContent = L.trans;
}
document.addEventListener('DOMContentLoaded', () => {
  const btnHero = document.getElementById('btnHeroStart');
  if (btnHero) {
    btnHero.addEventListener('click', () => {
      // contents001.html へ遷移
      window.location.href = '/html/contents001.html';
    });
  }
});
// 初期表示
document.addEventListener('DOMContentLoaded', () => {
  if (window.getAppSetting) renderSettingSummary(window.getAppSetting());
});

// setting.js が保存後に呼ぶフックを実装
window.onSettingChanged = (s) => renderSettingSummary(s);