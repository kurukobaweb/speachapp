/* themes.js — テーマ一覧（常時表示 / レスポンシブ件数 / フィルタ＆ページネーション）
   ルビ(<ruby><rt>…</rt></ruby>)を安全に表示するため、questionのみホワイトリスト型でサニタイズして描画します。

   ★重要：
   - これまでは「フィルターUIの選択肢」だけ制限していたため、free/user でも全テーマが表示されることがありました。
   - 本ファイルでは /api/me の course_id を見て、「一覧データ自体」を free なら絞り込みます。
*/
import { bindLevelTypeFilter } from "../common/level-type-rules.js";

(() => {
  "use strict";

  // ==== 設定 ==========================================================
  const API_BASE =
    (window.ENV && window.ENV.API_BASE) ||
    localStorage.getItem("API_BASE") ||
    (location.hostname === "localhost"
      ? "http://localhost:8200"                                  // 開発
      : "https://my-api-436216861937.asia-northeast1.run.app");  // 本番

  const THEMES_ENDPOINT = "/api/themes";
  const ME_ENDPOINT     = "/api/me";

  // ★ 10秒レベル定義
  const LEVEL_10S = "10秒スピーチチャレンジ";
  const DURATION_10S = 10;

  // ★ free/user の閲覧制限（必要に応じて変更してください）
  // 例：無料は初級〜超級＆二択のみ
  const FREE_LEVELS = ["初級", "中級", "上級", "超級"];
  const FREE_TYPES  = ["二択"];

  // SP:3件 / PC:7件 を返す
  function getPageSize() {
    return window.innerWidth <= 768 ? 3 : 7;
  }
  let lastPageSize = getPageSize();

  // ==== 要素参照 ======================================================
  const $tbody       = document.getElementById("promptList");    // <tbody>
  const $pagination  = document.getElementById("pagination");    // ページャ
  const $filterLevel = document.getElementById("filterLevel");   // LV セレクト
  const $filterType  = document.getElementById("filterType");    // タイプ セレクト
  const $filterReset = document.getElementById("filterReset");   // リセットボタン

  if (!$tbody || !$pagination) {
    console.warn("[themes] 必要なDOMが見つかりません。HTMLのIDを確認してください。");
  }

  // レベル表示順（数値が小さいほど上）
  const LEVEL_ORDER = {
    "初級": 1,
    "中級": 2,
    "上級": 3,
    "超級": 4,
    "面接対応": 5,
    "10秒スピーチチャレンジ": 6,
    "小中学生のための60秒スピーチ": 7,
    "大学生のための就活面接40秒スピーチ": 8,
  };

  function compareByLevelOrderThenId(a, b) {
    // ① レベル順
    const la = LEVEL_ORDER[a.level] ?? 999;
    const lb = LEVEL_ORDER[b.level] ?? 999;
    if (la !== lb) return la - lb;

    // ② 通し id 順（最重要）
    const ia = Number(a.id);
    const ib = Number(b.id);
    if (!Number.isNaN(ia) && !Number.isNaN(ib) && ia !== ib) {
      return ia - ib;
    }

    // ③ 念のため sub
    const sa = Number(a.sub);
    const sb = Number(b.sub);
    if (!Number.isNaN(sa) && !Number.isNaN(sb)) {
      return sa - sb;
    }

    return 0;
  }

  // ==== ステート ======================================================
  /** @type {Array<{id?:string|number, level:string, sub:string|number, type:string, question:string}>} */
  let allPrompts = [];
  let currentPage = 1;

  // /api/me のキャッシュ
  let meCache = null;

  // ==== ユーティリティ ================================================
  const norm = (v) => String(v ?? "").trim();

  function requireToken() {
    const token = localStorage.getItem("authToken");
    if (!token) {
      location.href = "login.html"; // ログイン必須
      return null;
    }
    return token;
  }

  function authFetch(url, opts = {}) {
    const token = requireToken();
    if (!token) return Promise.reject(new Error("No token"));

    const headers = new Headers(opts.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    // GETでもContent-Typeを入れて問題ないが、ここは既存方針に合わせて「GET以外のみ」
    if (opts.method && opts.method !== "GET") {
      headers.set("Content-Type", "application/json");
    }

    const full = url.startsWith("/") ? API_BASE + url : url;
    return fetch(full, { ...opts, headers });
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /** question専用サニタイズ：rubyタグなど必要最小限だけ許可して安全に復元 */
  function sanitizeQuestionHtml(inputHtml) {
    const ALLOW = new Set(["RUBY", "RT", "RB", "RP", "BR", "B", "I", "STRONG", "EM"]);
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${inputHtml || ""}</div>`, "text/html");
    const container = doc.body.firstElementChild;

    function rebuild(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.nodeValue || "");
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toUpperCase();
        if (ALLOW.has(tag)) {
          const el = document.createElement(tag.toLowerCase());
          node.childNodes.forEach(child => el.appendChild(rebuild(child)));
          return el;
        }
        const frag = document.createDocumentFragment();
        node.childNodes.forEach(child => frag.appendChild(rebuild(child)));
        return frag;
      }
      return document.createDocumentFragment();
    }

    const frag = document.createDocumentFragment();
    container.childNodes.forEach((n) => frag.appendChild(rebuild(n)));
    return frag;
  }

  // ==== ★ 10秒テーマ選択時：遷移前に設定時間を10秒へ保存 =====================
  function force10SecondsSettingIfNeeded(prompt) {
    const level = norm(prompt?.level);
    if (level !== LEVEL_10S) return;

    let s = {};
    try { s = JSON.parse(localStorage.getItem("appSetting") || "{}"); } catch {}

    s.level = LEVEL_10S;
    s.maxTime = DURATION_10S;

    // 10秒チャレンジが type=なし 仕様なら、ここで揃える（不要ならコメントアウト）
    // s.type = "なし";

    localStorage.setItem("appSetting", JSON.stringify(s));

    try {
      document.dispatchEvent(new CustomEvent("app:settingChanged", { detail: s }));
    } catch {}
  }

  // ==== 権限（free/pro）で一覧データ自体を絞る ===========================
  async function fetchMe() {
    if (meCache) return meCache;

    const res = await authFetch(ME_ENDPOINT, { method: "GET", cache: "no-cache" });
    if (!res.ok) throw new Error(`APIエラー: ${res.status}`);

    const raw = await res.json();
    // 互換：{ok:true, user:{...}} / {payload:{...}} / user直返し など吸収
    const u = raw?.user || raw?.payload?.user || raw?.payload || raw;

    meCache = u;
    return u;
  }

  function isAdminLike(me) {
    const role = String(me?.role || "user").toLowerCase();
    return role === "admin" || role === "owner";
  }

  function isPro(me) {
    // course_id が pro なら pro 扱い（subscription_status を持つならそれも追加可能）
    const course = String(me?.course_id || "free").toLowerCase();
    return course === "pro";
  }

  function applyEntitlementFilter(list, me) {
    if (isAdminLike(me) || isPro(me)) return list; // 全件OK

    // free/user 制限：レベルとタイプで絞る（一覧に出さない）
    const out = list.filter(p => {
      const lv = String(p?.level || "").trim();
      const tp = String(p?.type  || "").trim();
      return FREE_LEVELS.includes(lv) && FREE_TYPES.includes(tp);
    });

    return out;
  }

  // ==== 描画 ==========================================================
  function renderFilters() {
    if (window.USE_STATIC_FILTERS) return; // 共通の静的メニューに任せる
    // ここに動的生成を書く場合は拡張
  }

  function getFilteredList() {
    const lv = $filterLevel ? $filterLevel.value : "";
    const tp = $filterType ? $filterType.value : "";
    return allPrompts.filter(p => (!lv || p.level === lv) && (!tp || p.type === tp));
  }

  function renderTableRows(list) {
    if (!$tbody) return;
    $tbody.innerHTML = "";

    if (list.length === 0) {
      $tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">該当するお題がありません</td></tr>`;
      return;
    }

    list.forEach(prompt => {
      const tr = document.createElement("tr");
      tr.className = "finder-row";
      tr.tabIndex = 0;

      const tdLv = document.createElement("td");
      tdLv.className = "col-lv";
      tdLv.textContent = prompt.level ?? "";
      tr.appendChild(tdLv);

      const tdNo = document.createElement("td");
      tdNo.className = "col-no";
      tdNo.textContent = String(prompt.sub ?? "");
      tr.appendChild(tdNo);

      const tdType = document.createElement("td");
      tdType.className = "col-type";
      tdType.textContent = prompt.type ?? "";
      tr.appendChild(tdType);

      const tdQ = document.createElement("td");
      tdQ.className = "col-q";
      tdQ.appendChild(sanitizeQuestionHtml(prompt.question ?? ""));
      tr.appendChild(tdQ);

      tr.addEventListener("click", () => {
        try { localStorage.setItem("selectedPrompt", JSON.stringify(prompt)); } catch {}

        // ★ 10秒テーマなら、遷移前に必ず maxTime=10 を保存
        force10SecondsSettingIfNeeded(prompt);

        location.href = "contents001.html";
      });

      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") tr.click(); });

      $tbody.appendChild(tr);
    });

    // ルビ対応 1行クランプ（※lines指定を尊重）
    clampAllQs(1);
  }

  function renderPagination(total, page, pageSize) {
    if (!$pagination) return;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) currentPage = totalPages;

    if (totalPages <= 1) {
      $pagination.innerHTML = "";
      return;
    }

    $pagination.innerHTML = `
      <button class="btn-page" id="pagePrev" ${page <= 1 ? "disabled" : ""} aria-label="前のページ">←</button>
      <span class="page-indicator" aria-live="polite">${page} / ${totalPages}</span>
      <button class="btn-page" id="pageNext" ${page >= totalPages ? "disabled" : ""} aria-label="次のページ">→</button>
    `;

    document.getElementById("pagePrev")?.addEventListener("click", () => {
      if (currentPage > 1) { currentPage--; render(); }
    });
    document.getElementById("pageNext")?.addEventListener("click", () => {
      const pageSizeNow = getPageSize();
      const max = Math.ceil(getFilteredList().length / pageSizeNow) || 1;
      if (currentPage < max) { currentPage++; render(); }
    });
  }

  function render() {
    const pageSizeNow = getPageSize();
    const list = getFilteredList().sort(compareByLevelOrderThenId);
    const total = list.length;

    if (pageSizeNow !== lastPageSize) {
      currentPage = 1;
      lastPageSize = pageSizeNow;
    }

    const start = (currentPage - 1) * pageSizeNow;
    const pageList = list.slice(start, start + pageSizeNow);

    renderTableRows(pageList);
    renderPagination(total, currentPage, pageSizeNow);
  }

  // ==== 取得処理 ======================================================
  async function fetchThemes() {
    if ($tbody) $tbody.innerHTML = `<tr><td colspan="4">読み込み中...</td></tr>`;
    if ($pagination) $pagination.innerHTML = "";

    try {
      // 1) themes取得
      const res = await authFetch(THEMES_ENDPOINT, { method: "GET" });
      if (!res || !res.ok) {
        const msg = res
          ? `APIエラー: ${res.status} ${res.statusText || ""}`.trim()
          : "ネットワークエラー";
        showErrorRow(msg);
        return;
      }
      const data = await res.json();

      // API互換：配列直返し / {all:[...]} / {themes:[...]} の全対応
      const list = Array.isArray(data) ? data : (data?.all || data?.themes || []);
      if (!Array.isArray(list) || list.length === 0) {
        showErrorRow("お題がありません");
        return;
      }

      // 2) /api/me 取得 → 権限で絞り込み
      let me = null;
      try {
        me = await fetchMe();
      } catch (e) {
        // /api/me 失敗時は安全側（＝free扱い）に倒す
        me = { role: "user", course_id: "free" };
        console.warn("[themes] /api/me 取得に失敗。安全側に倒します。", e);
      }

      allPrompts = applyEntitlementFilter(list, me);

      // 3) もし free 側で「全てのLV/タイプ」が残ってると混乱するので、フィルタ値を初期化
      // （UIは別ファイルが制御しているので、ここでは値だけ安全に戻す）
      if (!isAdminLike(me) && !isPro(me)) {
        if ($filterLevel && $filterLevel.value && !FREE_LEVELS.includes($filterLevel.value)) $filterLevel.value = "";
        if ($filterType  && $filterType.value  && !FREE_TYPES.includes($filterType.value))  $filterType.value  = "";
      }

      renderFilters();
      currentPage = 1;
      render();
    } catch (err) {
      showErrorRow(`取得失敗: ${err?.message || err}`);
    }
  }

  function showErrorRow(message) {
    if ($tbody) $tbody.innerHTML = `<tr><td colspan="4" style="color:#b91c1c;">${escapeHtml(message)}</td></tr>`;
  }

  // ==== イベント ======================================================
  $filterLevel?.addEventListener("change", () => { currentPage = 1; render(); });
  $filterType ?.addEventListener("change", () => { currentPage = 1; render(); });
  $filterReset?.addEventListener("click", () => {
    if ($filterLevel) $filterLevel.value = "";
    if ($filterType)  $filterType.value  = "";
    currentPage = 1;
    render();
  });

  window.addEventListener("resize", debounce(() => render(), 120));

  // ==== 起動 ==========================================================
  document.addEventListener("DOMContentLoaded", async () => {
    // filter-options.js が option を差し替えるので、optionが揃ってから bind
    const waitOptions = (sel, min = 2, timeoutMs = 2500) =>
      new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          if (sel && sel.options && sel.options.length >= min) return resolve(true);
          if (Date.now() - start > timeoutMs) return resolve(false);
          setTimeout(tick, 30);
        };
        tick();
      });

    await waitOptions($filterLevel, 2);
    await waitOptions($filterType, 2);

    const reapply = () => bindLevelTypeFilter($filterLevel, $filterType, { allowBlank: true });

    // 初回適用（面接対応 → 二択/単体以外 disabled）
    reapply();

    // LVが変わったら必ず再適用（ここが本命）
    $filterLevel?.addEventListener("change", reapply);

    // filter-options.js が option を作り直した後にも呼べるように公開
    window.reapplyLevelTypeFilter = reapply;

    if (!requireToken()) return;
    fetchThemes();
  });

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
})();

/* ===== ルビ対応 1行クランプ（互換） ===== */
function clampAllQs(lines = 1) {
  document.querySelectorAll("td.col-q").forEach((td) => clampRubyCell(td, lines));
}

function clampRubyCell(td, lines = 1) {
  let wrap = td.querySelector(".qtext");
  if (!wrap) {
    const w = document.createElement("div");
    w.className = "qtext";
    w.dataset.original = td.innerHTML;
    while (td.firstChild) w.appendChild(td.firstChild);
    td.appendChild(w);
    wrap = w;
  } else if (wrap.dataset.original) {
    wrap.innerHTML = wrap.dataset.original;
  }

  wrap.querySelectorAll("br").forEach((br) => br.replaceWith(document.createTextNode(" ")));

  wrap.style.setProperty("display", "block", "important");
  wrap.style.setProperty("white-space", "nowrap", "important");
  wrap.style.setProperty("overflow", "hidden", "important");
  wrap.style.setProperty("text-overflow", "ellipsis", "important");

  wrap.style.setProperty("min-width", "0", "important");
  wrap.style.setProperty("max-width", "100%", "important");
  wrap.style.setProperty("width", "100%", "important");

  // lines は将来 multi-line clamp へ拡張できるが、ruby互換優先で nowrap を維持
  wrap.style.setProperty("-webkit-line-clamp", "unset", "important");
  wrap.style.setProperty("-webkit-box-orient", "unset", "important");

  wrap.querySelectorAll(".q-ellipsis").forEach((n) => n.remove());

  wrap.querySelectorAll("ruby, rb, rt, rp").forEach((n) => {
    n.style.setProperty("white-space", "inherit", "important");
  });
}
