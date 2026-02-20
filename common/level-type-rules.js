// /common/level-type-rules.js（完全版：proは全解放 / USE_STATIC_FILTERS尊重）
const norm = (v) => String(v ?? "").trim();

// レベル/タイプ定義（既存の運用を踏襲）
const LEVEL_GROUP_MAIN = ["初級", "中級", "上級", "超級","面接対応"];
const LEVEL_10S = "10秒スピーチチャレンジ";
const LEVEL_60S = "小中学生のための60秒スピーチ";
const LEVEL_40S = "大学生のための就活面接40秒スピーチ";

const TYPE_TWO = "二択";
const TYPE_SINGLE = "単体";
const TYPE_NONE = "なし";

// 60秒/40秒系の type グループ（必要なら増やしてください）
const TYPES_60S = [
  "自分のこと",
  "学校生活・友だち",
  "家族・家のこと",
  "趣味・好きなもの",
  "社会・世界・地域",
  "夢・将来",
  "心・考え・生き方",
  "チャレンジ・希望",
];

const TYPES_40S = [
  "基本情報・自己紹介",
  "学業・研究内容",
  "経験・エピソード",
  "価値観・考え方",
  "将来・キャリアビジョン",
  "時事・一般常識・その他",
];

function getUserProfile() {
  try {
    const raw = localStorage.getItem("userProfile");
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function getJwtPayload() {
  const t = localStorage.getItem("authToken");
  if (!t) return {};
  try {
    const b = t.split(".")[1] || "";
    const pad = "=".repeat((4 - (b.length % 4)) % 4);
    const json = atob((b + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return {};
  }
}

/**
 * admin と同等に扱うか？
 * - admin / owner
 * - user でも course_id === "pro"
 */
function isAdminLike() {
  const p = getJwtPayload();
  const prof = getUserProfile();

  const role = String(p.role ?? prof.role ?? "").toLowerCase();
  const courseId = String(p.course_id ?? p.courseId ?? prof.course_id ?? prof.courseId ?? "").toLowerCase();

  if (role === "admin" || role === "owner") return true;
  if (role === "user" && courseId === "pro") return true;
  return false;
}

/* ===============================
 * レベル ⇄ タイプ制約
 * =============================== */
export function allowedTypesForLevel(level) {
  const lv = norm(level);
  if (!lv) return null;

  if (LEVEL_GROUP_MAIN.map(norm).includes(lv)) return [TYPE_TWO, TYPE_SINGLE];
  if (lv === norm(LEVEL_10S)) return [TYPE_NONE];
  if (lv === norm(LEVEL_60S)) return TYPES_60S.slice(0);
  if (lv === norm(LEVEL_40S)) return TYPES_40S.slice(0);
  // 面接対応など、追加で制約が必要ならここで
  return null;
}

export function allowedLevelsForType(type, allLevels) {
  const tp = norm(type);
  if (!tp) return null;

  const all = Array.isArray(allLevels) ? allLevels.map(norm) : null;
  const inAll = (x) => !all || all.includes(norm(x));

  if (tp === norm(TYPE_TWO) || tp === norm(TYPE_SINGLE)) return LEVEL_GROUP_MAIN.filter(inAll);
  if (tp === norm(TYPE_NONE)) return [LEVEL_10S].filter(inAll);
  if (TYPES_60S.map(norm).includes(tp)) return [LEVEL_60S].filter(inAll);
  if (TYPES_40S.map(norm).includes(tp)) return [LEVEL_40S].filter(inAll);
  return null;
}

/* ===============================
 * フィルター適用（表示制御）
 * =============================== */
export function bindLevelTypeFilter(levelSel, typeSel, opts = {}) {
  if (!levelSel || !typeSel) return;
  const allowBlank = opts.allowBlank !== false;

  // ★ admin / owner / user+pro を「全解放」にする判定
  const adminLike = isAdminLike();

  const ALL_LEVELS = [
    ...LEVEL_GROUP_MAIN,
    "面接対応",
    LEVEL_10S,
    LEVEL_60S,
    LEVEL_40S,
  ];
  const BASIC_LEVELS = [...LEVEL_GROUP_MAIN]; // free/user用（初級〜超級だけ）

  const allowedLevels = adminLike ? ALL_LEVELS : BASIC_LEVELS;

  // ====== 重要：すでにHTMLに全部optionが入っていても「削って制限する」 ======
  // （USE_STATIC_FILTERS の有無に関係なく必ず適用）
  const allowedSet = new Set(allowedLevels.map(norm));

  // blank(全て) は常に残す
  const isBlank = (v) => allowBlank && norm(v) === "";

  // 1) level option を削る（非許可は消す）
  Array.from(levelSel.options).forEach((opt) => {
    const v = opt.value;
    if (isBlank(v)) return;
    if (!allowedSet.has(norm(v))) {
      opt.remove(); // ← ここで free から「10秒/60秒/40秒/面接対応」を消す
    }
  });

  // 現在値が消えた場合は補正
  if (!Array.from(levelSel.options).some(o => o.value === levelSel.value)) {
    levelSel.value = allowBlank ? "" : (levelSel.options[0]?.value || "");
  }

  const getAllLevels = () => Array.from(levelSel.options).map(o => o.value);

  const enableAllTypes = () => {
    Array.from(typeSel.options).forEach(o => (o.disabled = false));
  };

  const setTypeDisabledByLevel = () => {
    const lv = norm(levelSel.value);

    // 「全て」(空) の場合はタイプ制限解除
    if (allowBlank && lv === "") { enableAllTypes(); return; }

    const allowed = allowedTypesForLevel(lv);
    if (!allowed) { enableAllTypes(); return; }

    const set = new Set(allowed.map(norm));
    Array.from(typeSel.options).forEach(o => {
      if (allowBlank && norm(o.value) === "") { o.disabled = false; return; }
      o.disabled = !set.has(norm(o.value));
    });

    // 現在タイプが無効なら有効な先頭へ
    const cur = typeSel.selectedOptions?.[0];
    if (cur?.disabled) {
      const next = Array.from(typeSel.options).find(o => !o.disabled);
      typeSel.value = next ? next.value : (allowBlank ? "" : (typeSel.options[0]?.value || ""));
    }
  };

  const setLevelByType = () => {
    const tp = norm(typeSel.value);
    if (allowBlank && tp === "") return;
    if (allowBlank && norm(levelSel.value) === "") return;

    const allowed = allowedLevelsForType(tp, getAllLevels());
    if (!allowed || !allowed.length) return;

    if (!allowed.map(norm).includes(norm(levelSel.value))) {
      levelSel.value = allowed[0];
    }
  };

  // 初回
  setTypeDisabledByLevel();
  setLevelByType();
  setTypeDisabledByLevel();

  // 多重バインド防止
  if (!levelSel.__bindLevelTypeFilterBound) {
    levelSel.__bindLevelTypeFilterBound = true;

    levelSel.addEventListener("change", () => setTypeDisabledByLevel());
    typeSel.addEventListener("change", () => { setLevelByType(); setTypeDisabledByLevel(); });
  }
}
