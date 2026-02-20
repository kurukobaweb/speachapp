// api.js — 完全版（ES Modules）
// fetch + JSON + 認証トークン対応 + Paywall(402)共通ハンドリング
// + レスポンス正規化（unwrap）で /api/me の {ok,user} を user として返す

const API_BASE = window.API_BASE || ''; // 例: http://localhost:8200

// ===============================
// internal helpers
// ===============================
function buildUrl(path) {
  if (!path) return API_BASE;
  if (path.startsWith('/')) return API_BASE + path;
  return API_BASE + '/' + path;
}

function safeCallPaywallModal(payload) {
  try {
    if (typeof window.openPaywallModal === 'function') {
      window.openPaywallModal(payload);
      return true;
    }
  } catch (_) {}
  return false;
}

// 402 の body から free_until を拾う（PHP/Laravelどちらでも）
function pickFreeUntil(body) {
  if (!body || typeof body !== 'object') return '';
  return body.free_until || body.freeUntil || body.freeUntilAt || '';
}


/**
 * APIレスポンスを「呼び出し側が使いやすい形」に正規化する
 * - /api/me が { ok:true, payload:{...}, user:{...} } のように返るケース対策
 * - 基本方針：user があれば user を返す、payload があれば payload を返す
 * - それ以外はそのまま返す（配列やプリミティブもOK）
 */
function unwrapResponse(res) {
  if (!res || typeof res !== "object") return res;

  // ★ログイン/認証系：token類が含まれる場合は絶対に崩さない
  if (
    "token" in res || "authToken" in res || "access_token" in res ||
    "refresh_token" in res || "id_token" in res
  ) {
    return res;
  }

  // 一番よくある：{ ok:true, user:{...} }
  if ("user" in res && res.user) return res.user;

  // 次に多い：{ ok:true, payload:{...} }
  if ("payload" in res && res.payload) return res.payload;

  return res;
}


// ===============================
// low-level fetch
// ===============================
async function authFetch(path, opts = {}) {
  const url = buildUrl(path);

  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };

  const token = localStorage.getItem('authToken');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // body が undefined のとき fetch に渡さない（GETで余計な挙動を避ける）
  const init = {
    method: opts.method || 'GET',
    credentials: 'include',
    headers,
  };
  if (opts.body !== undefined) init.body = opts.body;

  return fetch(url, init);
}

// ===============================
// fetch + JSON wrapper
// ===============================
async function authFetchJSON(path, opts = {}) {
  const res = await authFetch(path, opts);

  // bodyを読む（エラーでも読む）
  let body = null;
  const ct = res.headers.get("content-type") || "";
  try {
    body = ct.includes("application/json") ? await res.json() : await res.text();
  } catch (e) {
    body = null;
  }

  // 401だけは例外（未ログイン扱い）
  if (res.status === 401) {
    const err = new Error("unauthorized");
    err.status = 401;
    err.code = "unauthorized";
    err.body = body;
    throw err;
  }

  // ★ここが重要：400〜499はthrowしない（業務エラーとして返す）
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      // bodyが {ok:false,...} でない場合に補完
      if (body && typeof body === "object" && body.ok === undefined) body.ok = false;
      return body || { ok: false, status: res.status, error: "http_error" };
    }

    // 500系は例外
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.code = "http_error";
    err.body = body;
    throw err;
  }

  return body;
}


// ===============================
// public API
// ===============================
const api = {
  /**
   * get/post/put/del は「unwrap後」を返す（通常の画面ロジック用）
   * 例：/api/me が {ok,user} を返しても、呼び出し側は user.course_id を取れる
   */
  async get(path, opts = {}) {
    const res = await authFetchJSON(path, { ...opts, method: 'GET' });
    return unwrapResponse(res);
  },

  async post(path, data, opts = {}) {
    const res = await authFetchJSON(path, {
      ...opts,
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
    return unwrapResponse(res);
  },

  async put(path, data, opts = {}) {
    const res = await authFetchJSON(path, {
      ...opts,
      method: 'PUT',
      body: JSON.stringify(data ?? {}),
    });
    return unwrapResponse(res);
  },

  async del(path, opts = {}) {
    const res = await authFetchJSON(path, { ...opts, method: 'DELETE' });
    return unwrapResponse(res);
  },

  /**
   * rawで取りたい場合（デバッグ・管理画面・ログ用）
   * 例：/api/me の ok/payload/user 全体が欲しいなど
   */
  getRaw(path, opts = {}) {
    return authFetchJSON(path, { ...opts, method: 'GET' });
  },
  postRaw(path, data, opts = {}) {
    return authFetchJSON(path, {
      ...opts,
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
  },
  putRaw(path, data, opts = {}) {
    return authFetchJSON(path, {
      ...opts,
      method: 'PUT',
      body: JSON.stringify(data ?? {}),
    });
  },
  delRaw(path, opts = {}) {
    return authFetchJSON(path, { ...opts, method: 'DELETE' });
  },

  // -----------------------------
  // Entitlement helpers
  // -----------------------------
  async checkEntitlement(opts = {}) {
    // /api/entitlement を呼ぶ（成功時 body を返す）
    // 401/402 は authFetchJSON 側で例外
    // ※ここは “ラップ形式” を返す想定が薄いので unwrap は任意だが、
    //   念のため unwrap して返す（show_popup 等が payload に入る場合も吸収）
    const res = await api.getRaw('/api/entitlement', opts);
    return unwrapResponse(res);
  },

  async checkEntitlementAndMaybePopup({ upgradeUrl } = {}) {
    try {
      const e = await api.checkEntitlement();

      // /api/entitlement のレスポンス想定：
      // { show_popup, popup_type, free_until, days_left, paywall, ... }
      if (e && e.show_popup) {
        safeCallPaywallModal({
          type: e.popup_type || (e.paywall ? 'expired' : 'warning'),
          freeUntil: e.free_until || '',
          daysLeft: e.days_left || 0,
          upgradeUrl: upgradeUrl || window.UPGRADE_URL || '',
        });
      }

      return e;
    } catch (err) {
      // 402 は authFetchJSON がモーダル表示済み
      // 401 は未ログインなので、必要ならここでログイン画面へ
      return null;
    }
  },

  // 直接使いたい場合用
  authFetch,
  authFetchJSON,

  // unwrapも必要なら公開（デバッグ用）
  unwrapResponse,
};

export default api;
export { api };
