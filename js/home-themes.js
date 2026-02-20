// /js/home-themes.js — 完全版（ES Modules）
// テーマ一覧（home側）
// - api.js（認証付き）で /api/themes /api/me を取得
// - free/user は「データ自体」を初級〜超級＆二択に制限（一覧に出さない）
// - フィルタ（LV/タイプ） + ページング（SP:3 / PC:5）
// - 10秒スピーチチャレンジ選択時は maxTime=10 を必ず保存
// - col-q は ruby を崩さず 1行…省略を強制（CSS !important に勝つ）

import { bindLevelTypeFilter } from "../common/level-type-rules.js";
import api from "./api.js";

(() => {
  "use strict";

  // ==== 設定 ==========================================================
  const THEMES_ENDPOINT = "/api/themes";
  const ME_ENDPOINT     = "/api/me";

  // ★ 10秒レベル定義
  const LEVEL_10S = "10秒スピーチチャレンジ";
  const DURATION_10S = 10;

  // ★ free/user の閲覧制限（必要に応じて変更）
  const FREE_LEVELS = ["初級", "中級", "上級", "超級"];
  const FREE_TYPES  = ["二択"];

  function getPageSize() {
    return window.innerWidth <= 768 ? 3 : 5;
  }
  let lastPageSize = getPageSize();

  // ==== 要素参照 ======================================================
  const $tbody       = document.getElementById("promptList");
  const $pagination  = document.getElementById("pagination");
  const $filterLevel = document.getElementById("filterLevel");
  const $filterType  = document.getElementById("filterType");
  const $filterReset = document.getElementById("filterReset");

  if (!$tbody || !$pagination) {
    console.warn("[home-themes] 必要なDOMが見つかりません。HTMLのIDを確認してください。");
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
    if (!Number.isNaN(ia) && !Number.isNaN(ib) && ia !== ib) return ia - ib;

    // ③ 念のため sub
    const sa = Number(a.sub);
    const sb = Number(b.sub);
    if (!Number.isNaN(sa) && !Number.isNaN(sb)) return sa - sb;

    return 0;
  }

  // ==== ステート ======================================================
  /** @type {Array<{id?:string|number, level:string, sub:string|number, type:string, question:string}>} */
  let allPrompts = [];
  let currentPage = 1;

  // /api/me キャッシュ
  let meCache = null;

  // ==== ユーティリティ ================================================
  const norm = (v) => String(v ?? "").trim();

  function requireToken() {
    const token = localStorage.getItem("authToken");
    if (!token) {
      location.href = "login.html";
      return null;
    }
    return token;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /**
   * question専用サニタイズ：
   * - rubyなど必要最小限のみ許可
   * - <br> は強制改行なので「空白」に変換（1行…省略のため）
   */
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
          if (tag === "BR") return document.createTextNode(" ");
          const el = document.createElement(tag.toLowerCase());
          node.childNodes.forEach((child) => el.appendChild(rebuild(child)));
          return el;
        }

        const frag = document.createDocumentFragment();
        node.childNodes.forEach((child) => frag.appendChild(rebuild(child)));
        return frag;
      }
      return document.createDocumentFragment();
    }

    const frag = document.createDocumentFragment();
    if (container) container.childNodes.forEach((n) => frag.appendChild(rebuild(n)));
    return frag;
  }

  // ==== ★ここが肝：CSSの !important にも勝つ「1行…」強制 =====================
  function forceSingleLineEllipsis(el) {
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("white-space", "nowrap", "important");
    el.style.setProperty("overflow", "hidden", "important");
    el.style.setProperty("text-overflow", "ellipsis", "important");

    el.style.setProperty("min-width", "0", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("width", "100%", "important");

    el.style.setProperty("-webkit-line-clamp", "unset", "important");
    el.style.setProperty("-webkit-box-orient", "unset", "important");

    el.querySelectorAll("ruby, rb, rt, rp").forEach((n) => {
      n.style.setProperty("white-space", "inherit", "important");
    });
  }

  function clampAllQs() {
    document.querySelectorAll("#promptList .col-q").forEach(forceSingleLineEllipsis);
  }

  // ==== ★ 10秒テーマ選択時：遷移前に設定時間を10秒へ保存 =====================
  function force10SecondsSettingIfNeeded(prompt) {
    const level = norm(prompt?.level);
    if (level !== LEVEL_10S) return;

    let s = {};
    try { s = JSON.parse(localStorage.getItem("appSetting") || "{}"); } catch {}

    // level / maxTime を確実に矯正
    s.level = LEVEL_10S;
    s.maxTime = DURATION_10S;

    localStorage.setItem("appSetting", JSON.stringify(s));

    try {
      document.dispatchEvent(new CustomEvent("app:settingChanged", { detail: s }));
    } catch {}
  }

  // ==== 権限（free/pro）で一覧データ自体を絞る ===========================
  async function fetchMe() {
    if (meCache) return meCache;

    // api.get は api.js で unwrap 済み（/api/me が {ok,user} でも user が返る想定）
    const me = await api.get(ME_ENDPOINT, { cache: "no-cache" });
    meCache = me;
    return me;
  }

  function isAdminLike(me) {
    const role = String(me?.role || "user").toLowerCase();
    return role === "admin" || role === "owner";
  }

  function isPro(me) {
    const course = String(me?.course_id || "free").toLowerCase();
    return course === "pro";
  }

  function applyEntitlementFilter(list, me) {
    if (isAdminLike(me) || isPro(me)) return list; // 全件OK

    return list.filter(p => {
      const lv = String(p?.level || "").trim();
      const tp = String(p?.type  || "").trim();
      return FREE_LEVELS.includes(lv) && FREE_TYPES.includes(tp);
    });
  }

  // ==== 描画 ==========================================================
  function renderFilters() {
    // filter-options.js（静的）を使う運用ならここでは何もしない
    if (window.USE_STATIC_FILTERS) return;
  }

  function getFilteredList() {
    const lv = $filterLevel ? $filterLevel.value : "";
    const tp = $filterType  ? $filterType.value  : "";
    return allPrompts.filter((p) => (!lv || p.level === lv) && (!tp || p.type === tp));
  }

  function renderTableRows(list) {
    if (!$tbody) return;
    $tbody.innerHTML = "";

    if (list.length === 0) {
      $tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">該当するお題がありません</td></tr>`;
      return;
    }

    list.forEach((prompt) => {
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
        // ★ 選択テーマ保存
        try { localStorage.setItem("selectedPrompt", JSON.stringify(prompt)); } catch {}

        // ★ 10秒テーマなら、遷移前に必ず maxTime=10 を保存
        force10SecondsSettingIfNeeded(prompt);

        // ★ 遷移（home側は html/ 配下へ）
        location.href = "html/contents001.html";
      });

      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter") tr.click();
      });

      $tbody.appendChild(tr);
    });

    clampAllQs();
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
      if (currentPage > 1) {
        currentPage--;
        render();
      }
    });

    document.getElementById("pageNext")?.addEventListener("click", () => {
      const pageSizeNow = getPageSize();
      const max = Math.ceil(getFilteredList().length / pageSizeNow) || 1;
      if (currentPage < max) {
        currentPage++;
        render();
      }
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
      // まずトークンが無ければログインへ
      if (!requireToken()) return;

      // 1) テーマ一覧
      const data = await api.get(THEMES_ENDPOINT, { cache: "no-cache" });

      // API互換：配列直返し / {all:[...]} / {themes:[...]} の全対応
      const list = Array.isArray(data) ? data : (data?.all || data?.themes || []);
      if (!Array.isArray(list) || list.length === 0) {
        showErrorRow("お題がありません");
        return;
      }

      // 2) 権限取得（失敗したら安全側＝freeで絞る）
      let me = null;
      try {
        me = await fetchMe();
      } catch (e) {
        console.warn("[home-themes] /api/me 取得に失敗。安全側に倒します。", e);
        me = { role: "user", course_id: "free" };
      }

      // 3) freeなら一覧データ自体を制限
      allPrompts = applyEntitlementFilter(list, me);

      // 4) freeで「全てのLV/タイプ」が選ばれていたら、値を空に戻す（UIは別ファイルが作るので値だけ）
      if (!isAdminLike(me) && !isPro(me)) {
        if ($filterLevel && $filterLevel.value && !FREE_LEVELS.includes($filterLevel.value)) $filterLevel.value = "";
        if ($filterType  && $filterType.value  && !FREE_TYPES.includes($filterType.value))  $filterType.value  = "";
      }

      renderFilters();
      currentPage = 1;
      render();
    } catch (err) {
      const msg = err?.body?.error || err?.message || "取得失敗";
      showErrorRow(`取得失敗: ${escapeHtml(msg)}`);
    }
  }

  function showErrorRow(message) {
    if ($tbody) {
      $tbody.innerHTML = `<tr><td colspan="4" style="color:#b91c1c;">${escapeHtml(message)}</td></tr>`;
    }
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
    // filter-options.js が option を差し替える想定があるため、少し待ってから bind する
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

    // 初回適用（面接対応などの無効化）
    reapply();

    // LVが変わったら必ず再適用
    $filterLevel?.addEventListener("change", reapply);

    // 外部から再適用できるように（デバッグ/再描画用）
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
