// /js/mic.js — help.html のマイクテスト（UIそのまま・録音＋STT対応）
(() => {
  'use strict';

  // === 要素参照（あなたのHTMLに合わせて） ===
  const btnStart   = document.getElementById('micStartBtn');
  const btnStop    = document.getElementById('micStopBtn');
  const statusEl   = document.getElementById('micStatus');
  const levelEl    = document.getElementById('micLevel');      // 幅を%で伸ばす
  const levelBar2  = document.getElementById('micLevelBar');   // 追加バー（あれば）
  const dbEl       = document.getElementById('micDb');
  const playback   = document.getElementById('micPlayback');
  const transcript = document.getElementById('micTestTranscript');
  const inputEl    = document.getElementById('micTestInput');  // Androidキーボード用fallback

  if (!btnStart || !btnStop) return; // UIが無いページでは何もしない

  // === 状態 ===
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let rafId = null;
  let recorder = null;
  let chunks = [];
  let recog = null;
  let recognizing = false;

  const isHttps = () => location.protocol === 'https:' || location.hostname === 'localhost';
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // === UTILS ===
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg || ''; };
  const setTranscript = (text) => { if (transcript) transcript.textContent = text || ''; };
  const appendTranscript = (text) => { if (!transcript) return; transcript.textContent = (transcript.textContent + ' ' + (text || '')).trim(); };

  function updateLevel() {
    if (!analyser) return;
    const time = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(time);

    // RMS -> 擬似dB化（相対）
    let sum = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    const rms = Math.sqrt(sum / time.length);         // 0..1
    const db  = 20 * Math.log10(Math.max(rms, 0.0001));
    const pct = Math.min(100, Math.max(0, Math.round(rms * 200))); // 見た目調整

    if (levelEl)   levelEl.style.width = pct + '%';
    if (levelBar2) levelBar2.style.width = pct + '%';
    if (dbEl)      dbEl.textContent = `${db.toFixed(1)} dB`;

    rafId = requestAnimationFrame(updateLevel);
  }

  function stopLevel() {
    if (rafId) cancelAnimationFrame(rafId), rafId = null;
    analyser = null;
    if (audioCtx) { try { audioCtx.close(); } catch(_){} audioCtx = null; }
    if (levelEl)   levelEl.style.width = '0%';
    if (levelBar2) levelBar2.style.width = '0%';
    if (dbEl)      dbEl.textContent = '– dB';
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  function stopRecorder() {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch(_) {}
    recorder = null;
  }

  function stopRecognition() {
    recognizing = false;
    try { recog && recog.stop && recog.stop(); } catch(_) {}
    recog = null;
  }

  function resetUI() {
    setStatus('準備OK');
    setTranscript('');
    if (inputEl) { inputEl.value = ''; inputEl.style.display = 'none'; inputEl.oninput = null; }
    btnStart.disabled = false;
    btnStop.disabled = true;
  }

  async function startRecording() {
    if (!isHttps()) { setStatus('HTTPSでアクセスしてください（または localhost）'); return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setStatus(`マイク許可が必要です：${e.name || e.message}`);
      return false;
    }

    // レベルメータ
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      updateLevel();
    } catch (e) {
      console.warn('AudioContext error:', e);
    }

    // レコーダ（再生確認用）
    chunks = [];
    const mt = MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined;
    try {
      recorder = new MediaRecorder(stream, mt);
    } catch (e) {
      setStatus('このブラウザは録音に対応していません。最新の Chrome/Edge/Firefox/Safari をお試しください。');
      stopStream(); stopLevel();
      return false;
    }

    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
    recorder.onstop = () => {
      stopStream(); stopLevel();
      if (playback && chunks.length) {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        playback.src = URL.createObjectURL(blob);
        playback.style.display = '';
        setStatus('録音停止（再生で確認できます）');
      }
    };
    recorder.start();
    return true;
  }

  function startRecognition() {
    // Android はキーボード音声入力を案内（Web Speech が不安定のため）
    if (isAndroid()) {
      if (inputEl) {
        inputEl.style.display = 'block';
        inputEl.value = '';
        inputEl.focus();
        inputEl.oninput = () => { setTranscript(inputEl.value); if (inputEl.value.trim()) setStatus('文字起こしOK'); };
        setStatus('Androidはキーボードの音声入力をご利用ください。');
        return true;
      }
      return false;
    }

    if (!SR) { setStatus('このブラウザは文字起こしに対応していません（Chrome/Edge推奨）'); return false; }

    recog = new SR();
    recog.lang = 'ja-JP';
    recog.interimResults = true;
    recog.continuous = true;

    let finalText = '';

    recog.onstart = () => { recognizing = true; setStatus('書き起こし中…話しかけてください'); };
    recog.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = (r[0]?.transcript || '').trim();
        if (!t) continue;
        if (r.isFinal) finalText = (finalText + ' ' + t).trim();
        else interim = t;
      }
      setTranscript(interim ? `${finalText}（${interim}）` : finalText);
      if (finalText) setStatus('文字起こしOK');
    };
    recog.onerror = (e) => setStatus(`書き起こしエラー: ${e.error || e.message || e}`);
    recog.onend   = () => { recognizing = false; setTranscript((transcript?.textContent || '').replace(/（[^）]*）$/u,'').trim()); };

    try { recog.start(); return true; }
    catch (e) { setStatus(`書き起こし開始に失敗: ${e.message || e}`); return false; }
  }

  // === イベント ===
  btnStart.addEventListener('click', async () => {
    btnStart.disabled = true; btnStop.disabled = false;
    setStatus('準備中…');

    const recOK  = await startRecording();   // どのブラウザでも録音は試す
    const sttOK  = startRecognition();       // Chrome/EdgeならSTT、Androidはキーボード誘導

    if (!recOK && !sttOK) {
      setStatus('この環境ではマイクテストを開始できませんでした。HTTPS・権限・ブラウザをご確認ください。');
      btnStart.disabled = false; btnStop.disabled = true;
    } else if (sttOK) {
      setStatus('書き起こし中…（停止で終了）');
    } else {
      setStatus('録音中…（この環境では書き起こし不可）');
    }
  });

  btnStop.addEventListener('click', () => {
    stopRecognition();
    stopRecorder();
    stopStream();
    stopLevel();
    // Android入力欄を閉じる
    if (inputEl) inputEl.style.display = 'none';

    const ok = (transcript?.textContent || '').trim().length > 0;
    setStatus(ok ? '文字起こしOK' : '入力が確認できませんでした');
    btnStart.disabled = false; btnStop.disabled = true;
  });

  // ページ離脱で後始末
  window.addEventListener('pagehide', () => { stopRecognition(); stopRecorder(); stopStream(); stopLevel(); });
  window.addEventListener('beforeunload', () => { stopRecognition(); stopRecorder(); stopStream(); stopLevel(); });

  // 初期
  resetUI();
})();
