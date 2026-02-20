// api.js — 共通APIクライアント（JWT自動付与・相対/絶対URL対応・FormData対応）

import { API_BASE } from "./config.js";
import api from './api.js';


/** 末尾/先頭スラッシュをうまく繋ぐ（pathが絶対URLなら無加工） */
function joinURL(base, path) {
  if (!path) return base;
  const abs = /^([a-z][a-z0-9+\-.]*:)?\/\//i.test(path);
  if (abs) return path; // すでに https://... など
  if (!base.endsWith("/") && !path.startsWith("/")) return `${base}/${path}`;
  if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1);
  return base + path;
}

/* ========= 認証ユーティリティ ========= */
export function getAuthToken() {
  return localStorage.getItem("authToken") || "";
}
export function setAuthToken(t) {
  if (t) localStorage.setItem("authToken", t);
  else localStorage.removeItem("authToken");
}
export function requireToken() {
  const t = getAuthToken();
  if (!t) {
    // 必要に応じてログインページへ
    location.href = "/login.html";
    // 以降の処理が続かないよう return だけ
  }
  return t;
}

/**
 * 共通リクエスト
 * opts:
 *  - method: "GET" | "POST" | ...
 *  - headers: Record<string,string>
 *  - body: object | FormData | string | Blob | ArrayBuffer
 *  - query: Record<string, string | number | boolean>
 *  - auth: boolean | "optional"  (既定: true)  true=JWT自動付与, false=付与しない, "optional"=あれば付与
 *  - token: 明示トークン（あればこれを優先）
 *  - credentials: "include"|"same-origin"|"omit"（既定: "same-origin"）
 *  - parse: "json"|"text"|"auto"（既定: "auto"）
 *  - timeoutMs: number （既定: 15000）
 */
async function request(path, {
  method = "GET",
  headers = {},
  body,
  query,
  auth = true,
  token,
  credentials = "same-origin",
  parse = "auto",
  timeoutMs = 15000,
} = {}) {

  let url = joinURL(API_BASE, path);

  // クエリ付与
  if (query && typeof query === "object") {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      sp.append(k, String(v));
    }
    if ([...sp].length) url += (url.includes("?") ? "&" : "?") + sp.toString();
  }

  // ヘッダ（Content-Typeは後で決める）
  const finalHeaders = { ...headers };

  // 認証ヘッダ
  let authToken = token;
  if (auth === true) {
    // 必須 → 未ログインなら requireToken() でガード（リダイレクト）
    authToken = authToken || requireToken();
  } else if (auth === "optional") {
    authToken = authToken || getAuthToken();
  }
  if (authToken) finalHeaders.Authorization = `Bearer ${authToken}`;

  // bodyの型で Content-Type を自動決定
  let outBody = body;
  const isFormData = (typeof FormData !== "undefined") && (body instanceof FormData);
  const isBlob     = (typeof Blob !== "undefined")     && (body instanceof Blob);
  const isBinary   = isBlob || body instanceof ArrayBuffer || ArrayBuffer.isView?.(body);

  if (body != null && !isFormData && !isBlob && !isBinary && typeof body === "object") {
    // 純オブジェクト → JSON
    outBody = JSON.stringify(body);
    if (!("Content-Type" in finalHeaders)) finalHeaders["Content-Type"] = "application/json";
  } else if (typeof body === "string") {
    // 文字列：明示されていなければ text/plain
    if (!("Content-Type" in finalHeaders)) finalHeaders["Content-Type"] = "text/plain;charset=UTF-8";
  } else {
    // FormData / Blob / Binary の場合はブラウザ任せ（Content-Typeを付けない）
    if ("Content-Type" in finalHeaders && isFormData) {
      // FormDataに Content-Type を付けるとboundary不整合になるので削除
      delete finalHeaders["Content-Type"];
    }
  }

  // タイムアウト制御
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: outBody,
      credentials,
      signal: ctrl.signal,
      cache: "no-cache",
    });
  } catch (e) {
    clearTimeout(timer);
    // Abortはタイムアウト扱いで詳細化
    if (e?.name === "AbortError") {
      const err = new Error(`Request timeout after ${timeoutMs}ms`);
      err.code = "ETIMEDOUT";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  // 2xx 以外を例外化（可能なら JSON を添付）
  if (!res.ok) {
    let detail;
    const ct = res.headers.get("content-type") || "";
    try {
      detail = ct.includes("application/json") ? await res.json() : await res.text();
    } catch {
      detail = null;
    }
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = detail;
    throw err;
  }

  // レスポンスのパース
  if (res.status === 204) return null; // No Content
  const ct = res.headers.get("content-type") || "";
  if (parse === "text") return res.text();
  if (parse === "json") return res.json();
  if (ct.includes("application/json")) return res.json();
  if (ct.startsWith("text/")) return res.text();
  // それ以外（バイナリ等）は生の Response を返したい場合もあるが、ここは null で統一
  return null;
}

/* ========= 使い分けショートカット ========= */
export const api = {
  // 認証必須（既定）
  get:   (path, opts = {})        => request(path, { ...opts, method: "GET" }),
  post:  (path, body, opts = {})  => request(path, { ...opts, method: "POST", body }),
  put:   (path, body, opts = {})  => request(path, { ...opts, method: "PUT", body }),
  patch: (path, body, opts = {})  => request(path, { ...opts, method: "PATCH", body }),
  del:   (path, opts = {})        => request(path, { ...opts, method: "DELETE" }),

  // 認証なし呼び出し（例：ログイン、公開API）
  anon: {
    get:   (p, o={})       => request(p, { ...o, method: "GET",  auth: false }),
    post:  (p, b, o={})    => request(p, { ...o, method: "POST", auth: false, body: b }),
    put:   (p, b, o={})    => request(p, { ...o, method: "PUT",  auth: false, body: b }),
    patch: (p, b, o={})    => request(p, { ...o, method: "PATCH",auth: false, body: b }),
    del:   (p, o={})       => request(p, { ...o, method: "DELETE", auth: false }),
  },

  // 認証は「あるなら付ける」（任意ページで便利）
  optional: {
    get:   (p, o={})       => request(p, { ...o, method: "GET",  auth: "optional" }),
    post:  (p, b, o={})    => request(p, { ...o, method: "POST", auth: "optional", body: b }),
    put:   (p, b, o={})    => request(p, { ...o, method: "PUT",  auth: "optional", body: b }),
    patch: (p, b, o={})    => request(p, { ...o, method: "PATCH",auth: "optional", body: b }),
    del:   (p, o={})       => request(p, { ...o, method: "DELETE", auth: "optional" }),
  },
};
