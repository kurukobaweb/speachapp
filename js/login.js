// /public/js/login.js （完全版）
// - submit を必ず止める（Enter/submitボタン対策）
// - ログイン成功時のみ遷移
// - 失敗時は authToken を必ず破棄
// - API接続不可（Failed to fetch 等）も明確に表示

import api from './api.js';

document.addEventListener("DOMContentLoaded", () => {
  // — 要素取得 —
  const loginEmail    = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn      = document.getElementById('loginBtn');
  const loginError    = document.getElementById('loginError');

  // form がある場合は submit を握る（最重要：Enter/submitによる遷移防止）
  const loginForm =
    loginBtn?.closest('form') ||
    document.getElementById('loginForm') ||
    document.querySelector('form');

  const micTestBtn        = document.getElementById('micTestBtn');
  const micOverlay        = document.getElementById('micTestOverlay');
  const startMicTest      = document.getElementById('startMicTest');
  const stopMicTest       = document.getElementById('stopMicTest');
  const closeMicTest      = document.getElementById('closeMicTest');
  const micLevelBar       = document.getElementById('micLevelBar');
  const micTestTranscript = document.getElementById('micTestTranscript');
  const micTestStatus     = document.getElementById('micTestStatus');
  const micTestInput      = document.getElementById('micTestInput');

  // — Android 判定 —
  function isAndroid() { return /Android/i.test(navigator.userAgent); }

  // — メッセージ定義 —
  const SUCCESS_PROMPT = '文字起こしされればアプリをご利用いただけます。';
  const ERROR_PROMPT   = '入力が確認できません。マイクが許可されているか確認してください。\nChrome 推奨。';

  // — オーディオ／認識用変数（非 Android） —
  let mediaStream, audioContext, analyser, rafId, recognition;

  // 共通：エラー表示
  function setLoginError(msg) {
    if (!loginError) return;
    loginError.textContent = msg || '';
  }

  // 共通：ボタン状態
  function setLoginBusy(isBusy) {
    if (!loginBtn) return;
    loginBtn.disabled = !!isBusy;
    if (loginBtn.dataset) loginBtn.dataset.busy = isBusy ? '1' : '0';
  }

  // 共通：ログイン実行（成功時のみ遷移）
  async function doLogin() {
    if (!loginEmail || !loginPassword || !loginBtn || !loginError) return;

    // 二重送信防止
    if (loginBtn.dataset?.busy === '1') return;

    setLoginError('');
    setLoginBusy(true);

    // 失敗時に「過去トークンで入れてしまう」を防ぐため、まず消す
    localStorage.removeItem('authToken');

    try {
      const email = (loginEmail.value || '').trim();
      const password = loginPassword.value || '';

      if (!email) {
        setLoginError('メールアドレスを入力してください');
        setLoginBusy(false);
        return;
      }
      if (!password) {
        setLoginError('パスワードを入力してください');
        setLoginBusy(false);
        return;
      }

      // API 呼び出し（api.js 側で res.ok を見て失敗は throw される想定）
      const data = await api.post('/api/login', { email, password });

      // サーバーが { token } を返す前提
      if (!data || !data.token) {
        throw new Error('トークンが取得できませんでした');
      }

      localStorage.setItem('authToken', data.token);

      // ★成功時のみ遷移
      window.location.href = 'index.html';
    } catch (err) {
      // 失敗時は必ず token を残さない
      localStorage.removeItem('authToken');

      // api.js 由来の構造（err.body.error）も考慮
      const ecode = err?.body?.error;
      const emsg  = err?.message;

      // 接続不可・CORS・サーバ未起動など（スクショの Failed to fetch / ERR_CONNECTION_REFUSED を想定）
      if (emsg && /Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED/i.test(emsg)) {
        setLoginError('APIに接続できません（サーバ未起動／URL誤り）。config.js の API_BASE を確認してください。');
      } else if (ecode === 'invalid_credentials') {
        setLoginError('メールアドレスまたはパスワードが違います');
      } else if (ecode === 'account_disabled') {
        setLoginError('このアカウントは無効化されています');
      } else {
        setLoginError(ecode || emsg || 'ログインに失敗しました');
      }

      setLoginBusy(false);
      return; // ★失敗時にここで必ず止める
    }
  }

  // — ログイン：submit を必ず止める（最重要）
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await doLogin();
    });
  }

  // — ログイン：ボタンクリック
  loginBtn?.addEventListener('click', async (e) => {
    // ボタンが submit でも安全にする
    e.preventDefault();
    await doLogin();
  });

  // — マイクテスト：オーバーレイを開く —
  micTestBtn?.addEventListener('click', () => {
    if (!micOverlay) return;
    micOverlay.style.display      = 'flex';
    if (micTestTranscript) micTestTranscript.textContent = '';
    if (micTestStatus)     micTestStatus.textContent     = '';
    if (micLevelBar)       micLevelBar.style.width       = '0%';
    if (micTestInput) { micTestInput.style.display = 'none'; micTestInput.value = ''; }
    startMicTest && (startMicTest.disabled = false);
    stopMicTest  && (stopMicTest.disabled  = true);
  });

  // — オーバーレイを閉じる —
  closeMicTest?.addEventListener('click', () => {
    stopAll();
    if (micOverlay) micOverlay.style.display = 'none';
  });

  // — マイクテスト開始 —
  startMicTest?.addEventListener('click', async () => {
    if (startMicTest) startMicTest.disabled = true;
    if (stopMicTest)  stopMicTest.disabled  = false;
    if (micTestTranscript) micTestTranscript.textContent = '';
    if (micTestStatus)     micTestStatus.textContent     = '';

    if (isAndroid()) {
      // Android：テキスト入力欄を表示
      if (micTestInput) {
        micTestInput.style.display = 'block';
        micTestInput.value = '';
        micTestInput.focus();
        micTestInput.addEventListener('input', onAndroidInputChange);
      }
      return;
    }

    // 非 Android：Web Audio + SpeechRecognition
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      monitorLevel();
    } catch (err) {
      console.error('マイクアクセスエラー:', err);
      if (micTestStatus) micTestStatus.textContent = ERROR_PROMPT;
      stopAll();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (micTestStatus) micTestStatus.textContent = ERROR_PROMPT;
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = e => {
      let interim = '', finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      const combined = finalText + interim;
      if (micTestTranscript) micTestTranscript.textContent = combined;
      if (combined.trim() && micTestStatus && !micTestStatus.textContent) {
        micTestStatus.textContent = SUCCESS_PROMPT;
      }
    };

    recognition.onerror = err => console.warn('SpeechRecognition error:', err.error);

    try { recognition.start(); } catch (e) { console.warn('recognition.start error:', e); }
  });

  function onAndroidInputChange() {
    if (!micTestInput) return;
    const txt = micTestInput.value;
    if (micTestTranscript) micTestTranscript.textContent = txt;
    if (micTestStatus) micTestStatus.textContent = txt.trim() ? SUCCESS_PROMPT : '';
  }

  // — マイクテスト停止 —
  stopMicTest?.addEventListener('click', () => {
    if (isAndroid()) {
      const txt = (micTestInput?.value || '').trim();
      if (micTestStatus) micTestStatus.textContent = txt ? SUCCESS_PROMPT : ERROR_PROMPT;
      if (micTestInput) micTestInput.style.display = 'none';
      if (startMicTest) startMicTest.disabled = false;
      if (stopMicTest)  stopMicTest.disabled  = true;
      return;
    }
    stopAll();
  });

  // — 音量メータ更新ループ（非 Android） —
  function monitorLevel() {
    if (!analyser || !micLevelBar) { rafId = requestAnimationFrame(monitorLevel); return; }
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
    micLevelBar.style.width = `${Math.min(100, (avg / 255) * 100)}%`;
    rafId = requestAnimationFrame(monitorLevel);
  }

  // — 全停止＆結果チェック（非 Android） —
  function stopAll() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
    if (startMicTest) startMicTest.disabled = false;
    if (stopMicTest)  stopMicTest.disabled  = true;

    if (micTestTranscript && micTestStatus && !micTestTranscript.textContent.trim()) {
      micTestStatus.textContent = ERROR_PROMPT;
    }
    // Android 入力のイベントを掃除（複数回バインド防止）
    if (micTestInput) micTestInput.removeEventListener('input', onAndroidInputChange);
  }
});
