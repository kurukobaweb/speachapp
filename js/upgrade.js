// /js/upgrade.js
import api from "/js/api.js";

(() => {
  const err = document.getElementById("err");
  const who = document.getElementById("who");
  const back = document.getElementById("backProfile");

  const setErr = (m) => err && (err.textContent = m || "");

  async function requireLogin() {
    const t = localStorage.getItem("authToken");
    if (!t) {
      location.href = "/login.html";
      return null;
    }
    const me = await api.get("/api/me");
    return me?.user || null;
  }

  async function main() {
    setErr("");

    /* ✅ ① 先に必ず登録する */
    back?.addEventListener("click", () => {
      location.href = "html/profile.html";
    });

    let user;
    try {
      user = await requireLogin();
      if (!user) return;

      who.textContent = `ログイン中：${user.email}`;

      /* ⚠️ ここで return しても、戻るは動く */
      if (
        user.plan_status === "active" ||
        user.role === "admin" ||
        user.role === "owner"
      ) {
        setErr("すでに有料状態です。");
        return;
      }
    } catch (e) {
      setErr(e?.body?.error || e?.message || "ログイン状態を確認できませんでした");
      return;
    }

    document.querySelectorAll(".plan").forEach(btn => {
      btn.addEventListener("click", async () => {
        setErr("");
        btn.disabled = true;
        try {
          const plan_id = btn.dataset.plan;
          const r = await api.post("/api/stripe/checkout-session", { plan_id });
          if (!r?.url) throw new Error("Checkout URL が取得できませんでした");
          location.href = r.url;
        } catch (e) {
          setErr(e?.body?.error || e?.message || "決済ページを開けませんでした");
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  main();
})();
