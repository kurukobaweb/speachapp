// ① ここでだけ API_BASE を決める（他では定義しない）
window.API_BASE =
  window.API_BASE ||
  localStorage.getItem("API_BASE") ||                   // 一時的な手動切替に便利
  (location.hostname === "localhost"
    ? "http://localhost:8200"                           // 開発
    : "https://my-api-436216861937.asia-northeast1.run.app"); // 本番
