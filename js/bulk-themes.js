// /js/bulk-themes.js — 共通apiクライアント対応・二重発火防止
import { api, requireToken } from "./api.js";

(() => {
  "use strict";

  if (window.__bulkThemesInited) return;   // ← 二重読込ガード
  window.__bulkThemesInited = true;

  const $file   = document.getElementById('fileInput');
  const $drop   = document.getElementById('dropzone');
  const $area   = document.getElementById('themesJson');
  const $btn    = document.getElementById('bulkBtn');
  const $msg    = document.getElementById('bulkMsg');
  const $name   = document.getElementById('previewName');
  const $count  = document.getElementById('previewCount');
  const $cancel = document.getElementById('cancelBtn');

  // 未ログインならログインへ（以降の呼び出しは api が自動でJWTを付与）
  requireToken();

  const showMessage = (text, ok=false) => {
    if (!$msg) return;
    $msg.textContent = text || '';
    $msg.className = ok ? 'success' : 'error';
  };
  const clearMessage = () => showMessage('', true);

  const normalizeRows = (rows) => rows.map(r => {
    const out = { ...r };
    if (out.level != null) out.level = String(out.level).trim();
    if (out.type  != null) out.type  = String(out.type).trim();
    if (out.sub   != null) out.sub   = String(out.sub).trim();
    if (out.question != null) out.question = String(out.question).trim();
    if (!out.id || isNaN(out.id)) out.id = '';
    if (!out.created_at || isNaN(out.created_at)) out.created_at = '';
    return out;
  });

  const validateRows = (rows) => {
    rows.forEach((r,i) => {
      if (!r.level || !r.sub || !r.type || !r.question) {
        throw new Error(`Row ${i+1}: level/sub/type/question は必須です`);
      }
    });
  };

  async function assignSequentialIds(rows) {
    // 最大ID取得 → 連番採番
    const { maxId = 0 } = await api.get("/api/admin/themes/maxid");
    let nextId = Number(maxId) + 1;
    return rows.map(r => ({ ...r, id: r.id && !isNaN(r.id) ? String(r.id) : String(nextId++) }));
  }

  const updatePreview = (rows, fileName='') => {
    if ($count) $count.textContent = String(rows?.length || 0);
    if ($name)  $name.textContent  = fileName || '—';
  };

  async function handleFile(file){
    if (!file) return;
    clearMessage();

    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        $area.value = text;
        updatePreview(JSON.parse(text), file.name);
      } else if (file.name.endsWith('.xlsx')) {
        const buf = await file.arrayBuffer();
        const wb  = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
        const rows = normalizeRows(json);
        $area.value = JSON.stringify(rows, null, 2);
        updatePreview(rows, file.name);
      } else {
        showMessage('対応形式は .json / .xlsx です', false);
      }
    } catch (e) {
      console.error(e);
      showMessage('読み込みエラー：' + e.message, false);
    } finally {
      // 同じファイル選択でも change が走るようにクリア
      $file.value = '';
    }
  }

  // ▼▼ イベント（1回だけバインド） ▼▼
  $drop?.addEventListener('click', () => $file.click(), { once:false });

  $drop?.addEventListener('dragover', e => { e.preventDefault(); $drop.classList.add('is-drag'); });
  $drop?.addEventListener('dragleave', () => $drop.classList.remove('is-drag'));
  $drop?.addEventListener('drop', e => {
    e.preventDefault(); $drop.classList.remove('is-drag');
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  });

  $file?.addEventListener('change', e => handleFile(e.target.files?.[0]));

  $area?.addEventListener('input', () => {
    try {
      const arr = JSON.parse($area.value || '[]');
      updatePreview(arr, '手入力');
      clearMessage();
    } catch {
      updatePreview([], '手入力');
    }
  });

  $btn?.addEventListener('click', async () => {
    clearMessage();
    let rows;
    try {
      rows = normalizeRows(JSON.parse($area.value || '[]'));
      validateRows(rows);
    } catch (e) {
      showMessage('入力エラー：' + e.message, false);
      return;
    }

    try {
      rows = await assignSequentialIds(rows);
    } catch (e) {
      showMessage('ID付与エラー：' + e.message, false);
      return;
    }

    try {
      $btn.disabled = true; $btn.textContent = 'RECORDING…';
      const data = await api.post("/api/admin/themes/bulk", { themes: rows });
      showMessage(`登録成功：${(data && data.count) ?? rows.length}件`, true);
    } catch (e) {
      console.error(e);
      const msg = e?.body?.error || e?.message || '登録に失敗しました';
      showMessage('登録に失敗しました：' + msg, false);
    } finally {
      $btn.disabled = false; $btn.textContent = 'RECORD';
    }
  });

  $cancel?.addEventListener('click', () => { location.href = '../index.html'; });

})();
