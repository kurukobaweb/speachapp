import api from "/js/api.js"; // あなたの環境に合わせて統一

(() => {
  const msg   = document.getElementById("msg");
  const errEl = document.getElementById("err");
  const retry = document.getElementById("retry");

  const setErr = (m) => { errEl.textContent = m || ""; };
  const planId = new URLSearchParams(location.search).get("plan") || "pro_monthly";

  async function start() {
    setErr("");
    retry.style.display = "none";

    const t = localStorage.getItem("authToken");
    if (!t) {
      location.href = "/login.html";
      return;
    }

    try {
      msg.textContent = "決済ページを準備しています…";

      const r = await api.post("/api/stripe/checkout-session", { plan_id: planId });
      if (!r?.url) throw new Error("決済URLが取得できませんでした");

      location.href = r.url;
    } catch (e) {
      setErr(e?.body?.error || e?.message || "決済ページへ移動できませんでした");
      msg.textContent = "エラーが発生しました。";
      retry.style.display = "block";
    }
  }

  retry.addEventListener("click", start);
  start();
})();
