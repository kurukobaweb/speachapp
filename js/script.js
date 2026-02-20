// 先頭の getElementById 群は残してOK（undefinedでも可）
// ただし“使う前”に必ず再取得する
let screen1, screen2, promptEl, transcriptContainer, transcriptEl, resultPrompt;
let btnStart, btnStop, btnJudge, btnNext, btnRetry, countdownEl, timerEl, barInner;
let resTime, resChars, resScore, barInner2;
let uiState = 'idle'; // 'idle' | 'recording' | 'stopped' | 'result'

function bindEls(){
  screen1             = document.getElementById('screen1');
  screen2             = document.getElementById('screen2');
  promptEl            = document.getElementById('prompt');
  transcriptContainer = document.getElementById('transcriptContainer');
  transcriptEl        = document.getElementById('transcript');
  resultPrompt        = document.getElementById('resultPrompt');
  btnStart            = document.getElementById('btnStart');
  btnStop             = document.getElementById('btnStop');
  btnJudge            = document.getElementById('btnJudge');
  btnNext             = document.getElementById('btnNext');
  btnRetry            = document.getElementById('btnRetry');
  countdownEl         = document.getElementById('countdown');
  timerEl             = document.getElementById('timer');
  barInner            = document.getElementById('barInner');
  resTime             = document.getElementById('resTime');
  resChars            = document.getElementById('resChars');
  resScore            = document.getElementById('resScore');
  barInner2           = document.getElementById('barInner2');
}

function setDisplayAll(selector, display) {
  document.querySelectorAll(selector).forEach(el => {
    el.style.display = display;
  });
}

// Retry/Next は結果画面だけで出したい想定
function setResultButtonsVisible(visible) {
  setDisplayAll('#btnRetry', visible ? '' : 'none');
  setDisplayAll('#btnNext',  visible ? '' : 'none');
}

// Start/Stop/Judge は練習画面側（録音カード）想定
function setPracticeButtonsVisible() {
  // Start/Stop/Judge は「常に表示」で良いなら display は触らず disabled だけでもOK
  // ただ、見た目の混在を確実に止めるなら display も揃える
  setDisplayAll('#btnStart', '');
  setDisplayAll('#btnStop',  '');
  setDisplayAll('#btnJudge', '');
}


const API_BASE =
  (window.ENV && window.ENV.API_BASE) ||
  localStorage.getItem("API_BASE") ||
  (location.hostname === "localhost"
    ? "http://localhost:8200"
    : "https://my-api-436216861937.asia-northeast1.run.app");



function assertEls(){
  if (!screen1 || !screen2) {
    console.warn('[script] screen1 / screen2 が見つかりません', {screen1, screen2});
  }
}

// ====== 認証チェック ======
(() => {
  const token = localStorage.getItem('authToken');
  if (!token) {
    location.href = '../../login.html';
  }
})();

// ====== katakana → hiragana 変換関数 ======
function toHiragana(katakana) {
  return katakana.replace(/[\u30A1-\u30F6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

// ====== kuromoji.js初期化 ======
let tokenizer = null;
kuromoji.builder({
dicPath: (window.ENV && window.ENV.KUROMOJI_DIC) || "./dict/"
}).build((err, builtTokenizer) => {
  if (err) {
    console.error("kuromoji load error:", err);
    return;
  }
  tokenizer = builtTokenizer;
  console.log("kuromoji ready");
});

// ====== localStorageの設定値を取得（menu.htmlで保存したもの） ======
const appSetting = (() => {
  try {
    return JSON.parse(localStorage.getItem('appSetting')) || {
      level: "",
      mode: "random",
      maxTime: 60,
      timerType: "countup",
      forceEnd: "off",
      transcript: "on"
    };
  } catch {
    return {
      level: "",
      mode: "random",
      maxTime: 60,
      timerType: "countup",
      forceEnd: "off",
      transcript: "on"
    };
  }
})();

// ====== 状態変数 ======
let recognition = null;
let recorder = null;
let mediaStream = null;
let finalText = "";
let lastTranscriptRaw = "";   // そのままの文字起こし（音声APIの生テキスト結合）
let lastTranscriptHira = "";  // ひらがな化したテキスト（画面表示と同じ）
let seconds = 0;
let timerInterval = null;
let shouldKeepRunning = false;
let speechInput = null;
let timerLimit = Number(appSetting.maxTime) || 60;  // 最大時間（秒）
let timerType = appSetting.timerType || "countup";  // countup or countdown
let forceEnd = appSetting.forceEnd === "on";        // 強制終了するか
let showTranscript = appSetting.transcript !== "off"; // 結果画面で表示
let currentPrompt = null;  // ← 今表示中のお題（{id, level, sub, ...}想定）


// === plan limits ===
let PLAN_LIMITS = null;

async function fetchThemeOptions(){
  try {
    const r = await authFetch('/api/theme-options');
    if (r.ok) PLAN_LIMITS = await r.json();
  } catch (e) {
    console.warn('theme-options 取得失敗', e);
  } finally {
    // フォールバック（free 相当）
    if (!PLAN_LIMITS) PLAN_LIMITS = {
      durationOptions: [60],
      forceCutoff: true,
      allowTranscription: true   // 表示は後で抑止
    };
  }
}

function coerceDuration(wanted, options){
  const list = Array.isArray(options) && options.length ? options : [60];
  return list.includes(wanted) ? wanted : Math.min(...list);
}


// ====== APIリクエスト用fetch（認証付き） ======
function authFetch(url, opts = {}) {
  const token = localStorage.getItem('authToken');

  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  if (opts.method && opts.method.toUpperCase() !== 'GET' && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const finalUrl = url.startsWith('/') ? API_BASE + url : url;
return fetch(finalUrl, { method: opts.method || 'GET', ...opts, headers });
}

function applyThemeTokens(tokens) {
  if (!tokens || typeof tokens !== "object") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) {
    if (typeof k === "string" && typeof v === "string") {
      root.style.setProperty(k, v);
    }
  }
}



// ====== JWT utils (base64url対応・UTF8安全) ======
function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length < 2) return null;

  // base64url -> base64
  let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));

  try {
    // UTF-8安全にJSONへ
    const bin = atob(b64);
    const json = decodeURIComponent(
      Array.prototype.map.call(bin, c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    const p = JSON.parse(json);
    return (p && typeof p === 'object') ? p : null;
  } catch (e) {
    try {
      // fallback（ASCII想定）
      return JSON.parse(atob(b64));
    } catch {
      return null;
    }
  }
}

function getUidFromToken() {
  const token = localStorage.getItem('authToken');
  const p = decodeJwtPayload(token);

  // 取り得るキーを全部拾う（環境差を吸収）
  const uid =
    p?.uid ??
    p?.user_id ??
    p?.userId ??
    p?.id ??
    p?.sub;          // ← これが無いと今回みたいに落ちる

  return uid ? String(uid) : null;
}

function isTokenExpired() {
  const token = localStorage.getItem('authToken');
  const p = decodeJwtPayload(token);
  if (!p?.exp) return false;
  return Math.floor(Date.now()/1000) >= p.exp;
}


// ★ ここから：表示切替は style のみで統一
function showResultView() {
  if (!screen1 || !screen2) return;
  screen1.style.display = 'none';
  screen2.style.display = '';

  // ★結果画面では Retry/Next を出す
  setResultButtonsVisible(true);
}

function showPracticeView() {
  if (!screen1 || !screen2) return;
  screen2.style.display = 'none';
  screen1.style.display = '';

  // ★練習画面では Retry/Next を消す（これが最重要）
  setResultButtonsVisible(false);

  // Start/Stop/Judge の見た目も必要ならここで統一
  setPracticeButtonsVisible();
}


function resetPracticeUI() {
  uiState = 'idle';
  shouldKeepRunning = false;
  clearInterval(timerInterval);

  // 進行中なら止める（遅延 onend が飛んでも uiState=idle なのでRESULTは有効化されない）
  try { recognition && recognition.stop(); } catch {}
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch {}
  try {
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  } catch {}

  showPracticeView();

  transcriptEl && (transcriptEl.textContent = '');
  resultPrompt && (resultPrompt.textContent = '');

  seconds = 0;
  updateTimerUI && updateTimerUI();
  barInner && (barInner.style.width = '0%');

  btnStart && (btnStart.disabled = false);
  btnStop  && (btnStop.disabled  = true);
  btnJudge && (btnJudge.disabled = true);

  if (btnRetry) btnRetry.style.display = 'none';
  if (btnNext)  btnNext.style.display  = 'none';
}





function ensureSpeechInput() {
  if (!speechInput) {
    speechInput = document.createElement('textarea');
    speechInput.id = 'speechInput';
    speechInput.style.width  = '100%';
    speechInput.style.height = '4em';
    (screen1 || document.body).appendChild(speechInput);
  }
  return speechInput;
}


// ====== スコア計算関数 ======
/**
 * 秒数と文字数からスコア計算（すべてmaxTime基準）
 * @param {number} seconds
 * @param {number} charCount
 * @param {number} maxTime 10, 40, 60, 90, 120
 * @returns {string}
 */
function calculateScore(seconds, charCount, maxTime = 60) {
  let timeBases, charBases, baseScores, minChar, maxSeconds, minSeconds;

  if (maxTime === 10) {
    timeBases  = [8, 9, 10, 11];
    charBases  = [30, 40, 50, 40];
    baseScores = {8: 70, 9: 80, 10: 100, 11: 80};
    minChar    = 30;
    minSeconds = 8;
    maxSeconds = 12;
    if (seconds < minSeconds || seconds > maxSeconds || charCount < minChar) return '不合格';
  } else if (maxTime === 40) {
    timeBases  = [20, 30, 40, 50, 60];
    charBases  = [150, 175, 200, 225, 250];
    baseScores = {20: 70, 30: 80, 40: 100, 50: 80, 60: 70};
    minChar    = 200;
    minSeconds = 70;
    maxSeconds = 61;
    if (seconds < minSeconds || seconds >= maxSeconds || charCount < minChar) return '不合格';
  } else if (maxTime === 90) {
    timeBases  = [50, 60, 70, 80, 90];
    charBases  = [200, 240, 280, 400, 360];
    baseScores = {50: 60, 60: 70, 70: 80, 80: 100, 90: 80};
    minChar    = 200;
    minSeconds = 50;
    maxSeconds = 91;
    if (seconds < minSeconds || seconds >= maxSeconds || charCount < minChar) return '不合格';
  } else if (maxTime === 120) {
    timeBases  = [80, 90, 100, 110, 120];
    charBases  = [320, 360, 400, 550, 480];
    baseScores = {80: 60, 90: 70, 100: 80, 110: 100, 120: 80};
    minChar    = 320;
    minSeconds = 80;
    maxSeconds = 121;
    if (seconds < minSeconds || seconds >= maxSeconds || charCount < minChar) return '不合格';
  } else {
    timeBases  = [20, 30, 40, 50, 60];
    charBases  = [100, 150, 200, 250, 300];
    baseScores = {20: 60, 30: 70, 40: 80, 50: 100, 60: 80};
    minChar    = 100;
    minSeconds = 20;
    maxSeconds = 62;
    if (seconds < minSeconds || seconds >= maxSeconds || charCount < minChar) return '不合格';
  }

  const nearest = (v, arr) => arr.reduce((p, c) => Math.abs(c - v) < Math.abs(p - v) ? c : p);
  const tb = nearest(seconds, timeBases);
  const cb = nearest(charCount, charBases);

  let score = baseScores[tb] || 0;
  const diff = timeBases.indexOf(tb) - charBases.indexOf(cb);
  if (diff > 0) score -= diff * 10;

  return score > 0 ? `${score}点` : '不合格';
}


// ====== Android判定 ======
function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

// ====== 音声認識初期化 ======
function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    const combined = finalText + interim;     // ← 生テキスト（漢字かな混在）
    lastTranscriptRaw = combined;             // 保存用：生

    // ひらがな化（kuromojiで読み→ひらがな。無ければそのまま）
    let hira = combined;
    if (tokenizer) {
      const tokens = tokenizer.tokenize(combined);
      hira = tokens.map(token =>
       token.reading ? toHiragana(token.reading) : token.surface_form
      ).join('');
    }
    lastTranscriptHira = hira;                // 保存用：ひらがな
    transcriptEl.textContent = hira;          // 画面表示は従来通りひらがな
  };

recognition.onerror = e => {
  if (shouldKeepRunning) {
    setTimeout(() => {
      try { recognition.start(); } catch (err) {}
    }, 50); // 100msぐらい遅らせると安定
  }
};

recognition.onend = () => {
  if (shouldKeepRunning) {
    setTimeout(() => {
      try { recognition.start(); } catch {}
    }, 50);
    return;
  }

  // ★「停止ボタンを押して録音が止まった」時だけ RESULT を有効化
  btnStop && (btnStop.disabled = true);
  if (uiState === 'stopped') {
    btnJudge && (btnJudge.disabled = false);
  } else {
    // Next/Retryなどで idle に戻った後に onend が遅延発火しても有効化しない
    btnJudge && (btnJudge.disabled = true);
  }
};


}

// === 実行順の永続化（再読み込みしても続きやすい）===
function loadRunState(){
  try { return JSON.parse(localStorage.getItem('runState')) || {}; } catch { return {}; }
}
function saveRunState(st){
  try { localStorage.setItem('runState', JSON.stringify(st)); } catch {}
}

// === Fisher–Yates シャッフル ===
function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// === 同一レベル内の順序を作る（mode: 'sequential' | 'random'）===
function buildOrderSameLevel(questions, level, mode){
  const list = questions
    .map((q, idx) => ({ ...q, __idx: idx }))        // 元のインデックス保持
    .filter(q => q.level === level);

  if (list.length === 0) return [];

  // sub があれば sub で昇順、なければ元配列順
  list.sort((a,b) => {
    const sa = (a.sub ?? a.__idx);
    const sb = (b.sub ?? b.__idx);
    return sa - sb;
  });

  let order = list.map(q => q.__idx); // QUESTIONS のインデックス配列
  if (mode === 'random') order = shuffle(order);
  return order; // [インデックス, インデックス, ...]
}



// ====== お題取得（レベル・方式対応/選択お題優先） ======


function applyPromptToUI(prompt){
  currentPrompt = prompt || null;
  const root = document.getElementById('prompt');
  if (root) {
    root.dataset.themeKey = prompt?.theme_key ?? ''; // 残してOK
    root.dataset.themeId  = prompt?.id ? String(prompt.id) : ''; // ★ これをセット
  }
  if (promptEl && prompt) {
    promptEl.innerHTML = `
      <div class="level">${prompt.level ?? ''}</div>
      <div class="sub">${prompt.display_id ?? prompt.id ?? prompt.sub ?? ''}</div>
      <div class="type">${prompt.type ?? ''}</div>
    `;
  }
  const q = document.querySelector('.question');
  if (q && prompt) q.innerHTML = prompt.question || '';
  if (transcriptEl) transcriptEl.textContent = '';
  if (barInner) barInner.style.width = '0%';
  if (btnStart) btnStart.disabled = false;
  if (btnStop)  btnStop.disabled  = true;
  if (btnJudge) btnJudge.disabled = true;
}

// ===== TIP 文言定義（後から追加しやすい） ===========================
const TIP_BY_TYPE_FOR_BASE_LEVELS = {
  "二択":  "「どちらかに賛成」「理由」「エピソード」の３つを入れてスピーチを行なってください。",
  "単体":  "「理由」「エピソード」の2つを入れてスピーチを行なってください。"
};

const TIP_BY_LEVEL_FOR_SPECIAL = {
  "10秒スピーチチャレンジ": "結論を一文で。10秒で言い切る練習を行いましょう。",
  "小中学生のための60秒スピーチ": "「なに」「どうして」「たとえば」を入れて話してみよう。",
  "大学生のための就活面接40秒スピーチ": "結論→根拠→具体例（数字）で40秒にまとめましょう。"
};

// 初級/中級/上級/超級/面接対応 は「タイプ」で切り替える
const BASE_LEVELS = new Set(["初級", "中級", "上級", "超級", "面接対応"]);

// ===== 現在のレベル/タイプを安全に取得 ===============================
function getCurrentPromptContext() {
  // 優先順位：selectedPrompt（テーマ選択）→ appSetting（設定）→ 空
  let level = "";
  let type  = "";

  try {
    const sp = JSON.parse(localStorage.getItem("selectedPrompt") || "null");
    if (sp) {
      level = String(sp.level || "").trim();
      type  = String(sp.type  || "").trim();
    }
  } catch {}

  try {
    const s = JSON.parse(localStorage.getItem("appSetting") || "null");
    if (s) {
      // selectedPrompt が空なら setting を採用
      if (!level) level = String(s.level || "").trim();
      if (!type)  type  = String(s.type  || "").trim();
    }
  } catch {}

  return { level, type };
}

// ===== TIP 文字列を決定（仕様通り） =================================
function getTipTextByContext(level, type) {
  const lv = String(level || "").trim();
  const tp = String(type  || "").trim();

  // ① 特別レベル：レベルで固定文言
  if (TIP_BY_LEVEL_FOR_SPECIAL[lv]) {
    return TIP_BY_LEVEL_FOR_SPECIAL[lv];
  }

  // ② 基本レベル：タイプで切り替え
  if (BASE_LEVELS.has(lv)) {
    // 二択/単体以外は出さない（必要ならここでデフォルトを決めてもOK）
    return TIP_BY_TYPE_FOR_BASE_LEVELS[tp] || "";
  }

  // ③ その他（未定義）：空（表示を消す）
  return "";
}

// ===== DOM に反映 ===================================================
function applyPcTip() {
  const el = document.querySelector(".pc-tip");
  if (!el) return;

  const ctx = getCurrentPromptContext();
  const tip = getTipTextByContext(ctx.level, ctx.type);

  if (tip) {
    el.textContent = tip;
    el.style.display = "";      // 表示
  } else {
    // 未定義/不要なら非表示（文言を出したいならここを変更）
    el.textContent = "";
    el.style.display = "none";
  }
}

// ===== 呼び出しタイミング（重要） ===================================
// 1) ページ表示直後（selectedPrompt/appSetting が既に入っている前提）
document.addEventListener("DOMContentLoaded", () => {
  applyPcTip();
});

// 2) 設定変更イベントがある場合（あなたの構成では既に使っているはず）
document.addEventListener("app:settingChanged", () => {
  applyPcTip();
});




async function loadNextPrompt(){
  // まず練習画面に戻して（Retryを確実に消す）
  showPracticeView();

  const next = takeNextPrompt();
  applyPromptToUI(next);

  if (isAndroid() && speechInput){
    speechInput.value = '';
    speechInput.style.display = 'none';
  }
}




function getAuthPayload(){
  const token = localStorage.getItem('authToken');
  try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
}

function getThemeIdForSave() {
  // 1) currentPrompt.id を最優先
  if (currentPrompt?.id) return String(currentPrompt.id);

  // 2) DOM の data-theme-id
  const dId = document.querySelector('#prompt')?.dataset?.themeId;
  if (dId) return dId;

  // 3) 旧ロジックの theme_key
  if (currentPrompt?.theme_key) return String(currentPrompt.theme_key);
  const dk = document.querySelector('#prompt')?.dataset?.themeKey;
  if (dk) return dk;

  // 4) フォールバック
  const last = localStorage.getItem('lastThemeKey');
  if (last) return last;

  return '';
}



/** ユーザー×テーマで上書き保存（サーバー側で upsert） */
async function saveScoreToServer({ uid, themeId, score, isPass, durationSec, charCount, transcriptRaw, transcriptHira }) {
  const body = {
    user_id: String(uid),
    theme_id: String(themeId),

      // ★追加：冗長に持たせる（表示が落ちない）
  level: currentPrompt?.level ?? "",
  type:  currentPrompt?.type  ?? "",
  sub:   currentPrompt?.sub   ?? "",        // no相当で使うなら
  display_id: currentPrompt?.display_id ?? "",
  
    score: typeof score === 'number' ? score : Number(String(score).replace(/[^\d]/g,'')) || 0,
    is_pass: isPass ? 1 : 0,
    duration_s: Number(durationSec) || 0,
    char_count: Number(charCount) || 0,
    // 追加で保存する2フィールド
    transcript_raw:  String(transcriptRaw ?? '').slice(0, 4000),
    transcript_hira: String(transcriptHira ?? '').slice(0, 4000),
   // ← ここを必ず付ける（NULL回避 & 解析用）
   raw: {
     appSetting: (()=>{
       try { return JSON.parse(localStorage.getItem('appSetting')||'{}'); } catch { return {}; }
     })(),
    planLimits: (window.PLAN_LIMITS ?? null),
     theme: {
       id: String(themeId||''),
       level: currentPrompt?.level ?? '',
       type:  currentPrompt?.type  ?? '',
       sub:   currentPrompt?.sub   ?? ''
     },
     metrics: {
       seconds: Number(durationSec)||0,
       charCount: Number(charCount)||0,
       timerLimit: Number(timerLimit)||0,
       timerType: timerType||'countup',
       forceEnd: !!forceEnd
     },
     transcript: {
       raw:  String(transcriptRaw ?? '').slice(0, 1000),
       hira: String(transcriptHira ?? '').slice(0, 1000)
     },
     userAgent: navigator.userAgent
   }
 };  
 // ★DEBUG（必要なら残す / 不要なら消してOK）
console.group('[DEBUG] saveScore payload');
console.log('theme_id   =', body.theme_id);
console.log('score      =', body.score);
console.log('duration_s =', body.duration_s);
console.log('char_count =', body.char_count);
console.log('level/type =', body.level, body.type, body.sub);
console.log('body FULL  =', body);
console.groupEnd();

 const res = await authFetch('/api/scores', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`saveScore failed: ${res.status} ${t}`);
  }
  return res.json().catch(()=> ({}));
}

// ====== 初期化 ======
document.addEventListener('DOMContentLoaded', async () => {
  bindEls();
  assertEls(); // 任意。見つからなければコンソールに出す

  // selectedPrompt を最優先で適用
  const selectedRaw = localStorage.getItem('selectedPrompt');
  if (selectedRaw) {
    try {
      const selected = JSON.parse(selectedRaw);
      localStorage.removeItem('selectedPrompt');
      applyPromptToUI(selected);
    } catch(e){ console.warn('selectedPrompt の解析に失敗:', e); }
  }

  // まだ未設定なら通常フロー
  if (!currentPrompt) {
    await rebuildOrderFromSetting();
    applyPromptToUI(takeNextPrompt());
  }

 await fetchThemeOptions(); // ここで確実にPLAN_LIMITSを入れてからUI初期化

  // 初期UI状態
  btnStart && (btnStart.disabled = false);
  btnStop  && (btnStop.disabled  = true);
  btnJudge && (btnJudge.disabled = true);
  transcriptContainer && (transcriptContainer.style.display = 'none');


  // ✅ イベントはここで一度だけ
  wireEvents();

  // 設定変更 → 出題順だけ再構築して差し替え（イベント再バインドは不要）
  document.addEventListener('app:settingChanged', async () => {
    try {
      await rebuildOrderFromSetting();
      applyPromptToUI(takeNextPrompt());
    } catch (err) {
      console.error('rebuild order failed', err);
    }
  });
});


function wireEvents() {
  if (btnStart) btnStart.addEventListener('click', onStartClick);
  if (btnStop)  btnStop.addEventListener('click', onStopClick);
  if (btnJudge) btnJudge.addEventListener('click', onJudgeClick);
  if (btnNext)  btnNext.addEventListener('click', onNextClick);
  if (btnRetry) btnRetry.addEventListener('click', onRetryClick);

  const btnHome   = document.getElementById('btnHome');
  const btnAdmin  = document.getElementById('btnAdmin');
  const btnProfile= document.getElementById('btnProfile');
  const btnLogout = document.getElementById('btnLogout');

  btnHome?.addEventListener('click', () => location.href='menu.html');

  if (btnAdmin) {
    try {
      const payload = JSON.parse(atob(localStorage.getItem('authToken').split('.')[1]));
      if (payload.role === 'admin') {
        btnAdmin.style.display = '';
        btnAdmin.addEventListener('click', () => location.href='admin.html');
      }
    } catch {}
  }

  btnProfile?.addEventListener('click', () => location.href='profile.html');

  if (btnLogout) {
    btnLogout.style.display = '';
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('authToken');
      location.href = 'login.html';
    });
  }
}



// ====== 出題順序制御（レベル内の sub 順 or ランダム） ======
let promptPool = [];   // 現在のレベルで出題対象となる配列
let promptOrder = [];  // 上記配列のインデックス順序（循環）
let orderPos    = -1;  // 現在の位置（次の取得で +1 する）

function getAppSettingNow() {
  try { return JSON.parse(localStorage.getItem('appSetting')) || {}; } catch { return {}; }
}

async function fetchAllThemes() {
  const res = await authFetch('/api/themes');

  // res は fetch の Response
  if (!res.ok) {
    throw new Error('themes fetch failed');
  }

  const data = await res.json();

  // ★ ここが重要：必ず配列を返す
  if (Array.isArray(data?.all)) return data.all;
  if (Array.isArray(data?.themes)) return data.themes;
  if (Array.isArray(data)) return data;

  console.warn('[themes] unexpected payload:', data);
  return [];
}



// レベルで絞って順序を作る。mode=sequential なら sub 昇順、random ならシャッフル
async function rebuildOrderFromSetting() {
  const s = getAppSettingNow();        // { level, mode ... }
  const all = await fetchAllThemes();  // [{level, sub, display_id, ...}, ...]
  const list = Array.isArray(all) ? all : [];   // ★これ

  // === テーマ適用（tokens）===
  // 保存済み themeId があればそれを優先。なければ default、最後に先頭要素
  const selectedId = localStorage.getItem("themeId") || "default";
  const selected = (list.find(t => t.id === selectedId) || list.find(t => t.id === "default") || list[0]);
  if (selected?.tokens) applyThemeTokens(selected.tokens);


  // レベルで絞る（空なら全件）
  const pool = (s.level ? list.filter(x => x.level === s.level) : list).slice();


  // 並び替え
  if (s.mode === 'sequential') {
    const num = v => {
      const m = String(v ?? '').match(/\d+/);
      return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
    };
    pool.sort((a, b) => {
      // sub が優先。なければ display_id → id → 文字列比較
      const as = num(a.sub ?? a.display_id ?? a.id);
      const bs = num(b.sub ?? b.display_id ?? b.id);
      if (as !== bs) return as - bs;
      return String(a.display_id ?? a.id ?? '').localeCompare(String(b.display_id ?? b.id ?? ''));
    });
    promptOrder = pool.map((_, i) => i);
  } else {
    // random
    promptOrder = pool.map((_, i) => i).sort(() => Math.random() - 0.5);
  }

  promptPool = pool;
  orderPos   = -1; // リセット（次の取り出しで0へ）
}

// 次の1問を取り出す（循環）
function takeNextPrompt() {
  if (!promptPool.length || !promptOrder.length) return null;
  orderPos = (orderPos + 1) % promptOrder.length;
  return promptPool[promptOrder[orderPos]] || null;
}




// ====== タイマーUI表示用 ======
function updateTimerUI() {
  if (!timerEl || !barInner) return;
  if (timerType === 'countdown') {
    timerEl.textContent = `残り時間：${Math.max(timerLimit - seconds, 0)}秒`;
  } else {
    timerEl.textContent = `経過時間：${seconds}秒`;
  }
  barInner.style.width = `${Math.min(seconds / timerLimit * 100, 100)}%`;
}

async function onStartClick() {
    uiState = 'recording'; // ★ ここ

  // 1) 設定は DOM ではなく保存値（＋プラン制限）から取得
  const eff = (window.getEffectiveSetting)
    ? await window.getEffectiveSetting()
    : (JSON.parse(localStorage.getItem('appSetting') || '{}') || {});

  // 2) 取得値をそのまま採用（getEffectiveSetting 内で maxTime は矯正済み）
  timerLimit     = Number(eff.maxTime) || 60;
  timerType      = eff.timerType || 'countup';
  forceEnd       = (typeof eff.forceEnd === 'string') ? (eff.forceEnd === 'on') : !!eff.forceEnd;
  // transcription はプランの禁止があるかもしれないので最終確認
  // （ensurePlanLimits 済みなら lims を見てブロック）
  if (window.applyPlanLimitsToModal || window.openSettingModal) {
    const lims = (await (window.ensurePlanLimits?.() || Promise.resolve(null)))?.limits || {};
    showTranscript = (eff.transcript !== 'off') && (lims.allowTranscription !== false);
  } else {
    showTranscript = (eff.transcript !== 'off');
  }

  // もしまだ問題がセットされていなければ、順序を組んで1問目を適用
  if (!currentPrompt) {
    try {
      if (!promptPool.length) await rebuildOrderFromSetting();
      const first = takeNextPrompt();
      if (first) applyPromptToUI(first);
    } catch (e) {
      console.error(e);
    }
  }

  // ▼▼▼【3. タイマーなど初期化】▼▼▼
  finalText = "";
  seconds = 0;
  updateTimerUI();
  barInner.style.width = '0%';

  btnStart.disabled = true;
  btnJudge.disabled = true;
  if (!isAndroid()) btnStop.disabled = true;

if (transcriptContainer) transcriptContainer.style.display = 'none';
  shouldKeepRunning = true;
  countdownEl.textContent = "";

  // ▼▼▼【4. カウントダウン演出】▼▼▼
  const doCountdown = (callback) => {
    let count = 3;
    const cdI = setInterval(() => {
      countdownEl.textContent = count;
      countdownEl.classList.remove('animate');
      void countdownEl.offsetWidth;
      countdownEl.classList.add('animate');
      count--;
      if (count < 0) {
        clearInterval(cdI);
        setTimeout(() => {
          countdownEl.classList.remove('animate');
          countdownEl.textContent = "";
          btnStop.disabled = false;
          callback();
        }, 1000);
      }
    }, 1000);
  };

  // ▼▼▼【5. タイマーの開始関数（カウントアップ/ダウン両対応）】▼▼▼
  let timerStarted = false;
  const startTimer = () => {
    if (timerStarted) return;
    timerStarted = true;
    btnStop.disabled = false;
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      seconds += 1;
      updateTimerUI();

      if (seconds >= timerLimit) {
        if (forceEnd) {
          // 強制終了あり: 最大時間で自動STOP
          btnStop.click();
          clearInterval(timerInterval);
        }
        // 強制終了なし: 何もしない。カウントだけ進める
      }
    }, 1000);
  };

// ▼▼▼【5.5 早期フォールバック：環境ガード】▼▼▼（新規）
const hasSpeech = ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
if (!hasSpeech && !isAndroid()) {
  // 音声認識なし → テキスト入力モードで代替
ensureSpeechInput();
  speechInput.style.display = '';
  speechInput.value = '';
  speechInput.focus();
  startTimer();        // ← ここなら参照OK
  return;              // 録音ルートへ進まない
}

if (!navigator.mediaDevices?.getUserMedia && !isAndroid()) {
  alert('このブラウザはマイク入力に対応していません。テキスト入力モードでご利用ください。');
ensureSpeechInput();
  speechInput.style.display = '';
  speechInput.value = '';
  speechInput.focus();
  startTimer();
  return;
}

  // ▼▼▼【6. 音声入力 or Androidテキスト】▼▼▼
 if (isAndroid()) {
   btnStop.disabled = false;
   ensureSpeechInput();
   if (PLAN_LIMITS?.allowTranscription !== false) {
     speechInput.style.display = "";
     speechInput.value = "";
     speechInput.focus();
     speechInput.addEventListener('input', startTimer, { once: true });
   } else {
     // 文字起こし禁止：入力欄は出さずにタイマーだけ開始
     speechInput.style.display = "none";
     startTimer();
   }
  } else {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        mediaStream = stream;
        recorder    = new MediaRecorder(stream);
        recorder.ondataavailable = () => {};
        initRecognition();

        recorder.onstart = () => {
            if (transcriptContainer) {
              transcriptContainer.style.display = (PLAN_LIMITS?.allowTranscription === false) ? 'none' : '';
}          try { recognition.start(); } catch {}
          doCountdown(() => startTimer());
        };
        recorder.start();
      })
      .catch(err => {
        btnStart.disabled = false;
        btnStop.disabled  = true;
      });
  }
}
function onStopClick() {
    uiState = 'stopped'; // ★ ここ

  shouldKeepRunning = false;
  clearInterval(timerInterval);
  btnStop.disabled  = true;
  btnJudge.disabled = false;

  if (isAndroid() && speechInput) {
    finalText = speechInput.value;
    // Androidの生テキスト
    lastTranscriptRaw = finalText;
    // ひらがな化（可能ならkuromoji、無ければとりあえずそのまま）
    if (tokenizer) {
      const tokens = tokenizer.tokenize(finalText);
      lastTranscriptHira = tokens.map(t =>
        t.reading ? toHiragana(t.reading) : t.surface_form
      ).join('');
    } else {
      lastTranscriptHira = finalText;
    }
    transcriptEl.textContent = lastTranscriptHira;
    if (speechInput) {
      speechInput.blur();
      speechInput.style.display = 'none';
    }
  }

  setTimeout(() => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
    }
    if (!isAndroid()) {
      recognition && recognition.stop();
      recorder    && recorder.state !== 'inactive' && recorder.stop();
    }
  }, 2000);
  }
  console.log('[save] payload=', decodeJwtPayload(localStorage.getItem("authToken")));

  async function onJudgeClick() {
    uiState = 'result'; // ★ ここ

  if (isAndroid() && speechInput && speechInput.style.display !== 'none') {
    finalText = speechInput.value;
    lastTranscriptRaw = finalText;
    if (tokenizer) {
      const tokens = tokenizer.tokenize(finalText);
      lastTranscriptHira = tokens.map(t =>
        t.reading ? toHiragana(t.reading) : t.surface_form
      ).join('');
    } else {
      lastTranscriptHira = finalText;
    }
    transcriptEl.textContent = lastTranscriptHira;  }

if (transcriptContainer) transcriptContainer.style.display = '';
  showResultView();

  resultPrompt.textContent = showTranscript ? transcriptEl.textContent : '※設定により非表示';

  resTime.textContent  = seconds;
  const charCount      = transcriptEl.textContent.replace(/[ 　\r\n\t]/g, '').length;
  resChars.textContent = charCount;
  const scoreLabel     = calculateScore(seconds, charCount, timerLimit);
  resScore.textContent = scoreLabel;
  if (barInner2) {
   barInner2.style.width = `${Math.min(seconds / timerLimit * 100, 100)}%`;
   }

  if (isAndroid() && speechInput) speechInput.style.display = 'none';

  // ここから保存（不合格でも履歴として保存したいならこのまま。保存しないなら条件分岐）
  try {
   if (isTokenExpired()) {
     alert('ログインの有効期限が切れました。再ログインしてください。');
     localStorage.removeItem('authToken');
     location.href = 'login.html';
     return;
   }
   const uid = getUidFromToken();    
    const themeId = getThemeIdForSave();
    if (!themeId) {
    console.warn('theme_id が取得できません', {
      currentPrompt,
    datasetThemeKey: document.querySelector('#prompt')?.dataset?.themeKey,
    lastThemeKey: localStorage.getItem('lastThemeKey')
    });      return;
    }
    // 数値化＆合否判定
    const numericScore = Number(String(scoreLabel).replace(/[^\d]/g,'') || 0);
    const isPass = scoreLabel !== '不合格';

   if (!uid) {
     console.warn('保存中断：uid が取得できません');
     alert('ユーザー情報が取得できません。再ログインしてください。');
     location.href = 'login.html';
     return;
   }
   if (!themeId) {
     console.warn('保存中断：theme_id が取得できません', { currentPrompt, dom: document.querySelector('#prompt')?.outerHTML });
     return;
   }
 const trRaw  = (PLAN_LIMITS?.allowTranscription === false) ? '' : lastTranscriptRaw;
 const trHira = (PLAN_LIMITS?.allowTranscription === false) ? '' : lastTranscriptHira;
 await saveScoreToServer({
        uid,
        themeId,
        score: numericScore,
        isPass,
        durationSec: seconds,
        charCount,
   transcriptRaw: trRaw,
   transcriptHira: trHira
        });
      console.log('score saved', { uid, themeId, numericScore, isPass, seconds, charCount });
    
  } catch (e) {
    console.error(e);
  }
if (btnRetry) btnRetry.style.display = '';

  }
  async function onNextClick() {
  // 順序が未構築なら構築
  if (!promptPool.length || !promptOrder.length) {
    await rebuildOrderFromSetting();
  }
  // 既存の関数で“次”を表示（画面戻し・Androidクリア含む）
  await loadNextPrompt();
  }

function onRetryClick() {
  resetPracticeUI();
}