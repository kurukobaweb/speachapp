// js/maintenance-popup.js
// ログイン時（またはページ表示直後）にメンテ告知ポップアップを表示し、必要ならログイン処理を止める。
// 使い方：login.htmlでこのスクリプトを先に読み込む（login.jsより前）
//
// ✅今回の追加点
// - once=true の「1回見たら出さない」を、
//   「一定時間が経過したら再度表示する（TTL）」に拡張。
// - onceExpire: true/false で切替可能
//   - false: 従来通り、1回OKで永続的に出さない
//   - true : 指定時間（onceExpireHours）経過で再度表示
//
// 注意：localStorage を使うため、シークレットモード等で保存できない場合は都度表示になります。

(function () {
  const CONFIG = {
    // 表示するメッセージ（〇/〇部分は displayFrom に置換）
    displayFrom: "2/6", // ← 任意の日付（例: "1/31" など）
    howtoUrl: "https://speach.modern.co.jp/howto.html",
    title: "お知らせ",

    // メッセージ切替
    // false: 従来の「利用できなくなる」告知
    // true : 「〇/〇以降のデータは反映されない」告知
    dataFreezeNotice: true,

    // true: 期間中は常にブロック（ログインできない）
    // false: 単に告知して、OKでログイン続行
    blockLogin: false,

    // 「指定日以降だけ表示」にしたい場合は startAt を使う（Asia/Tokyo想定のISO文字列推奨）
    // startAt: "2026-02-01T00:00:00+09:00",
    startAt: null,

    // 1回OK押したら、同一ブラウザでは再表示しない（基本は true 推奨）
    // ※ blockLogin=true のとき「一度OKで次回出ない」だと告知が弱くなるので、
    //   今回追加した onceExpire を true にして時間で再表示するのがおすすめ。
    once: true,
    onceKey: "maintenance_popup_seen_v1",

    // ✅追加：once の有効期限を使うか
    // true : seenAt から onceExpireHours 経過で再表示（TTL）
    // false: 従来通り、見たら永久に出さない
    onceExpire: false,

    // ✅追加：何時間後に再表示するか（onceExpire=true のときのみ有効）
    onceExpireHours: 6



  };

  // -----------------------------
  // 表示タイミング判定
  // -----------------------------
  function shouldShowNow() {
    // startAt 未指定なら常に表示対象
    if (!CONFIG.startAt) return true;

    // startAt 指定時は、その日時以降で表示
    const now = new Date();
    const start = new Date(CONFIG.startAt);
    return now >= start;
  }

  // -----------------------------
  // メッセージ生成
  // -----------------------------
function buildMessage() {
  // データ反映停止版
  if (CONFIG.dataFreezeNotice) {
    return `アップデートの為に${CONFIG.displayFrom}以降のデータはアップデート後には反映されません。
アップデート完了後改めて${CONFIG.howtoUrl}でご報告いたします。`;
  }

  // 従来版（サービス停止告知）
  return `アップデートの為、${CONFIG.displayFrom}からしばらくの間利用できなくなります。
アップデート完了後改めて${CONFIG.howtoUrl}でご報告いたします。`;
}


  // -----------------------------
  // localStorage（once）周り
  // -----------------------------
  // 保存形式：
  //  - 旧: "1"
  //  - 新: {"seenAt": 1700000000000}
  //
  // 旧形式が残っていても壊れないように両対応にする。
  function readOnceCache() {
    if (!CONFIG.once) return null;

    let raw;
    try {
      raw = localStorage.getItem(CONFIG.onceKey);
    } catch (_) {
      return null;
    }
    if (!raw) return null;

    // 旧形式 "1" を許容
    if (raw === "1") {
      return { seenAt: 0, legacy: true };
    }

    try {
      const data = JSON.parse(raw);
      if (data && typeof data.seenAt === "number") return data;
      return null;
    } catch (_) {
      return null;
    }
  }

  // 「今は再表示しない（キャッシュ有効）」なら true
  function hasValidOnceCache() {
    if (!CONFIG.once) return false;

    const data = readOnceCache();
    if (!data) return false;

    // onceExpire=false → 従来通り「一度見たら永久に出さない」
    // 旧形式 "1" もここで true 扱いにする
    if (!CONFIG.onceExpire) return true;

    // onceExpire=true → TTL判定
    // 旧形式の場合は seenAt が取れないため「期限切れ扱い」にして再表示するのが安全
    if (data.legacy) return false;

    const expireMs = Number(CONFIG.onceExpireHours) * 60 * 60 * 1000;
    if (!isFinite(expireMs) || expireMs <= 0) {
      // 設定ミス時：期限なし扱いにして「出さない」に倒す（運用上の安全策）
      return true;
    }

    return (Date.now() - data.seenAt) < expireMs;
  }

  function writeOnceCacheNow() {
    if (!CONFIG.once) return;
    try {
      localStorage.setItem(CONFIG.onceKey, JSON.stringify({ seenAt: Date.now() }));
    } catch (_) {
      // localStorageが使えない環境は無視
    }
  }

  // -----------------------------
  // モーダル生成
  // -----------------------------
  function ensureModal() {
    if (document.getElementById("maintModal")) return;

    const modal = document.createElement("div");
    modal.className = "maint-modal";
    modal.id = "maintModal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "maintModalTitle");

    modal.innerHTML = `
      <div class="maint-modal__backdrop" data-maint-close="1"></div>
      <div class="maint-modal__panel" role="document">
        <button class="maint-modal__close" aria-label="Close" data-maint-close="1">✕</button>
        <h2 class="maint-modal__title" id="maintModalTitle"></h2>
        <p class="maint-modal__body" id="maintModalBody"></p>
        <p class="maint-modal__note">
          詳細：<a href="${CONFIG.howtoUrl}" target="_blank" rel="noopener">${CONFIG.howtoUrl}</a>
        </p>
        <div class="maint-modal__actions">
          <button class="maint-modal__btn maint-modal__btn--primary" id="maintOkBtn">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // -----------------------------
    // close handlers
    // -----------------------------
    // 背景クリック / ×ボタン
    modal.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-maint-close") === "1") {
        closeModal();
      }
    });

    // OKボタン
    document.getElementById("maintOkBtn").addEventListener("click", () => closeModal());

    // ESCキー
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  // -----------------------------
  // 開く / 閉じる
  // -----------------------------
  function openModal() {
    ensureModal();

    const modal = document.getElementById("maintModal");
    const titleEl = document.getElementById("maintModalTitle");
    const bodyEl = document.getElementById("maintModalBody");

    if (titleEl) titleEl.textContent = CONFIG.title;
    if (bodyEl) bodyEl.textContent = buildMessage();

    modal.classList.add("is-open");

    // スクロール抑止
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    // フォーカス（OKへ）
    setTimeout(() => {
      const ok = document.getElementById("maintOkBtn");
      if (ok) ok.focus();
    }, 0);
  }

  function closeModal() {
    const modal = document.getElementById("maintModal");
    if (!modal) return;

    modal.classList.remove("is-open");

    // スクロール復帰
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";

    // once=true の場合は「見た」記録を残す（TTL対応：seenAtを書き込む）
    writeOnceCacheNow();
  }

  // -----------------------------
  // loginボタンをフックしてブロック
  // -----------------------------
  function hookLoginButton() {
    const btn = document.getElementById("loginBtn");
    if (!btn) return false;

    // 既存の login.js が click を登録していても、
    // capture（第3引数 true）で先に止める
    btn.addEventListener(
      "click",
      (e) => {
        // 表示対象期間外なら何もしない
        if (!shouldShowNow()) return;

        // 「まだ出す必要があるか？」（TTL含む）
        if (hasValidOnceCache()) return;

        // 開く
        openModal();

        // blockLogin=true のときはログイン処理を止める
        if (CONFIG.blockLogin) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
      },
      true
    );

    return true;
  }

  // -----------------------------
  // DOM準備後に表示 + フック
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // ✅「最初から表示」
    // - shouldShowNow() が true で
    // - once/TTL により「今は抑止しない」場合のみ表示
    if (shouldShowNow()) {
      if (!hasValidOnceCache()) {
        openModal();
      }
    }

    // ✅念のため：ログインボタン押下でも止めたい場合はフックを残す
    hookLoginButton();
  });

  // -----------------------------
  // 外部から設定変更したい場合用
  // -----------------------------
  window.__MAINT_POPUP__ = {
    open: openModal,
    close: closeModal
  };
})();
