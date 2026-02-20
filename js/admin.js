// /js/admin.js — 完全版（カード + teacher安全制御 + レスポンス互換 + 例外耐性 + course_id表示/編集/作成対応）
import api from "./api.js";

(() => {
  "use strict";

  /* ===== 起動 ===== */
  let allUsers = [];

  document.addEventListener("DOMContentLoaded", () => {
    // api.js 側に requireToken がある想定。なければローカルで最低限チェック。
    if (typeof window.requireToken === "function") {
      window.requireToken();
    } else {
      const t = localStorage.getItem("authToken");
      if (!t) location.href = "/login.html";
    }

    initCreateInlineToggle();
    initCreateModal();
    loadUsers();
  });

  /* ===== JWT / 役割ユーティリティ（この1セットだけ） ===== */
  function parseJwtPayload() {
    const t = localStorage.getItem("authToken");
    if (!t) return {};
    try {
      // NOTE: 既存実装維持（base64url差がある環境では api.js 側で補完されている前提）
      return JSON.parse(atob(t.split(".")[1]));
    } catch {
      return {};
    }
  }
  function getActorRole() {
    return (parseJwtPayload().role || "user").toLowerCase();
  }
  function getActorAffiliation() {
    return parseJwtPayload().affiliation || "";
  }

  function safeUserId(u) {
    const cand = u?.id ?? u?.user_id ?? u?.uid ?? u?.docId ?? u?.doc_id ?? u?.docid ?? "";
    return String(cand || "").trim();
  }

  /* ===== レスポンス互換（ここが今回の本丸） ===== */
  function normalizeUsersResponse(data) {
    // 期待：
    //  - [ ... ]                        （配列直返し）
    //  - { users: [ ... ] }             （server.jsの実装）
    //  - { error: "...", ... }          （エラーJSON）
    //  - null/undefined                 （異常）
    if (Array.isArray(data)) return { users: data, meta: { shape: "array" } };
    if (data && Array.isArray(data.users)) return { users: data.users, meta: { shape: "object.users" } };

    // エラーらしき形
    if (data && typeof data === "object" && ("error" in data || "message" in data)) {
      return { users: [], meta: { shape: "error", error: data } };
    }

    return { users: [], meta: { shape: "unknown", raw: data } };
  }

  function setLoading(isLoading) {
    const loading = document.getElementById("adminLoading");
    if (loading) loading.style.display = isLoading ? "" : "none";
  }
  function setEmpty(isEmpty) {
    const empty = document.getElementById("adminEmpty");
    if (empty) empty.style.display = isEmpty ? "" : "none";
  }

  /* ===== フィルタUI ===== */
  function populateAffiliationFilter() {
    const sel = document.getElementById("filterAffiliation");
    if (!sel) return;
    sel.innerHTML = '<option value="all">すべて</option>';

    const list = Array.from(
      new Set((allUsers || []).map((u) => u.affiliation || "").filter(Boolean))
    ).sort();

    list.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a;
      sel.appendChild(opt);
    });
  }

  function bindAffiliationFilter() {
    const sel = document.getElementById("filterAffiliation");
    if (!sel) return;

    // 二重バインド防止
    if (sel.__bound) return;
    sel.__bound = true;

    sel.addEventListener("change", () => {
      const val = sel.value;
      const filtered = val === "all" ? allUsers : allUsers.filter((u) => u.affiliation === val);
      renderCards(filtered);
      setEmpty(!filtered.length);
    });
  }

  /* ===== course_id util ===== */
  const COURSE_OPTIONS_DEFAULT = ["free", "basic", "pro"]; // 必要ならここを増やす
  function normalizeCourseId(v) {
    const s = String(v ?? "").trim();
    return s || "free";
  }
  function courseOptionsFromUsers() {
    const set = new Set(COURSE_OPTIONS_DEFAULT.map((x) => String(x)));
    (allUsers || []).forEach((u) => {
      const c = normalizeCourseId(u.course_id ?? u.course ?? u.courseId);
      if (c) set.add(c);
    });
    return Array.from(set);
  }
  function courseSelectHtml(current) {
    const opts = courseOptionsFromUsers();
    const cur = normalizeCourseId(current);
    return opts
      .map((v) => `<option value="${escapeHtml(v)}" ${String(v) === String(cur) ? "selected" : ""}>${escapeHtml(v)}</option>`)
      .join("");
  }

  /* ===== 一覧取得 ===== */
  async function loadUsers() {
    setLoading(true);
    setEmpty(false);

    try {
      const data = await api.get("/api/admin/users");
      const norm = normalizeUsersResponse(data);
      const rows = norm.users;

      if (!Array.isArray(rows)) {
        console.error("[admin] invalid users response:", data);
        alert("ユーザー一覧の応答形式が不正です。NetworkのResponseを確認してください。");
        renderCards([]);
        setEmpty(true);
        return;
      }

      // 互換：サーバの列名が display_name / email_norm 等でも一応拾う
      allUsers = rows
        .map((u) => ({
          ...u,
          id: safeUserId(u),

          // UIで読む代表フィールドへ寄せ
          name: u.name ?? u.display_name ?? "",
          affiliation: u.affiliation ?? u.aff ?? "",
          email: u.email ?? u.email_norm ?? "",
          role: (u.role ?? "user").toLowerCase(),

          // ★ course_id 互換（course_id / course / courseId など）
          course_id: normalizeCourseId(u.course_id ?? u.course ?? u.courseId),
        }))
        .filter((u) => u.id !== ""); // ID無しは除外（更新/削除できないので）

      populateAffiliationFilter();
      bindAffiliationFilter();
      renderCards(allUsers);

      setEmpty(!allUsers.length);
    } catch (e) {
      console.error("[admin] loadUsers failed:", e);
      const msg =
        e?.message ||
        "読み込み中にエラーが発生しました。/api/admin/users の応答と Authorization を確認してください。";
      alert(msg);

      renderCards([]);
      setEmpty(true);
    } finally {
      setLoading(false);
    }
  }

  /* ===== カード描画 ===== */
  function renderCards(users) {
    const wrap = document.getElementById("adminCards");
    if (!wrap) return;

    wrap.innerHTML = "";

    (users || []).forEach((user) => {
      const u = user || {};
      const uid = safeUserId(u);
      const role = (u.role || "user").toLowerCase();
      const courseId = normalizeCourseId(u.course_id ?? u.course ?? u.courseId);
      const createdAt = u.created_at ? new Date(u.created_at).toLocaleString() : "-";

      const idMissing = !uid;

      const card = document.createElement("div");
      card.className = "user-card";
      card.innerHTML = `
        <div class="uc-head">
          <div class="uc-title">ユーザー</div>
          <div class="uc-id">${escapeHtml(uid || "（ID未取得）")}</div>
        </div>

        <div class="uc-grid">

          <div class="uc-row">
            <div class="uc-label">名前</div>
            <div class="uc-field">
              <input class="uc-name" data-id="${escapeHtml(uid)}" type="text" value="${escapeHtml(u.name || "")}">
            </div>
          </div>

          <div class="uc-row">
            <div class="uc-label">所属</div>
            <div class="uc-field">
              <input class="uc-aff" data-id="${escapeHtml(uid)}" type="text" value="${escapeHtml(u.affiliation || "")}">
            </div>
          </div>

          <div class="uc-row">
            <div class="uc-label">Email</div>
            <div class="uc-field">
              <input class="uc-email" data-id="${escapeHtml(uid)}" type="email" value="${escapeHtml(u.email || "")}">
            </div>
          </div>

          <div class="uc-row">
            <div class="uc-label">Role</div>
            <div class="uc-field">
              <select class="uc-role" data-id="${escapeHtml(uid)}">
                <option value="user"    ${role === "user" ? "selected" : ""}>user</option>
                <option value="teacher" ${role === "teacher" ? "selected" : ""}>teacher</option>
                <option value="admin"   ${role === "admin" ? "selected" : ""}>admin</option>
                <option value="owner"   ${role === "owner" ? "selected" : ""}>owner</option>
              </select>
            </div>
          </div>

          <!-- ★ course_id 表示/編集 -->
          <div class="uc-row">
            <div class="uc-label">Course</div>
            <div class="uc-field">
              <select class="uc-course" data-id="${escapeHtml(uid)}">
                ${courseSelectHtml(courseId)}
              </select>
            </div>
          </div>

          <div class="uc-row">
            <div class="uc-label">登録日</div>
            <div class="uc-meta">${escapeHtml(createdAt)}</div>
          </div>

          <div class="uc-row">
            <div class="uc-label">パスワード</div>
            <div class="uc-field">
              <div class="input-wrapper">
                <input class="uc-pass" id="pass-${escapeHtml(uid)}" data-id="${escapeHtml(uid)}" type="password" placeholder="新しいパスワード">
                <span class="toggle-eye" data-target="pass-${escapeHtml(uid)}"></span>
              </div>
            </div>
          </div>

          <div class="uc-row">
            <div class="uc-label">パスワード（確認）</div>
            <div class="uc-field">
              <div class="input-wrapper">
                <input class="uc-pass2" id="pass2-${escapeHtml(uid)}" data-id="${escapeHtml(uid)}" type="password" placeholder="確認用パスワード">
                <span class="toggle-eye" data-target="pass2-${escapeHtml(uid)}"></span>
              </div>
            </div>
          </div>

          <div class="uc-actions">
            <button class="btn-update" data-id="${escapeHtml(uid)}" ${idMissing ? 'disabled title="ID未取得のため更新不可"' : ""}>更新</button>
            <button class="btn-delete" data-id="${escapeHtml(uid)}" ${idMissing ? 'disabled title="ID未取得のため削除不可"' : ""}>削除</button>
          </div>
        </div>
      `;
      wrap.appendChild(card);
    });

    // 目アイコン（共通がなければローカルで対応）
    if (typeof window.initEyeToggle === "function") {
      window.initEyeToggle();
    } else {
      document.querySelectorAll(".toggle-eye").forEach((t) => {
        const id = t.getAttribute("data-target");
        t.addEventListener("click", () => {
          const input = document.getElementById(id);
          if (!input) return;
          input.type = input.type === "password" ? "text" : "password";
        });
      });
    }

    bindCardActions();
    applyRoleUiRules(); // このファイル内の関数を必ず適用
  }

  /* ===== 役割UIルール ===== */
  function applyRoleUiRules() {
    const actor = getActorRole(); // owner / admin / teacher / user

    document.querySelectorAll(".uc-role").forEach((sel) => {
      const uid = sel.getAttribute("data-id");
      const u = (allUsers || []).find((x) => x.id === uid) || {};
      const current = (u.role || "user").toLowerCase();

      if (actor === "teacher") {
        const allowed = ["user", "teacher"];
        if (allowed.includes(current)) {
          Array.from(sel.options).forEach((opt) => {
            if (!allowed.includes(opt.value)) opt.remove();
          });
          if (!allowed.includes(sel.value)) sel.value = "user";
          sel.disabled = false;
        } else {
          const badge = document.createElement("span");
          badge.className = "uc-role-badge";
          badge.textContent = current;
          sel.parentNode.replaceChild(badge, sel);
        }
      } else if (actor === "admin") {
        Array.from(sel.options).forEach((opt) => {
          if (opt.value === "owner") opt.remove();
        });
        if (sel.value === "owner") sel.value = "admin";
        sel.disabled = false;
      } else {
        sel.disabled = false;
      }
    });
  }

  /* ===== 更新/削除ハンドラ ===== */
  function bindCardActions() {
    document.querySelectorAll(".btn-update").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!id || id === "undefined" || btn.disabled) return;

        const name = qVal(`.uc-name[data-id="${cssEscape(id)}"]`);
        const aff = qVal(`.uc-aff[data-id="${cssEscape(id)}"]`);
        const email = qVal(`.uc-email[data-id="${cssEscape(id)}"]`);
        const pass = qVal(`.uc-pass[data-id="${cssEscape(id)}"]`);
        const pass2 = qVal(`.uc-pass2[data-id="${cssEscape(id)}"]`);

        const roleSel = document.querySelector(`.uc-role[data-id="${cssEscape(id)}"]`);
        const courseSel = document.querySelector(`.uc-course[data-id="${cssEscape(id)}"]`);

        if ((pass || pass2) && pass !== pass2) {
          alert("新しいパスワードと確認用が一致しません");
          return;
        }

        // サーバ側のカラム名に合わせた送信（server.js完全版に合わせる）
        const payload = {
          display_name: name,
          affiliation: aff,
          email,
        };
        if (roleSel) payload.role = roleSel.value;
        if (courseSel) payload.course_id = normalizeCourseId(courseSel.value);
        if (pass) payload.password = pass;

        try {
          await api.put(`/api/admin/users/${encodeURIComponent(id)}`, payload);
          alert("更新しました");

          // 画面側の allUsers も更新
          const target = allUsers.find((u) => u.id === id);
          if (target) {
            target.name = name;
            target.affiliation = aff;
            target.email = email;
            if (roleSel) target.role = roleSel.value;
            if (courseSel) target.course_id = normalizeCourseId(courseSel.value);
          }
        } catch (e) {
          console.error(e);
          alert("更新に失敗しました：" + (e?.message || ""));
        }
      });
    });

    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const id = btn.dataset.id;
        if (!id || id === "undefined") return;
        if (!confirm("本当に削除しますか？")) return;

        try {
          await api.del(`/api/admin/users/${encodeURIComponent(id)}`);
          btn.closest(".user-card")?.remove();
          allUsers = allUsers.filter((u) => u.id !== id);
          setEmpty(!document.querySelector(".user-card"));
          populateAffiliationFilter();
        } catch (e) {
          alert(e?.message || "削除に失敗しました");
        }
      });
    });
  }

  /* =====（任意）新規作成モーダル ===== */
  function initCreateModal() {
    const modal = document.getElementById("createModal");
    const btnOpen = document.getElementById("openCreateModal");
    const btnSubmit = document.getElementById("createSubmit");
    const roleSel = document.getElementById("createRole");
    const courseSel = document.getElementById("createCourse");
    const affEl = document.getElementById("createAff");

    if (!modal || !btnOpen || !btnSubmit || !roleSel) return;

    if (getActorRole() === "teacher") {
      Array.from(roleSel.options).forEach((opt) => {
        if (!["user", "teacher"].includes(opt.value)) opt.remove();
      });
      if (affEl) {
        affEl.value = getActorAffiliation();
        affEl.readOnly = true;
      }
    }

    // courseの選択肢をJS側で補完（admin.htmlが未整備でも壊れない）
    if (courseSel && !courseSel.__filled) {
      const opts = courseOptionsFromUsers();
      if (courseSel.options.length <= 1) {
        courseSel.innerHTML = opts.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
      }
      courseSel.value = courseSel.value || "free";
      courseSel.__filled = true;
    }

    btnOpen.addEventListener("click", () => {
      modal.style.display = "block";
      setTimeout(() => modal.classList.add("is-open"), 0);
    });

    modal.addEventListener("click", (e) => {
      if (e.target.dataset.close === "1" || e.target.classList.contains("modal")) closeCreateModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCreateModal();
    });

    btnSubmit.addEventListener("click", onCreateSubmit);
  }

  function closeCreateModal() {
    const modal = document.getElementById("createModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    setTimeout(() => {
      modal.style.display = "none";
    }, 150);
  }

  async function onCreateSubmit() {
    const name = (document.getElementById("createName")?.value || "").trim();
    const aff = (document.getElementById("createAff")?.value || "").trim();
    const email = (document.getElementById("createEmail")?.value || "").trim();
    const role = (document.getElementById("createRole")?.value || "user").toLowerCase();
    const course = normalizeCourseId(document.getElementById("createCourse")?.value || "free");
    const pass = document.getElementById("createPass")?.value || "";
    const pass2 = document.getElementById("createPass2")?.value || "";

    if (!name || !aff || !email || !pass) {
      alert("名前・所属・Email・パスワードは必須です");
      return;
    }
    if (pass !== pass2) {
      alert("パスワードが一致しません");
      return;
    }

    try {
      await api.post("/api/admin/users", {
        display_name: name,
        affiliation: aff,
        email,
        role,
        course_id: course, // ★追加
        password: pass,
      });
      alert("ユーザーを作成しました");
      closeCreateModal();

      if (document.getElementById("createName")) document.getElementById("createName").value = "";
      if (document.getElementById("createEmail")) document.getElementById("createEmail").value = "";
      if (document.getElementById("createPass")) document.getElementById("createPass").value = "";
      if (document.getElementById("createPass2")) document.getElementById("createPass2").value = "";
      if (document.getElementById("createCourse")) document.getElementById("createCourse").value = "free";
      if (getActorRole() !== "teacher" && document.getElementById("createAff")) document.getElementById("createAff").value = "";

      loadUsers();
    } catch (e) {
      alert(e?.message || "作成に失敗しました");
    }
  }

  // 新規追加（インライン）開閉 & 初期セット
  function initCreateInlineToggle() {
    const openBtn = document.getElementById("openCreateInline");
    const panel = document.getElementById("createInlineSection");
    const closeBtn = document.getElementById("closeCreateInline");
    const roleSel = document.getElementById("createRole");
    const courseSel = document.getElementById("createCourse");
    const affEl = document.getElementById("createAff");

    if (!openBtn || !panel) return;

    openBtn.addEventListener("click", () => {
      panel.style.display = "";
      panel.classList.add("is-open");

      // teacher は所属固定
      if (getActorRole() === "teacher" && affEl) {
        affEl.value = getActorAffiliation();
        affEl.readOnly = true;
      }

      // courseの選択肢補完（未整備でも壊れない）
      if (courseSel && !courseSel.__filled) {
        const opts = courseOptionsFromUsers();
        if (courseSel.options.length <= 1) {
          courseSel.innerHTML = opts.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
        }
        courseSel.value = courseSel.value || "free";
        courseSel.__filled = true;
      }

      // 役割選択の制限（外部関数がある場合は利用）
      if (typeof window.restrictRoleOptionsForActor === "function" && roleSel) {
        window.restrictRoleOptionsForActor(roleSel);
        if (!Array.from(roleSel.options).some((o) => o.value === roleSel.value)) {
          roleSel.value = roleSel.options[0]?.value || "user";
        }
      } else if (getActorRole() === "teacher" && roleSel) {
        Array.from(roleSel.options).forEach((opt) => {
          if (!["user", "teacher"].includes(opt.value)) opt.remove();
        });
        if (!["user", "teacher"].includes(roleSel.value)) roleSel.value = "user";
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        panel.classList.remove("is-open");
        panel.style.display = "none";
      });
    }
  }

  /* ===== util ===== */
  function qVal(sel) {
    const el = document.querySelector(sel);
    return el ? el.value : "";
  }

  function escapeHtml(s = "") {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // data-id に特殊文字が来ても querySelector が壊れないよう最低限エスケープ
  function cssEscape(v) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(v));
    return String(v).replace(/["\\]/g, "\\$&");
  }
})();
