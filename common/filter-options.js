// /common/filter-options.js（差し替え版：LV順序固定対応）
import api from "../js/api.js"; // パスは配置に合わせて調整

(() => {
  // 既定（管理者や有料コース用）
  const DEFAULT_LEVELS = [
    "初級","中級","上級","超級","面接対応",
    "10秒スピーチチャレンジ",
    "小中学生のための60秒スピーチ",
    "大学生のための就活面接40秒スピーチ"
  ];

  const DEFAULT_TYPES  = [
    "二択","単体","なし",
    "自分のこと","学校生活・友だち","家族・家のこと","趣味・好きなもの","社会・世界・地域",
    "夢・将来","心・考え・生き方","チャレンジ・希望",
    "基本情報・自己紹介","学業・研究内容","経験・エピソード","価値観・考え方",
    "将来・キャリアビジョン","時事・一般常識・その他"
  ];

  // free 制限
  const FREE_LEVELS = ["初級", "中級", "上級", "超級"];
  const FREE_TYPES  = ["二択"];

  // ★LV表示順（あなたの指定順）
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

  function sortLevels(levels) {
    const arr = Array.isArray(levels) ? levels.slice() : [];
    return arr.sort((a, b) => {
      const aa = String(a ?? "").trim();
      const bb = String(b ?? "").trim();
      const oa = LEVEL_ORDER[aa] ?? 999;
      const ob = LEVEL_ORDER[bb] ?? 999;
      if (oa !== ob) return oa - ob;
      // 未定義同士は文字列順で安定化（任意）
      return aa.localeCompare(bb, "ja");
    });
  }

  // 他JSがフィルターを上書きしないよう固定（themes.js / home-themes.js が参照）
  window.USE_STATIC_FILTERS = true;

  // 既存の authFetch / API_BASE があれば流用
  async function af(url, opts = {}) {
    opts.headers = opts.headers || {};
    const t = localStorage.getItem('authToken') || '';
    if (t) opts.headers.Authorization = `Bearer ${t}`;
    const base = window.API_BASE || "https://my-api-436216861937.asia-northeast1.run.app";
    if (url.startsWith('/')) url = base + url;
    return fetch(url, opts);
  }

  // /api/theme-options があればそれを使う（サーバが最終判断）
async function getAllowed(){
  // 1) サーバが最終判断するAPIがあるなら優先
  try{
    const res = await api.getRaw("/api/theme-options"); // rawで取得
    if (res && res.levels && res.types) {
      return { levels: res.levels, types: res.types, role: res.role, course: res.course };
    }
    // {ok,payload} などの場合
    if (res?.payload?.levels && res?.payload?.types) {
      return { levels: res.payload.levels, types: res.payload.types, role: res.payload.role, course: res.payload.course };
    }
  } catch (_) {}

  // 2) 無ければ /api/me を見て pro/free 判定
  let me = null;
  try {
    me = await api.get("/api/me"); // unwrap済みなら user が返る
  } catch (_) {}

  const role = (me?.role || "user").toLowerCase();
  const course = (me?.course_id || "free").toLowerCase();

  if (role === "admin" || role === "owner" || course === "pro") {
    return { role, course, levels: DEFAULT_LEVELS, types: DEFAULT_TYPES };
  }
  return { role, course, levels: FREE_LEVELS, types: FREE_TYPES };
}

  function fillAll(selector, items, allLabel) {
    document.querySelectorAll(selector).forEach(sel => {
      if (!(sel instanceof HTMLSelectElement)) return;
      const prev = sel.value || "";
      sel.innerHTML =
        `<option value="">${allLabel}</option>` +
        items.map(v => `<option value="${v}">${v}</option>`).join("");
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    });
  }


  function parseJwt(){
    const t = localStorage.getItem('authToken'); if(!t) return {};
    try{
      const b = t.split('.')[1] || '';
      const pad = '='.repeat((4 - (b.length % 4)) % 4);
      const json = atob((b + pad).replace(/-/g,'+').replace(/_/g,'/'));
      return JSON.parse(decodeURIComponent(escape(json)));
    }catch{ return {}; }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const { levels, types } = await getAllowed();

    // ★ここで順序固定
    const sortedLevels = sortLevels(levels);

    // data-filter="level"/"type" と既存IDの両方を埋める
    fillAll('select[data-filter="level"], #filterLevel, #fLevel', sortedLevels, "全てのLV");
    fillAll('select[data-filter="type"],  #filterType,  #fType',  types,       "全てのタイプ");
    window.reapplyLevelTypeFilter?.();

  });
})();
