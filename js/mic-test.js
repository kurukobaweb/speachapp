// /js/mic-test.js — help.html 用（既存UIそのまま）
// 文字起こし + 入力レベル表示（Chrome/EdgeでSTT、他は録音レベルのみ）
// ※ help.html で login.js を読み込んでいる場合は外してください（二重バインド防止）

(() => {
  'use strict';

  // --- 要素
  const micTestBtn        = document.getElementById('micTestBtn');
  const micOverlay        = document.getElementById('micTestOverlay');
  const startMicTest      = document.getElementById('startMicTest');
  const stopMicTest       = document.getElementById('stopMicTest');
  const closeMicTest      = document.getElementById('closeMicTest');
  const micLevelBar       = document.getElementById('micLevelBar');
  const micTestTranscript = document.getElementById('micTestTranscript');
  const micTestStatus     = document.getElementById('micTestStatus');
  const micTestInput      = document.getElementById('micTestInput');

  if (!micTestBtn || !micOverlay || !startMicTest || !stopMicTest) return;

  const SUCCESS_PROMPT = '文字起こしされればアプリをご利用いただけます。';
  const ERROR_PROMPT   = '入力が確認できません。マイク許可とブラウザをご確認ください（Chrome/Edge推奨）。';

  const isAndroid = () => /Android/i.test(navigator.userAgent);
  const isHttps   = () => location.protocol === 'https:' || location.hostname === 'localhost';

  // 音声系（非Android）
  let mediaStream = null, audioContext = null, analyser = null, rafId = null, recognition = null;

  const setStatus = (msg) => { if (micTestStatus) micTestStatus.textContent = msg || ''; };
  const resetUI = () => {
    setStatus('');
    if (micLevelBar) micLevelBar.style.width = '0%';
    if (micTestTranscript) micTestTranscript.textContent = '';
    if (micTestInput) { micTestInput.value = ''; micTestInput.style.display = 'none'; }
    startMicTest.disabled = false; stopMicTest.disabled = true;
  };

  function monitorLevel() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((s, v) => s + v, 0) / (data.length || 1);
    const percent = Math.min(100, Math.max(0, Math.round((avg / 255) * 100)));
    micLevelBar.style.width = percent + '%';
    rafId = requestAnimationFrame(monitorLevel);
  }

  function stopAll() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (recognition) { try { recognition.onresult = null; recognition.stop(); } catch(_) {} recognition = null; }
    if (audioContext) { try { audioContext.close(); } catch(_) {} audioContext = null; }
    if (mediaStream) { try { mediaStream.getTracks().forEach(t => t.stop()); } catch(_) {} mediaStream = null; }
    startMicTest.disabled = false; stopMicTest.disabled = true;
  }

  // Overlay
  micTestBtn.addEventListener('click', () => { micOverlay.style.display = 'block'; resetUI(); });
  closeMicTest?.addEventListener('click', () => { stopAll(); micOverlay.style.display = 'none'; });

  // 開始
  startMicTest.addEventListener('click', async () => {
    resetUI(); startMicTest.disabled = true; stopMicTest.disabled = false;

    // Android: キーボードの音声入力を利用（Web Speech は不安定なため）
    if (isAndroid()) {
      if (micTestInput) {
        micTestInput.style.display = 'block'; micTestInput.value = ''; micTestInput.focus();
        const onInput = () => {
          const txt = micTestInput.value;
          micTestTranscript.textContent = txt;
          setStatus(txt.trim() ? SUCCESS_PROMPT : '');
        };
        micTestInput.oninput = onInput;
        setStatus('Androidではキーボードの音声入力をご利用ください。');
      }
      return;
    }

    // 非Android：getUserMedia + WebAudio + Web Speech API
    if (!isHttps()) { setStatus('HTTPSでアクセスしてください（または localhost）。'); resetUI(); return; }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { setStatus(`マイク許可が必要です：${e.name || e.message}`); resetUI(); return; }

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser(); analyser.fftSize = 2048;
      audioContext.createMediaStreamSource(mediaStream).connect(analyser);
      monitorLevel();
    } catch (e) { console.warn('Level meter error:', e); }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('このブラウザは書き起こしに対応していません（Chrome/Edge推奨）。'); return; }

    recognition = new SR();
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = true;

    let finalText = '';
    recognition.onstart  = () => setStatus('書き起こし中…話しかけてください');
    recognition.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res  = ev.results[i];
        const text = (res[0]?.transcript || '').trim();
        if (!text) continue;
        if (res.isFinal) finalText = (finalText + ' ' + text).trim();
        else micTestTranscript.textContent = (finalText + ' （' + text + '）').trim();
      }
      micTestTranscript.textContent = finalText;
      if (finalText) setStatus(SUCCESS_PROMPT);
    };
    recognition.onerror = (e) => setStatus(`書き起こしエラー: ${e.error || e.message || e}`);
    recognition.onend   = () => {
      startMicTest.disabled = false; stopMicTest.disabled = true;
      if (!micTestTranscript.textContent.trim()) setStatus(ERROR_PROMPT);
    };

    try { recognition.start(); }
    catch (e) { setStatus(`開始できませんでした：${e.message || e}`); stopAll(); }
  });

  // 停止
  stopMicTest.addEventListener('click', () => {
    if (isAndroid()) {
      const txt = (micTestInput?.value || '').trim();
      micTestTranscript.textContent = txt;
      setStatus(txt ? SUCCESS_PROMPT : ERROR_PROMPT);
      if (micTestInput) micTestInput.style.display = 'none';
      startMicTest.disabled = false; stopMicTest.disabled = true;
      return;
    }
    stopAll();
    setStatus(micTestTranscript.textContent.trim() ? SUCCESS_PROMPT : ERROR_PROMPT);
  });

  window.addEventListener('pagehide', stopAll);
  window.addEventListener('beforeunload', stopAll);
})();
