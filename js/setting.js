import api from './api.js';

// /js/setting.js — 完全版（モーダル注入 + プラン制限適用 + 保存/復元 + 新旧両対応 + 10秒レベル自動10秒）
(() => {
  'use strict';

  /* ========= 基本設定 ========= */
  const API_BASE =
    (window.ENV && window.ENV.API_BASE) ||
    localStorage.getItem("API_BASE") ||
    (location.hostname === "localhost"
      ? "http://localhost:8200"                                  // 開発
      : "https://my-api-436216861937.asia-northeast1.run.app");  // 本番


      
  // setting-modal.html の候補パス（上から順に試行）
  const MODAL_CANDIDATES = [
    //'setting-modal.html',
    //'/japanesespeech/setting-modal.html',
    //'/common/setting-modal.html',
    //'/setting-modal.html',
    '/html/setting-modal.html',
  ];

  /* ========= レベル × タイプ 連動（UI制約） ========= */
  const LEVEL_GROUP_MAIN = ['初級','中級','上級','超級','面接対応'];
  const LEVEL_10S  = '10秒スピーチチャレンジ';
  const LEVEL_60S  = '小中学生のための60秒スピーチ';
  const LEVEL_40S  = '大学生のための就活面接40秒スピーチ';

  const TYPE_TWO   = '二択';
  const TYPE_SINGLE= '単体';
  const TYPE_NONE  = 'なし';

  const TYPES_60S = ['自分のこと','学校生活・友だち','家族・家のこと','趣味・好きなもの','社会・世界・地域','夢・将来','心・考え・生き方','チャレンジ・希望'];
  const TYPES_40S = ['基本情報・自己紹介','学業・研究内容','経験・エピソード','価値観・考え方','将来・キャリアビジョン','時事・一般常識・その他'];

  // 値ゆれ（前後空白・全角空白など）を吸収
  const norm = (v) => String(v ?? '').trim();

  function allowedTypesForLevel(level) {
    const lv = norm(level);
    if (!lv) return null;
    if (LEVEL_GROUP_MAIN.map(norm).includes(lv)) return [TYPE_TWO, TYPE_SINGLE];
    if (lv === norm(LEVEL_10S)) return [TYPE_NONE];
    if (lv === norm(LEVEL_60S)) return [...TYPES_60S];
    if (lv === norm(LEVEL_40S)) return [...TYPES_40S];
    return null; // 不明は制限しない
  }

  function allowedLevelsForType(type, allLevelsInSelect) {
    const tp = norm(type);
    if (!tp) return null;
    const all = Array.isArray(allLevelsInSelect) ? allLevelsInSelect.map(norm) : null;
    const inAll = (x) => !all || all.includes(norm(x));

    if (tp === norm(TYPE_TWO) || tp === norm(TYPE_SINGLE)) return LEVEL_GROUP_MAIN.filter(inAll);
    if (tp === norm(TYPE_NONE)) return [LEVEL_10S].filter(inAll);
    if (TYPES_60S.map(norm).includes(tp)) return [LEVEL_60S].filter(inAll);
    if (TYPES_40S.map(norm).includes(tp)) return [LEVEL_40S].filter(inAll);
    return null; // 不明は制限しない
  }

  function setSelectOptionsDisabled($sel, allowedList) {
    if (!$sel || !allowedList) return;
    const allowed = new Set(allowedList.map(norm));
    Array.from($sel.options).forEach(o => { o.disabled = !allowed.has(norm(o.value)); });
  }

  function firstEnabledValue($sel) {
    if (!$sel) return '';
    const opt = Array.from($sel.options).find(o => !o.disabled);
    return opt ? opt.value : ($sel.options[0]?.value || '');
  }

  // 方針:
  // - レベルは常に変更できる（option を disabled にしない）
  // - レベル変更時: タイプ側のみ「非対応を disabled」＋「不整合なら先頭の有効値へ自動補正」
  // - タイプ変更時: レベルを対応するものへ自動補正（複数ある場合は先頭）

  function syncTypeToLevel() {
    const $level = byId('setting-level');
    const $type  = byId('setting-type');
    if (!$level || !$type) return;

    const allowedTypes = allowedTypesForLevel($level.value);
    if (allowedTypes) {
      setSelectOptionsDisabled($type, allowedTypes);
      const allowedTypeSet = new Set(allowedTypes.map(norm));
      if ($type.options.length && ($type.selectedOptions[0]?.disabled || !allowedTypeSet.has(norm($type.value)))) {
        $type.value = firstEnabledValue($type);
      }
    } else {
      // 不明レベルなら制限しない
      Array.from($type.options).forEach(o => { o.disabled = false; });
    }
  }

  function syncLevelToType() {
    const $level = byId('setting-level');
    const $type  = byId('setting-type');
    if (!$level || !$type) return;

    const allLevels = Array.from($level.options).map(o => o.value);
    const allowedLevels = allowedLevelsForType($type.value, allLevels);
    if (!allowedLevels || !allowedLevels.length) return; // 不明タイプは補正しない

    const allowedSet = new Set(allowedLevels.map(norm));
    if (!allowedSet.has(norm($level.value))) {
      // 先頭の対応レベルへ補正（selectに存在するもののみ）
      const next = allowedLevels.find(lv => allLevels.map(norm).includes(norm(lv)));
      if (next) $level.value = next;
    }
  }

  function enforceLevelTypeInterlock(source = 'init') {
    // 収束のため最大2回（type→level補正後に level→type 制約を再適用）
    for (let i = 0; i < 2; i++) {
      const $level = byId('setting-level');
      const $type  = byId('setting-type');
      if (!$level || !$type) return;
      const beforeLevel = $level.value;
      const beforeType  = $type.value;

      if (source === 'type') {
        syncLevelToType();
        syncTypeToLevel();
      } else {
        // init / level
        syncTypeToLevel();
        // タイプが補正された結果、タイプ→レベルで決まるケース（例: なし）を反映
        syncLevelToType();
      }

      if ($level.value === beforeLevel && $type.value === beforeType) break;
    }

    // ★ レベル・タイプの整合が決まったあとで「10秒レベルは10秒」に最終補正
    applyDurationByLevel();
  }

  function bindLevelTypeInterlockOnce() {
    const $level = byId('setting-level');
    const $type  = byId('setting-type');
    if (!$level || !$type) return;
    if ($level.dataset.boundInterlock === '1') return;

    $level.dataset.boundInterlock = '1';
    $level.addEventListener('change', () => enforceLevelTypeInterlock('level'));
    $type.addEventListener('change',  () => enforceLevelTypeInterlock('type'));
  }

  /* ========= ★ 10秒レベルは自動で設定時間を10秒にする ========= */
  const DURATION_10S = 10;
  function ensureOption($sel, seconds) {
    if (!$sel) return;
    const v = String(seconds);
    const has = Array.from($sel.options).some(o => String(o.value) === v);
    if (!has) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = `${seconds}秒`;
      $sel.appendChild(opt);
    }
  }

  // レベルに応じて max-time を補正する（現要件は 10秒のみ強制）
  function applyDurationByLevel() {
    const $level = byId('setting-level');
    const $time  = byId('setting-max-time');
    if (!$level || !$time) return;

    const lv = norm($level.value);
    if (lv === norm(LEVEL_10S)) {
      // 10秒が候補に無い場合でも追加して必ず選ぶ
      ensureOption($time, DURATION_10S);
      $time.value = String(DURATION_10S);

      // 「10秒チャレンジは常に10秒固定」にしたいなら true
      // 現時点は“自動で10秒にする”が要件なので disable はしない（必要なら有効化）
      // $time.disabled = true;
    } else {
      // 他レベルで固定解除したいなら（現状の仕様では、プラン制限が主）
      // if ($time.disabled) $time.disabled = false;
    }
  }

  function bindLevelAutoDurationOnce() {
    const $level = byId('setting-level');
    if (!$level) return;
    if ($level.dataset.boundAutoDuration === '1') return;
    $level.dataset.boundAutoDuration = '1';

    $level.addEventListener('change', () => {
      applyDurationByLevel();
    });
  }

  /* ========= フォールバックHTML（サーバが落ちていても必ず開ける新式） ========= */
  const FALLBACK_MODAL_HTML = `
<div class="modal-bg" id="modalBg" style="display:none;">
  <div class="modal-content">
    <h2>設定</h2>

    <div class="setting-row">
      <span>レベル</span>
      <select id="setting-level">
        <option value="初級">初級</option>
        <option value="中級">中級</option>
        <option value="上級">上級</option>
        <option value="超級">超級</option>
        <option value="面接対応">面接対応</option>
        <option value="10秒スピーチチャレンジ">10秒スピーチチャレンジ</option>
        <option value="小中学生のための60秒スピーチ">小中学生のための60秒スピーチ</option>
        <option value="大学生のための就活面接40秒スピーチ">大学生のための就活面接40秒スピーチ</option>
      </select>
    </div>
    <div class="setting-row">
      <span>タイプ</span>
      <select id="setting-type">
        <option value="二択">二択</option>
        <option value="単体">単体</option>
        <option value="なし">なし</option>
        <option value="自分のこと">自分のこと</option>
        <option value="学校生活・友だち">学校生活・友だち</option>
        <option value="家族・家のこと">家族・家のこと</option>
        <option value="趣味・好きなもの">趣味・好きなもの</option>
        <option value="社会・世界・地域">社会・世界・地域</option>
        <option value="夢・将来">夢・将来</option>
        <option value="心・考え・生き方">心・考え・生き方</option>
        <option value="チャレンジ・希望">チャレンジ・希望</option>
        <option value="基本情報・自己紹介">基本情報・自己紹介</option>
        <option value="学業・研究内容">学業・研究内容</option>
        <option value="経験・エピソード">経験・エピソード</option>
        <option value="価値観・考え方">価値観・考え方</option>
        <option value="将来・キャリアビジョン">将来・キャリアビジョン</option>
        <option value="時事・一般常識・その他">時事・一般常識・その他</option>
      </select>
    </div>

    <div class="setting-row">
      <span>出題方式</span>
      <select id="setting-mode">
        <option value="random">ランダム</option>
        <option value="sequential">順番通り</option>
      </select>
    </div>

    <div class="setting-row">
      <span>最大時間</span>
      <select id="setting-max-time">
        <option value="10">10秒</option>
        <option value="40">40秒</option>
        <option value="60" selected>60秒</option>
        <option value="90">90秒</option>
        <option value="120">120秒</option>
      </select>
    </div>

    <div class="setting-row">
      <span>時間表示</span>
      <select id="setting-timer">
        <option value="countdown">カウントダウン</option>
        <option value="countup">カウントアップ</option>
      </select>
    </div>

    <div class="setting-row">
      <span>強制終了</span>
      <select id="setting-force">
        <option value="on">あり</option>
        <option value="off">なし</option>
      </select>
    </div>

    <div class="setting-row">
      <span>文字起こし</span>
      <select id="setting-transcript">
        <option value="on">あり</option>
        <option value="off">なし</option>
      </select>
    </div>

    <div class="modal-btns">
      <button id="btnSettingSave" class="apply-btn">保存</button>
      <button id="btnSettingCancel" class="apply-btn cancel">キャンセル</button>
    </div>
  </div>
</div>`;

  /* ========= ユーティリティ ========= */
  const $  = (sel, root=document) => root.querySelector(sel);
  const byId = (id) => document.getElementById(id);

  function parseJwtPayload() {
    const t = localStorage.getItem('authToken'); if (!t) return {};
    try {
      const b = t.split('.')[1] || '';
      const pad = '='.repeat((4 - (b.length % 4)) % 4);
      return JSON.parse(decodeURIComponent(escape(atob((b + pad).replace(/-/g, '+').replace(/_/g, '/')))));
    } catch { return {}; }
  }
async function fetchCourseIdFallback() {
  // 1) localStorage userProfile があるならそれ優先
  try {
    const u = JSON.parse(localStorage.getItem("userProfile") || "null");
    const c = String(u?.course_id || u?.course || "").toLowerCase();
    if (c) return c;
  } catch {}

  // 2) JWT から user id を拾う
  const p = parseJwtPayload();
  const uid = String(p?.uid || p?.userId || p?.id || p?.sub || "");
  if (!uid) return "";

  // 3) API から取る（あなたの環境は /api/users/:id を使ってる）
  try {
    const r = await authFetch(`/api/users/${encodeURIComponent(uid)}`, { cache: "no-store" });
    if (!r.ok) return "";
    const js = await r.json();
    const user = js.user || js.item || js;
    const course = String(user?.course_id || user?.course || "").toLowerCase();
    if (course) {
      // 後続でも使えるように保存（フィルター等と同じ思想）
      localStorage.setItem("userProfile", JSON.stringify(user));
    }
    return course;
  } catch {
    return "";
  }
}

  // 認証付き fetch（相対URLは API_BASE を自動付与）
  function authFetch(url, opts = {}) {
    const token = localStorage.getItem('authToken');
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.method && opts.method.toUpperCase() !== 'GET' && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }
    const finalUrl = url.startsWith('/') ? (API_BASE + url) : url;
    return fetch(finalUrl, { method: opts.method || 'GET', ...opts, headers, mode: 'cors', cache: 'no-store' });
  }

  /* ========= 設定の保存/読込 ========= */
  const SETTING_KEY = 'appSetting';
  const DEFAULT_SETTING = {
    level: '初級',
    mode: 'random',
    maxTime: 60,
    timerType: 'countup',
    forceEnd: 'on',         // 'on' | 'off'
    transcript: 'on'        // 'on' | 'off'
  };

  function getAppSetting() {
    try {
      const raw = localStorage.getItem(SETTING_KEY);
      const val = raw ? JSON.parse(raw) : {};
      return { ...DEFAULT_SETTING, ...val };
    } catch {
      return { ...DEFAULT_SETTING };
    }
  }

  function saveAppSetting(next) {
    const cur = getAppSetting();
    const merged = { ...cur, ...next };
    localStorage.setItem(SETTING_KEY, JSON.stringify(merged));
    document.dispatchEvent(new CustomEvent('app:settingChanged', { detail: merged }));
    return merged;
  }

  function updateSummaryFromStorage(){
    let s = null;
    try { s = JSON.parse(localStorage.getItem('appSetting')) || {}; } catch {}
    if (!s) return;

    const map = {
      'sum-level': s.level || '初級',
      'sum-type' : s.type  || '二択',
      'sum-mode' : (s.mode === 'sequential' ? '順番通り' : 'ランダム'),
      'sum-max'  : (s.maxTime || 60) + '秒',
      'sum-timer': (s.timerType === 'countdown' ? 'カウントダウン' : 'カウントアップ'),
      'sum-force': (s.forceEnd === 'off' ? 'なし' : 'あり'),
      'sum-trans': (s.transcript === 'off' ? '非表示' : '表示')
    };
    Object.entries(map).forEach(([id,val])=>{
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
  }

  function populateFromStorage() {
    const s = getAppSetting();
    const set = (id, v) => { const el = byId(id); if (el && v!=null) el.value = String(v); };
    set('setting-level', s.level);
    set('setting-type', s.type);
    set('setting-mode', s.mode);
    set('setting-max-time', s.maxTime);
    set('setting-timer', s.timerType);
    set('setting-force', s.forceEnd);
    set('setting-transcript', s.transcript);
  }

  function coerceDuration(wanted, options) {
    const list = Array.isArray(options) && options.length ? options.map(Number) : [60];
    const n = Number(wanted) || list[0];
    return list.includes(n) ? n : Math.min(...list);
  }

  /* ========= プラン制限 ========= */
/* ========= プラン制限 ========= */
let PLAN_LIMITS = null;

// ★ server(/api/theme-options) の返却形式を吸収して {levels, types, limits:{...}} に正規化
function normalizeThemeOptions(serverJson) {
  if (!serverJson || typeof serverJson !== 'object') return null;

  const levels = Array.isArray(serverJson.levels) ? serverJson.levels.slice()
              : Array.isArray(serverJson.allowedLevels) ? serverJson.allowedLevels.slice()
              : null;

  const types  = Array.isArray(serverJson.types) ? serverJson.types.slice()
              : Array.isArray(serverJson.allowedTypes) ? serverJson.allowedTypes.slice()
              : null;

  // duration options は直下/別名の可能性があるので吸収
  const dur =
    Array.isArray(serverJson.durationOptions) ? serverJson.durationOptions
    : Array.isArray(serverJson.duration_options) ? serverJson.duration_options
    : Array.isArray(serverJson.maxTimes) ? serverJson.maxTimes
    : Array.isArray(serverJson.max_times) ? serverJson.max_times
    : null;

  const defaultDuration =
    Number(serverJson.defaultDuration ?? serverJson.default_duration ?? serverJson.defaultMaxTime ?? serverJson.default_max_time);

  const forceCutoff =
    (serverJson.forceCutoff != null) ? !!serverJson.forceCutoff
    : (serverJson.force_cutoff != null) ? !!serverJson.force_cutoff
    : null;

  const allowTranscription =
    (serverJson.allowTranscription != null) ? !!serverJson.allowTranscription
    : (serverJson.allow_transcription != null) ? !!serverJson.allow_transcription
    : null;

  const lockForceCutoff =
    (serverJson.lockForceCutoff != null) ? !!serverJson.lockForceCutoff
    : (serverJson.lock_force_cutoff != null) ? !!serverJson.lock_force_cutoff
    : null;

  return {
    ok: serverJson.ok ?? true,
    role: serverJson.role,
    course: serverJson.course ?? serverJson.course_id,
    levels: levels || undefined,
    types:  types  || undefined,
    limits: {
      durationOptions: dur ? dur.map(Number) : undefined,
      defaultDuration: isFinite(defaultDuration) ? defaultDuration : undefined,
      forceCutoff: (forceCutoff === null ? undefined : forceCutoff),
      allowTranscription: (allowTranscription === null ? undefined : allowTranscription),
      lockForceCutoff: (lockForceCutoff === null ? undefined : lockForceCutoff),
    }
  };
}

async function ensurePlanLimits() {
  if (PLAN_LIMITS) return PLAN_LIMITS;

  // 1) サーバから取得（失敗は許容）
  let server = null;
  try {
    const t = localStorage.getItem('authToken') || '';
    const r = await authFetch('/api/theme-options', {
      headers: t ? { Authorization: 'Bearer ' + t } : {},
      mode: 'cors', cache: 'no-store'
    });
    if (r.ok) server = await r.json();
  } catch {}

  // 2) JWT から role/course 推定
  const p = parseJwtPayload();
  const role = String(p.role || 'user').toLowerCase();
  const isAdminLike = (role === 'admin' || role === 'owner');

  // 3) 定義（PRO/FREE の既定）
  const PRO = {
    ok: true,
    role,
    course: 'pro',
    levels: ['初級','中級','上級','超級','面接対応','10秒スピーチチャレンジ','小中学生のための60秒スピーチ','大学生のための就活面接40秒スピーチ'],
    types:  ['二択','単体','なし','自分のこと','学校生活・友だち','家族・家のこと','趣味・好きなもの','社会・世界・地域','夢・将来','心・考え・生き方','チャレンジ・希望','基本情報・自己紹介','学業・研究内容','経験・エピソード','価値観・考え方','将来・キャリアビジョン','時事・一般常識・その他'],
    limits: {
      durationOptions: [10,40,60,90,120],
      defaultDuration: 60,
      forceCutoff: false,
      allowTranscription: true,
      lockForceCutoff: false
    }
  };
  const FREE = {
    ok: true,
    role,
    course: 'free',
    levels: ['初級','中級','上級','超級'],
    types:  ['二択'],
    limits: {
      durationOptions: [60],
      defaultDuration: 60,
      forceCutoff: true,
      allowTranscription: true,
      lockForceCutoff: false
    }
  };

  // 4) server を正規化（limits を必ず持つ形にする）
  const normalizedServer = normalizeThemeOptions(server);

  // 5) course 決定（JWT → server → free）
  let course =
    String(p.course_id || p.courseId || '').toLowerCase() ||
    String(normalizedServer?.course || '').toLowerCase() ||
    'free';

  if (isAdminLike) course = 'pro';

  // 6) effective 決定：serverがあるならベースにするが、欠けてる項目はPRO/FREEで補完
  const base = (course === 'free') ? FREE : PRO;

  let effective = normalizedServer ? {
    ...base,
    ...normalizedServer,
    // levels/types は server 優先。ただし無いなら base
    levels: Array.isArray(normalizedServer.levels) && normalizedServer.levels.length ? normalizedServer.levels : base.levels,
    types : Array.isArray(normalizedServer.types)  && normalizedServer.types.length  ? normalizedServer.types  : base.types,
    limits: {
      ...base.limits,
      ...(normalizedServer.limits || {})
    },
    role,
    course
  } : { ...base, role, course };

  // ★ 最重要：pro なのに durationOptions が欠けてる/空 の場合は PRO を強制
  if (course !== 'free') {
    const opts = effective?.limits?.durationOptions;
    if (!Array.isArray(opts) || opts.length === 0) {
      effective = { ...effective, limits: { ...effective.limits, durationOptions: PRO.limits.durationOptions.slice(), defaultDuration: PRO.limits.defaultDuration } };
    }
  } else {
    // free の durationOptions 未設定対策
    const opts = effective?.limits?.durationOptions;
    if (!Array.isArray(opts) || opts.length === 0) {
      effective = { ...effective, limits: { ...effective.limits, durationOptions: FREE.limits.durationOptions.slice(), defaultDuration: FREE.limits.defaultDuration } };
    }
  }

  PLAN_LIMITS = effective;
  return PLAN_LIMITS;
}


  async function applyPlanLimitsToModal() {
    const lims = await ensurePlanLimits();

    // レベル
    const $level = byId('setting-level');
    if ($level && Array.isArray(lims.levels) && lims.levels.length) {
      Array.from($level.options).forEach(o => { if (!lims.levels.includes(o.value)) o.remove(); });
      if (![...$level.options].some(o => o.value === $level.value)) {
        $level.value = $level.options[0]?.value || '';
      }
    }

    // タイプ
    const $type = byId('setting-type');
    if ($type && Array.isArray(lims.types) && lims.types.length) {
      // サーバ（DB）側の types を優先して絞り込み
      Array.from($type.options).forEach(o => { if (!lims.types.includes(o.value)) o.remove(); });
      if (![...$type.options].some(o => o.value === $type.value)) {
        $type.value = $type.options[0]?.value || '';
      }
    }

    // レベル×タイプの相互制約（対応していない項目は選択不可）
    bindLevelTypeInterlockOnce();
    enforceLevelTypeInterlock('limits');

    // 設定時間
    const $time = byId('setting-max-time');
    if ($time) {
      const opts = (lims.limits?.durationOptions || []).map(Number);
      if (opts.length) {
        $time.innerHTML = opts.map(v => `<option value="${v}">${v}秒</option>`).join('');
        $time.disabled = (opts.length === 1);
        const saved = (getAppSetting().maxTime ?? lims.limits?.defaultDuration);
        const pick  = opts.includes(Number(saved))
          ? Number(saved)
          : (lims.limits?.defaultDuration && opts.includes(lims.limits.defaultDuration)
              ? lims.limits.defaultDuration
              : opts[0]);
        $time.value = String(pick);
      }
    }

    // ★ プラン制限適用のあとで「10秒レベルは10秒」に最終補正
    bindLevelAutoDurationOnce();
    applyDurationByLevel();

    // 強制終了（FREEでも選べる：lockForceCutoff が真のときのみ disable）
    const $force = byId('setting-force');
    if ($force) {
      const on = !!lims.limits?.forceCutoff;
      $force.value = on ? 'on' : 'off';
      $force.disabled = (lims.limits?.lockForceCutoff === true);
    }

    // 文字起こし（allowTranscription=false のときだけ disable。FREEでは基本可）
    const $tr = byId('setting-transcript');
    if ($tr) {
      const allow = (lims.limits?.allowTranscription !== false);
      if (allow) {
        $tr.disabled = false;
      } else {
        // 選択不可でも「表示」に固定（要望どおり）
        $tr.value = 'on';
        $tr.disabled = true;
      }
    }
  }

  /* ========= モーダル注入（フルHTMLから .modal-bg or #settingModal を抽出） ========= */
  let injecting = null;
  async function injectSettingModalOnce() {
    // 空の #settingModal（中身なし）を許さない
    const existingModern = byId('settingModal');
    if (existingModern && existingModern.querySelector('.setting-body')) return;
    const existingLegacy = byId('modalBg') || $('.modal-bg');
    if (existingLegacy) return;
    if (injecting) return injecting;

    injecting = (async () => {
      const host = byId('setting-modal-host') || (() => {
        const d = document.createElement('div');
        d.id = 'setting-modal-host';
        document.body.appendChild(d);
        return d;
      })();

      // 取得トライ
      let htmlText = '';
      for (const base of MODAL_CANDIDATES) {
        try {
          const url = base + (base.includes('?') ? '&' : '?') + 'v=' + Date.now();
          const res = await fetch(url, { cache: 'no-store' });
          if (res.ok) { htmlText = await res.text(); break; }
        } catch {}
      }

      if (!htmlText) {
        host.innerHTML = FALLBACK_MODAL_HTML;
        bindCloseButtons();
        bindLevelTypeInterlockOnce();
        bindLevelAutoDurationOnce();
        enforceLevelTypeInterlock('inject');
        applyDurationByLevel();
        return;
      }

      // フルHTMLから対象ノードを抽出
      const doc = new DOMParser().parseFromString(htmlText, 'text/html');
      const legacy = doc.querySelector('.modal-bg');
      const modern = doc.getElementById('settingModal');
      const node = legacy || modern;

      if (!node) {
        host.innerHTML = FALLBACK_MODAL_HTML;
        bindCloseButtons();
        bindLevelTypeInterlockOnce();
        bindLevelAutoDurationOnce();
        enforceLevelTypeInterlock('inject');
        applyDurationByLevel();
        return;
      }

      host.replaceChildren(document.importNode(node, true));
      bindCloseButtons();
      bindLevelTypeInterlockOnce();
      bindLevelAutoDurationOnce();
      enforceLevelTypeInterlock('inject');
      applyDurationByLevel();
    })();

    try { await injecting; } finally { injecting = null; }
  }

  function bindCloseButtons() {
    const bg = byId('modalBg') || $('.modal-bg');
    const modernRoot = byId('settingModal');

    const onClose = (e) => { e?.preventDefault?.(); closeModalCompat(); };
    $('#btnModalClose')    ?.addEventListener('click', onClose);
    $('#btnSettingCancel')?.addEventListener('click', onClose);
    $('.setting-close')    ?.addEventListener('click', onClose);

    bg?.addEventListener('click', (e) => { if (e.target === bg) closeModalCompat(); });
    modernRoot?.addEventListener('click', (e) => {
      const t = e.target;
      if (t && (t.dataset?.close === '1' || t.classList?.contains('setting-backdrop'))) closeModalCompat();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModalCompat(); }, { passive: true });
  }

  /* ========= 開閉 ========= */
  function showModern(m) {
    m.removeAttribute('hidden');
    m.style.display = 'block';
    m.setAttribute('aria-hidden','false');
    m.classList.add('is-open');
    document.body.classList.add('no-scroll');
    (byId('setting-level') || byId('setting-max-time') || m).focus?.();
  }
  function hideModern(m) {
    m.classList.remove('is-open');
    m.setAttribute('hidden','');
    m.style.display = 'none';
    m.setAttribute('aria-hidden','true');
    document.body.classList.remove('no-scroll');
  }
  function showLegacy(bg) {
    bg.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    (byId('setting-level') || byId('setting-max-time') || bg).focus?.();
  }
  function hideLegacy(bg) {
    bg.style.display = 'none';
    document.body.style.overflow = '';
  }

  function closeModalCompat() {
    const legacy = byId('modalBg') || $('.modal-bg');
    const modern = byId('settingModal');
    if (modern && getComputedStyle(modern).display !== 'none') hideModern(modern);
    if (legacy && getComputedStyle(legacy).display !== 'none') hideLegacy(legacy);
  }

  async function openSettingModal() {
    await injectSettingModalOnce();

    const legacy = byId('modalBg') || $('.modal-bg');
    const modern = byId('settingModal');

    // ★ 保存値 → 先に反映（ユーザーの選択を尊重）
    populateFromStorage();

    // ★ その後に“許可範囲”で矯正（無効な選択だけ直す）
    try { await applyPlanLimitsToModal(); } catch {}

    // レベル×タイプ制約を最終適用
    bindLevelTypeInterlockOnce();
    bindLevelAutoDurationOnce();
    enforceLevelTypeInterlock('open');
    applyDurationByLevel();

    // 表示
    if (modern) { showModern(modern); return; }
    if (legacy) { showLegacy(legacy); return; }

    // どちらも無ければフォールバックで新式を直挿し
    const host = document.createElement('div');
    host.innerHTML = FALLBACK_MODAL_HTML;
    document.body.appendChild(host.firstElementChild);
    bindCloseButtons();
    populateFromStorage();
    try { await applyPlanLimitsToModal(); } catch {}
    bindLevelTypeInterlockOnce();
    bindLevelAutoDurationOnce();
    enforceLevelTypeInterlock('open-fallback');
    applyDurationByLevel();
    showLegacy(byId('modalBg'));   // ★ フォールバックは legacy 表示
  }

  /* ========= 保存 ========= */
  async function saveSettingFromModal() {
    // 相互制約を先に適用（不整合保存を防ぐ）
    enforceLevelTypeInterlock('save');
    applyDurationByLevel(); // ★ 保存直前にも最終補正

    const $level = byId('setting-level');
    const $type  = byId('setting-type');
    const $mode  = byId('setting-mode');
    const $time  = byId('setting-max-time');
    const $timer = byId('setting-timer');
    const $force = byId('setting-force');
    const $tr    = byId('setting-transcript');

    const lims = (await ensurePlanLimits()) || {};
    const lim  = lims.limits || {};

    const wantedSec = Number($time?.value || lim.defaultDuration || 60);

    // 10秒レベルの場合、UIは必ず10にしているが、念のためここでも担保
    const levelNow = norm($level?.value);
    const maxTimeRaw = (levelNow === norm(LEVEL_10S)) ? DURATION_10S : wantedSec;

    const maxTime = coerceDuration(maxTimeRaw, lim.durationOptions);

    const next = {
      level: $level?.value || DEFAULT_SETTING.level,
      type:  $type?.value  || DEFAULT_SETTING.type,
      mode:  $mode?.value  || DEFAULT_SETTING.mode,
      maxTime,
      timerType: $timer?.value || DEFAULT_SETTING.timerType,
      // disable のときはプラン既定値を使うが、FREE では基本 disable=false のはず
      forceEnd: ($force?.disabled ? (lim.forceCutoff ? 'on' : 'off') : ($force?.value || 'on')),
      transcript: ($tr?.disabled ? (lim.allowTranscription === false ? 'off' : 'on') : ($tr?.value || 'on'))
    };

    saveAppSetting(next);
    updateSummaryFromStorage();   // サマリー反映
  }

  /* ========= 実効設定を公開（開始ロジック用） ========= */
  async function getEffectiveSetting(){
    const s = getAppSetting();
    const lims = (await ensurePlanLimits())?.limits || {};
    const max = coerceDuration(s.maxTime, lims.durationOptions);
    // サーバが禁止でも、実行時は“表示”に倒す（要望どおり）
    const transcript = (lims.allowTranscription === false) ? 'on' : (s.transcript || 'on');
    return { ...s, maxTime: max, transcript };
  }

  /* ========= イベント委譲（開く/閉じる/保存） ========= */
  function bindGlobalTriggers() {
    // 開く
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest?.('.btn-setting,[data-action="open-setting"],#openSettingModal');
      if (!t) return;
      e.preventDefault();
      openSettingModal();
    }, { passive: false });

    // 保存（新: #settingSave / 旧: #btnSettingSave）
    document.addEventListener('click', async (e) => {
      const el = e.target;
      if (!el) return;
      if (el.id === 'settingSave' || el.id === 'btnSettingSave') {
        e.preventDefault();
        await saveSettingFromModal();
        closeModalCompat();
        alert('設定を保存しました');
      }
    }, { passive: false });

  }

  /* ========= 起動 ========= */
  function boot() {
    bindGlobalTriggers();
    // 可能なら早期に注入・制限取得（失敗しても問題なし）
    injectSettingModalOnce().catch(()=>{});
    ensurePlanLimits().catch(()=>{});
    updateSummaryFromStorage(); // indexの初期表示を反映
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ========= 外部公開 ========= */
  window.injectSettingModalOnce = injectSettingModalOnce;
  window.applyPlanLimitsToModal = applyPlanLimitsToModal;
  window.openSettingModal = openSettingModal;
  window.saveSettingFromModal = saveSettingFromModal;
  window.getEffectiveSetting = getEffectiveSetting;
  window.ensurePlanLimits = ensurePlanLimits;   // ★ 追加
  window.__dbgCloseModal = closeModalCompat;

  // ★ テーマ一覧など外部から「レベルを変えたら時間も追従」させたい場合に使える公開関数
  //    例: levelSelect.value = "10秒スピーチチャレンジ"; window.__applyDurationByLevel();
  window.__applyDurationByLevel = applyDurationByLevel;
})();
