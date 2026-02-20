// help.js — help.html 専用 完全版
// ■対応UI
//  (A) カード型: #micStartBtn, #micStopBtn, #micStatus, #micLevel, #micLevelBar, #micDb, #micPlayback, #micTestTranscript, #micTestInput
//  (B) オーバーレイ型: #micTestBtn(開くボタン), #micTestOverlay 内の #startMicTest, #stopMicTest, #micTestStatus|#micStatus, #micLevelBar, #micTestTranscript, #micTestInput, #micPlayback(任意), #closeMicTest
//
// ■機能
//  - HTTPS/localhost 判定、マイク許可
//  - getUserMedia + MediaRecorder（録音/再生）
//  - Web Speech API（Chrome/Edgeで書き起こし、ja-JP / 途中経過は（）表示）
//  - Androidはキーボード音声入力を案内（#micTestInput を表示）
//  - レベルメータ（time-domain RMS → 擬似dB）
//  - 「使い方（機能別）」タブ切替（#other 配下のみ）

(function () {
  "use strict";

  // ===== Utility =====
  const isHttps   = () => location.protocol === "https:" || location.hostname === "localhost";
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  const SR        = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ===== Audio/STT Engine (singleton) =====
  const Engine = (() => {
    let stream = null, audioCtx = null, analyser = null, rafId = null;
    let recorder = null, chunks = [];
    let recog = null, recognizing = false;

    let UI = null; // {startBtn, stopBtn, statusEl, levelEls[], dbEl, transcriptEl, inputEl, playbackEl}

    const setStatus = (msg) => { UI?.statusEl && (UI.statusEl.textContent = msg || ""); };
    const setTranscript = (txt) => { UI?.transcriptEl && (UI.transcriptEl.textContent = txt || ""); };

    function updateLevel() {
      if (!analyser || !UI) return;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128; // -1..1
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);         // 0..1
      const db  = 20 * Math.log10(Math.max(rms, 0.0001));
      const pct = Math.min(100, Math.max(0, Math.round(rms * 200))); // 見た目用

      UI.levelEls?.forEach(el => el && (el.style.width = pct + "%"));
      if (UI.dbEl) UI.dbEl.textContent = isFinite(db) ? db.toFixed(1) + " dB" : "– dB";

      rafId = requestAnimationFrame(updateLevel);
    }

    function stopLevel() {
      if (rafId) cancelAnimationFrame(rafId), rafId = null;
      if (audioCtx) { try { audioCtx.close(); } catch(_){} audioCtx = null; }
      analyser = null;
      UI?.levelEls?.forEach(el => el && (el.style.width = "0%"));
      if (UI?.dbEl) UI.dbEl.textContent = "– dB";
    }

    function stopStream() {
      if (stream) { try { stream.getTracks().forEach(t => t.stop()); } catch(_){} stream = null; }
    }

    function attachUI(newUI) {
      // 停止して UI を差し替え
      stopAll();
      UI = newUI;
    }

    async function startRecording() {
      if (!isHttps()) { setStatus("HTTPSでアクセスしてください（または localhost）"); return false; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        setStatus(`マイク許可が必要です：${e.name || e.message}`);
        return false;
      }

      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        updateLevel();
      } catch (e) {
        console.warn("AudioContext error:", e);
      }

      chunks = [];
      const opt = MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined;
      try {
        recorder = new MediaRecorder(stream, opt);
      } catch (e) {
        setStatus("このブラウザは録音に対応していません。最新の Chrome/Edge/Firefox/Safari をお試しください。");
        stopStream(); stopLevel();
        return false;
      }

      recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
      recorder.onstop = () => {
        stopStream(); stopLevel();
        if (UI?.playbackEl && chunks.length) {
          const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
          UI.playbackEl.src = URL.createObjectURL(blob);
          UI.playbackEl.style.display = "";
          setStatus("録音停止（再生で確認できます）");
        }
      };
      recorder.start();
      return true;
    }

    function startRecognition() {
      if (isAndroid()) {
        if (UI?.inputEl) {
          UI.inputEl.style.display = "block";
          UI.inputEl.value = "";
          UI.inputEl.focus();
          UI.inputEl.oninput = () => {
            setTranscript(UI.inputEl.value);
            if (UI.inputEl.value.trim()) setStatus("文字起こしOK");
          };
          setStatus("Androidはキーボードの音声入力をご利用ください。");
          return true;
        }
        return false;
      }

      if (!SR) { setStatus("このブラウザは書き起こしに対応していません（Chrome/Edge推奨）"); return false; }

      recog = new SR();
      recog.lang = "ja-JP";
      recog.interimResults = true;
      recog.continuous = true;

      let finalText = "";
      recog.onstart  = () => { recognizing = true; setStatus("書き起こし中…話しかけてください"); };
      recog.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          const t = (r[0]?.transcript || "").trim();
          if (!t) continue;
          if (r.isFinal) finalText = (finalText + " " + t).trim();
          else interim = t;
        }
        setTranscript(interim ? `${finalText}（${interim}）` : finalText);
        if (finalText) setStatus("文字起こしOK");
      };
      recog.onerror = (e) => setStatus(`書き起こしエラー: ${e.error || e.message || e}`);
      recog.onend   = () => { recognizing = false; setTranscript((UI?.transcriptEl?.textContent || "").replace(/（[^）]*）$/u,"").trim()); };

      try { recog.start(); return true; }
      catch (e) { setStatus(`書き起こし開始に失敗: ${e.message || e}`); return false; }
    }

    function stopRecorder() {
      try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch(_) {}
      recorder = null;
    }
    function stopRecognition() {
      recognizing = false;
      try { recog && recog.stop && recog.stop(); } catch(_) {}
      recog = null;
    }

    function stopAll() {
      stopRecognition();
      stopRecorder();
      stopStream();
      stopLevel();
      if (UI?.inputEl) UI.inputEl.style.display = "none";
      if (UI?.startBtn) UI.startBtn.disabled = false;
      if (UI?.stopBtn)  UI.stopBtn.disabled  = true;
    }

    async function startAll() {
      if (!UI) return false;
      if (UI.startBtn) UI.startBtn.disabled = true;
      if (UI.stopBtn)  UI.stopBtn.disabled  = false;
      setStatus("準備中…");

      const recOK = await startRecording();   // どのブラウザでも録音を試す
      const sttOK = startRecognition();       // Chrome/EdgeならSTT、Androidはキーボード誘導

      if (!recOK && !sttOK) {
        setStatus("この環境ではマイクテストを開始できませんでした。HTTPS・権限・ブラウザをご確認ください。");
        if (UI.startBtn) UI.startBtn.disabled = false;
        if (UI.stopBtn)  UI.stopBtn.disabled  = true;
        return false;
      }
      setStatus(sttOK ? "書き起こし中…（停止で終了）" : "録音中…（この環境では書き起こし不可）");
      return true;
    }

    return { attachUI, startAll, stopAll, setStatus, setTranscript };
  })();

  // ====== カード型 UI のセットアップ ======
  function setupCardUI() {
    const startBtn = document.getElementById("micStartBtn");
    const stopBtn  = document.getElementById("micStopBtn");
    if (!startBtn || !stopBtn) return false; // カード型UIが無い

    const ui = {
      startBtn,
      stopBtn,
      statusEl: document.getElementById("micStatus") || document.getElementById("micTestStatus"),
      levelEls: [document.getElementById("micLevel"), document.getElementById("micLevelBar")].filter(Boolean),
      dbEl: document.getElementById("micDb"),
      transcriptEl: document.getElementById("micTestTranscript"),
      inputEl: document.getElementById("micTestInput"),
      playbackEl: document.getElementById("micPlayback"),
    };

    Engine.attachUI(ui);
    Engine.setStatus("準備OK（Chrome/Edgeなら書き起こし対応）");

    startBtn.addEventListener("click", () => Engine.startAll());
    stopBtn.addEventListener("click",  () => Engine.stopAll());

    return true;
  }

  // ====== オーバーレイ型 UI のセットアップ ======
  function setupOverlayUI() {
    const openBtn   = document.getElementById("micTestBtn");
    const overlay   = document.getElementById("micTestOverlay");
    if (!openBtn || !overlay) return false; // オーバーレイUIが無い

    const startBtn  = overlay.querySelector("#startMicTest");
    const stopBtn   = overlay.querySelector("#stopMicTest");
    const closeBtn  = overlay.querySelector("#closeMicTest");
    if (!startBtn || !stopBtn) return false;

    const ui = {
      startBtn,
      stopBtn,
      statusEl: overlay.querySelector("#micTestStatus") || overlay.querySelector("#micStatus"),
      levelEls: [overlay.querySelector("#micLevelBar")].filter(Boolean),
      dbEl: overlay.querySelector("#micDb"),
      transcriptEl: overlay.querySelector("#micTestTranscript"),
      inputEl: overlay.querySelector("#micTestInput"),
      playbackEl: overlay.querySelector("#micPlayback"),
    };

    openBtn.addEventListener("click", () => {
      overlay.style.display = "block";
      Engine.attachUI(ui);
      Engine.setStatus("準備OK（Chrome/Edgeなら書き起こし対応）");
    });

    startBtn.addEventListener("click", () => Engine.startAll());
    stopBtn .addEventListener("click", () => Engine.stopAll());
    closeBtn?.addEventListener("click", () => { Engine.stopAll(); overlay.style.display = "none"; });

    // オーバーレイを使う場合、カード型が同時にあるならカードは無視
    return true;
  }

  // ====== 「使い方（機能別）」タブ ======
  function setupOtherTabs() {
    const sec = document.getElementById("other");
    if (!sec) return;

    const tabs   = sec.querySelectorAll("[data-tab]");
    const panels = sec.querySelectorAll(".other-card");
    if (!tabs.length || !panels.length) return;

    const activate = (key) => {
      tabs.forEach(t => {
        const on = t.dataset.tab === key;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach(p => p.classList.toggle("is-active", p.dataset.panel === key));
      try { localStorage.setItem("help_other_tab", key); } catch {}
    };

    const initial = localStorage.getItem("help_other_tab") || tabs[0].dataset.tab || "score";
    activate(initial);
    tabs.forEach(t => t.addEventListener("click", (e) => { e.preventDefault(); activate(t.dataset.tab); }));
  }

  // ====== 起動 ======
  document.addEventListener("DOMContentLoaded", () => {
    // オーバーレイ型があれば優先して初期化、無ければカード型を初期化
    const overlayOK = setupOverlayUI();
    if (!overlayOK) setupCardUI();

    setupOtherTabs();

    // ページ離脱で確実に停止
    window.addEventListener("pagehide",  () => Engine.stopAll());
    window.addEventListener("beforeunload", () => Engine.stopAll());
  });

// 動作環境 自動判定（#env のみ作用）
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('env');
  if (!root) return;

  const uaText  = root.querySelector('#envUaText');
  const httpsEl = root.querySelector('#envHttpsChip');
  const micEl   = root.querySelector('#envMicChip');
  const sttEl   = root.querySelector('#envSttChip');

  const setChip = (el, state, text) => {
    if (!el) return;
    el.className = 'chip';
    if (state === 'ok') el.classList.add('chip-ok');
    else if (state === 'warn') el.classList.add('chip-warn');
    else if (state === 'ng') el.classList.add('chip-ng');
    el.textContent = text;
  };

  // HTTPS
  const isHttps = location.protocol === 'https:' || location.hostname === 'localhost';
  setChip(httpsEl, isHttps ? 'ok' : 'ng', isHttps ? 'OK（HTTPS）' : 'NG（HTTP）');

  // UA 表示
  if (uaText) uaText.textContent = navigator.userAgent;

  // 文字起こし（Web Speech API）判定：Chrome/Edge デスクトップのみ「OK」
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const ua = navigator.userAgent;
  const isDesktop = !/(Mobile|Android|iPhone|iPad|iPod)/.test(ua);
  const isChromiumDesktop = isDesktop && /\b(Chrome|Chromium|Edg)\//.test(ua);
  if (hasSR && isChromiumDesktop) {
    setChip(sttEl, 'ok', '文字起こしOK（Chrome/Edge）');
  } else {
    setChip(sttEl, 'warn', '非対応（録音のみ）');
  }

  // マイク権限（Permissions API があれば）
  const setMicState = (state) => {
    if (state === 'granted') setChip(micEl, 'ok', '許可済み');
    else if (state === 'denied') setChip(micEl, 'ng', '拒否されています');
    else setChip(micEl, 'warn', '未決定（要許可）');
  };

  try{
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' })
        .then((st) => {
          setMicState(st.state);
          st.onchange = () => setMicState(st.state);
        })
        .catch(() => setChip(micEl, 'warn', '不明（権限API非対応）'));
    } else {
      setChip(micEl, 'warn', '不明（権限API非対応）');
    }
  }catch(_){
    setChip(micEl, 'warn', '不明（権限API非対応）');
  }
});
(function(){
  document.querySelectorAll('.read-more-4').forEach(block=>{
    const p  = block.querySelector('p');
    const cb = block.querySelector('input[type="checkbox"]');
    if(!p || !cb) return;

    // 折りたたみ時の高さ = 行数 × line-height（小数切上げ）
    function collapsedHeight(){
      const styles = getComputedStyle(p);
      const lh     = parseFloat(styles.lineHeight) || 24;
      const lines  = parseFloat(getComputedStyle(block).getPropertyValue('--rm-lines')) || 4;
      return Math.ceil(lh * lines);
    }

    // 初期セット
    function setCollapsed(){
      const h = collapsedHeight();
      p.style.setProperty('--collapsed-h', h + 'px');
      if (!block.classList.contains('expanded')) {
        p.style.maxHeight = h + 'px';
      }
    }

    // 展開（にゅるっと）
    function expand(){
      block.classList.add('expanding');        // ← フェード等を先に消す
      const start = p.getBoundingClientRect().height;
      // 現在高さを固定してから…
      p.style.maxHeight = start + 'px';
      requestAnimationFrame(()=>{
        // フォント/改行の再計算にも強いよう2フレーム目でもう一度読む
        requestAnimationFrame(()=>{
          const target = Math.max(p.scrollHeight, p.scrollHeight) + 2; // ← +2pxバッファ
          p.style.maxHeight = target + 'px';
        });
      });
      const onEnd = (e)=>{
        if(e.propertyName !== 'max-height') return;
        p.style.maxHeight = 'none';            // ← 完全フリーに
        block.classList.add('expanded');
        block.classList.remove('expanding');
        p.removeEventListener('transitionend', onEnd);
      };
      p.addEventListener('transitionend', onEnd);
    }

    // 閉じる
    function collapse(){
      block.classList.add('expanding');
      block.classList.remove('expanded');
      // auto -> px 固定 → 折りたたみ高さへ
      const full      = p.scrollHeight;
      const collapsed = parseFloat(getComputedStyle(p).getPropertyValue('--collapsed-h')) || collapsedHeight();
      p.style.maxHeight = full + 'px';
      p.offsetHeight;                            // reflow
      p.style.maxHeight = collapsed + 'px';
      const onEnd = (e)=>{
        if(e.propertyName !== 'max-height') return;
        block.classList.remove('expanding');
        p.removeEventListener('transitionend', onEnd);
      };
      p.addEventListener('transitionend', onEnd);
    }

    // 初期化
    setCollapsed();
    if (cb.checked){
      block.classList.add('expanded');
      p.style.maxHeight = 'none';
    }

    // トグル
    cb.addEventListener('change', ()=> cb.checked ? expand() : collapse());

    // レスポンシブ再計算（フォントロードも考慮）
    let raf;
    const recalc = ()=>{
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(()=>{
        if (block.classList.contains('expanded')) {
          p.style.maxHeight = 'none';
        } else {
          setCollapsed();
        }
      });
    };
    window.addEventListener('resize', recalc);
    if ('fonts' in document && document.fonts.ready){
      document.fonts.ready.then(recalc).catch(()=>{});
    }
  });
})();

})();
