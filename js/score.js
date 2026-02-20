import { api } from '../js/api.js';

/* score.js — スコア一覧（ES5安全・共通api利用版 / user漏洩防止ガード強化 + admin切替） */
(function () {
  "use strict";

  /* ===== 設定 ===== */
  var SCORES_ENDPOINT = "/api/scores";
  var THEMES_ENDPOINT = "/api/themes";
  var THEME_OPTIONS_ENDPOINT = "/api/theme-options";
  var PAGE_SIZE = 4;

  /**
   * ★追加：admin/owner の表示範囲切替
   * false（デフォルト）: admin/owner でも本人のみ表示
   * true              : admin/owner は全員分表示
   */
  var SHOW_ALL_SCORES = false;

  /* ===== ログイン必須 ===== */
  function requireToken() {
    var t = localStorage.getItem("authToken");
    if (!t) location.href = "../login.html";
    return t;
  }

  /* ===== コース制限 ===== */
  var ALL_LEVELS = ["初級", "中級", "上級", "超級", "面接対応", "10秒スピーチチャレンジ", "小中学生のための60秒スピーチ", "大学生のための就活面接40秒スピーチ"];
  var ALL_TYPES  = ["二択", "単体", "なし",
    "自分のこと", "学校生活・友だち", "家族・家のこと", "趣味・好きなもの", "社会・世界・地域", "夢・将来", "心・考え・生き方", "チャレンジ・希望",
    "基本情報・自己紹介", "学業・研究内容", "経験・エピソード", "価値観・考え方", "将来・キャリアビジョン", "時事・一般常識・その他"
  ];
  var FREE_LEVELS = ["初級", "中級", "上級", "超級"];
  var FREE_TYPES  = ["二択"];
  var allowedLevels = ALL_LEVELS.slice(0);
  var allowedTypes  = ALL_TYPES.slice(0);

  function safeAtobUrl(b64url) {
    var b = String(b64url || "");
    var pad = new Array((4 - (b.length % 4)) % 4 + 1).join("=");
    b = (b + pad).replace(/-/g, "+").replace(/_/g, "/");
    try { return atob(b); } catch (e) { return ""; }
  }

  function decodeJwtPayload(token) {
    try {
      var parts = String(token || "").split(".");
      if (parts.length < 2) return null;
      var json = safeAtobUrl(parts[1]);
      if (!json) return null;

      // UTF-8対応（ES5）
      var str = "";
      try { str = decodeURIComponent(escape(json)); } catch (e2) { str = json; }
      var p = JSON.parse(str);
      return (p && typeof p === "object") ? p : null;
    } catch (e) {
      return null;
    }
  }

  function detectRoleCourseAndUserId() {
    // 1) JWT
    try {
      var t = localStorage.getItem("authToken") || "";
      var p = decodeJwtPayload(t);
      if (p) {
        var role = p.role || "user";
        var course = String(p.course_id || "free").toLowerCase();
        // ★ userId は sub を正として扱う（移行期の揺れを吸収）
        var uid = String(p.sub || p.uid || p.userId || p.id || "");
        return { role: role, course: course, userId: uid };
      }
    } catch (e) {}

    // 2) localStorage.userProfile（保険）
    try {
      var u = JSON.parse(localStorage.getItem("userProfile") || "{}");
      if (u && (u.role || u.course_id || u.course || u.doc_id || u.user_id || u.id)) {
        return {
          role: (u.role || "user"),
          course: String(u.course_id || u.course || "").toLowerCase(),
          userId: String(u.doc_id || u.user_id || u.id || "")
        };
      }
    } catch (e2) {}

    return { role: "user", course: "free", userId: "" };
  }

  function loadAllowedOptions() {
    return api.get(THEME_OPTIONS_ENDPOINT, { cache: "no-cache" })
      .then(function (js) {
        allowedLevels = Array.isArray(js.levels) ? js.levels.slice(0) : ALL_LEVELS.slice(0);
        allowedTypes  = Array.isArray(js.types)  ? js.types.slice(0)  : ALL_TYPES.slice(0);
      })
      .catch(function () {
        var rc = detectRoleCourseAndUserId();
        if (rc.role === "admin" || rc.role === "owner" || rc.course !== "free") {
          allowedLevels = ALL_LEVELS.slice(0);
          allowedTypes  = ALL_TYPES.slice(0);
        } else {
          allowedLevels = FREE_LEVELS.slice(0);
          allowedTypes  = FREE_TYPES.slice(0);
        }
      });
  }

  /* ===== レベル⇄タイプ 連動ルール ===== */
  var LEVEL_GROUP_MAIN = ["初級", "中級", "上級", "超級", "面接対応"];
  var LEVEL_10S = "10秒スピーチチャレンジ";
  var LEVEL_60S = "小中学生のための60秒スピーチ";
  var LEVEL_40S = "大学生のための就活面接40秒スピーチ";

  var TYPE_TWO = "二択";
  var TYPE_SINGLE = "単体";
  var TYPE_NONE = "なし";

  var TYPES_60S = ["自分のこと", "学校生活・友だち", "家族・家のこと", "趣味・好きなもの", "社会・世界・地域", "夢・将来", "心・考え・生き方", "チャレンジ・希望"];
  var TYPES_40S = ["基本情報・自己紹介", "学業・研究内容", "経験・エピソード", "価値観・考え方", "将来・キャリアビジョン", "時事・一般常識・その他"];

  function norm(v){ return String(v == null ? "" : v).trim(); }
  function includes(arr, v){
    var i; for (i=0;i<(arr?arr.length:0);i++) if (arr[i] === v) return true;
    return false;
  }
  function allowedTypesForLevel(level){
    var lv = norm(level);
    if (!lv) return null;
    if (includes(LEVEL_GROUP_MAIN, lv)) return [TYPE_TWO, TYPE_SINGLE];
    if (lv === LEVEL_10S) return [TYPE_NONE];
    if (lv === LEVEL_60S) return TYPES_60S.slice(0);
    if (lv === LEVEL_40S) return TYPES_40S.slice(0);
    return null;
  }
  function allowedLevelsForType(type){
    var tp = norm(type);
    if (!tp) return null;
    if (tp === TYPE_TWO || tp === TYPE_SINGLE) return LEVEL_GROUP_MAIN.slice(0);
    if (tp === TYPE_NONE) return [LEVEL_10S];
    if (includes(TYPES_60S, tp)) return [LEVEL_60S];
    if (includes(TYPES_40S, tp)) return [LEVEL_40S];
    return null;
  }

  function bindLevelTypeFilter(levelSel, typeSel){
    if (!levelSel || !typeSel) return;

    function enableAllTypes(){
      var i; for (i=0;i<typeSel.options.length;i++){
        typeSel.options[i].disabled = false;
      }
    }

    function disableTypesByLevel(){
      var lv = norm(levelSel.value);
      if (lv === "") { enableAllTypes(); return; }

      var allowed = allowedTypesForLevel(lv);
      if (!allowed) { enableAllTypes(); return; }

      var i;
      for (i=0;i<typeSel.options.length;i++){
        var opt = typeSel.options[i];
        var v = norm(opt.value);
        if (v === "") { opt.disabled = false; continue; }
        opt.disabled = !includes(allowed, v);
      }

      if (typeSel.selectedOptions && typeSel.selectedOptions[0] && typeSel.selectedOptions[0].disabled) {
        for (i=0;i<typeSel.options.length;i++){
          if (!typeSel.options[i].disabled) { typeSel.value = typeSel.options[i].value; break; }
        }
      }
    }

    function adjustLevelByType(){
      var tp = norm(typeSel.value);
      if (tp === "") return;
      if (norm(levelSel.value) === "") return;

      var allowedLv = allowedLevelsForType(tp);
      if (!allowedLv || !allowedLv.length) return;

      if (!includes(allowedLv, norm(levelSel.value))) {
        levelSel.value = allowedLv[0];
      }
    }

    disableTypesByLevel();
    adjustLevelByType();
    disableTypesByLevel();

    levelSel.addEventListener("change", function(){ disableTypesByLevel(); });
    typeSel.addEventListener("change", function(){ adjustLevelByType(); disableTypesByLevel(); });
  }

  /* ===== ステート ===== */
  var allScores = [];
  var allThemes = [];
  var viewScores = [];
  var page = 1;
  var $tbody, $overlay;
  var scrollYBeforeModal = 0;
  var currentDetail = null;

  /* ===== 起動 ===== */
  document.addEventListener("DOMContentLoaded", function () {
    requireToken();

    // ★ ここで currentUserId / currentRole を確定させておく（表示漏れ防止に使う）
    var rc = detectRoleCourseAndUserId();
    window.currentUserId = rc.userId || "";
    window.currentRole = rc.role || "user";

    $tbody   = document.getElementById("scoreTbody");
    $overlay = document.getElementById("detailOverlay");
    if ($overlay) $overlay.hidden = true;
    if (!$tbody) return;

    bindUI();

    loadAllowedOptions()
      .then(loadData)
      .then(afterLoadOk)
      .catch(function (e) {
        console.error("データ取得エラー:", e);
        // 失敗してもUIだけは崩さない
        afterLoadOk();
      });
  });

  function afterLoadOk(){
    ensureFilterOptions("filterLevel", allowedLevels, "全てのLV");
    ensureFilterOptions("filterType",  allowedTypes,  "全てのタイプ");
    bindLevelTypeFilter(byId("filterLevel"), byId("filterType"));

    applyFilters();
    renderKPIs();
    renderAchievement();
    renderLatest();
    renderTable();
    renderPager();
  }

  /* ===== データ ===== */
  function loadData() {
    // ★毎回初期化（キャッシュ混入防止）
    allScores = [];
    allThemes = [];
    viewScores = [];
    page = 1;

    return Promise.all([api.get(SCORES_ENDPOINT, { cache: "no-cache" }), api.get(THEMES_ENDPOINT, { cache: "no-cache" })])
      .then(function (arr) {
        var scoresRaw =
          (arr[0] && (arr[0].items || arr[0].all || arr[0].scores)) ? (arr[0].items || arr[0].all || arr[0].scores)
          : arr[0];

        var themesRaw =
          (arr[1] && (arr[1].all || arr[1].themes || arr[1].items)) ? (arr[1].all || arr[1].themes || arr[1].items)
          : arr[1];

        allThemes = normalizeThemes(asArray(themesRaw));
        var idx = indexThemes(allThemes);

        // ★ user_id を含めて正規化
        var tmpScores = normalizeScores(asArray(scoresRaw));

        // ★ 最重要：表示範囲を確定（userは強制本人のみ / adminはフラグで切替）
        var role = String(window.currentRole || "user").toLowerCase();
        var myId = String(window.currentUserId || "");

        // サーバが user_id を返さない場合でも漏れないよう補完
        tmpScores = tmpScores.map(function(s){
          if (s.user_id == null || String(s.user_id) === "") s.user_id = myId;
          return s;
        });

        if (role === "admin" || role === "owner") {
          if (SHOW_ALL_SCORES !== true) {
            // ★admin/ownerでもデフォルトは本人のみ
            tmpScores = tmpScores.filter(function(s){ return String(s.user_id) === myId; });
          }
        } else {
          // ★user等は強制で本人のみ
          tmpScores = tmpScores.filter(function(s){ return String(s.user_id) === myId; });
        }

        allScores = tmpScores.map(function (s) { return mergeScoreWithTheme(s, idx); });
      });
  }

  function asArray(x){ return Array.isArray(x) ? x : (x ? [x] : []); }

  function normalizeThemes(rows){
    return rows.map(function (t,i){ return {
      display_id: (t && (t.display_id || t.displayId)) || "",
      theme_id:   (t && (t.theme_key || t.theme_id || t.id)) || ("theme_"+i),
      level:      (t && t.level) || "",
      no:         (t && (t.no || t.sub)) || "",
      type:       (t && t.type) || "",
      title:      (t && (t.title || t.question || t.prompt)) || ""
    };});
  }

  function indexThemes(themes){
    var byDisplayId = new Map(), byThemeId = new Map(), byKey = new Map();
    themes.forEach(function (t){
      if (t.display_id) byDisplayId.set(String(t.display_id), t);
      if (t.theme_id)   byThemeId.set(String(t.theme_id), t);
      byKey.set([t.level||"", String(t.no||""), t.type||""].join("|"), t);
    });
    return { byDisplayId: byDisplayId, byThemeId: byThemeId, byKey: byKey };
  }

  function normalizeScores(rows){
    return rows.map(function (r,i){ return {
      // ★ 重要：user_id を取り込む（DBは user_id カラム）
      user_id:       (r && (r.user_id || r.userId || r.uid || r.sub)) || "",

      // id（レコード識別子）
      id:            String((r && (r.doc_id || r.id || r._id)) || ("rec_"+Date.now()+"_"+i)),

      // 日時
      at:            (r && (r.taken_at || r.evaluated_at || r.at || r.created_at || r.updated_at)) || new Date().toISOString(),

      // テーマ紐づけ
      level:         (r && r.level) || "",
      type:          (r && r.type)  || "",
      no:            (r && (r.no || r.sub)) || "",
      display_id:    (r && (r.display_id || r.displayId)) || "",
      theme_id:      (r && (r.theme_id || r.themeId)) || "",

      // 表示
      title:         (r && (r.title || r.prompt)) || "",
      score:         (r && isFinite(r.score)) ? r.score : ((r && r.totalScore) || 0),

      durationSec: (r && (isFinite(r.durationSec) ? r.durationSec
           : (isFinite(r.duration_sec) ? r.duration_sec
           : (isFinite(r.duration_s)   ? r.duration_s
           : r.duration)))) || 0,

      is_pass:       (r && (r.is_pass != null ? r.is_pass : r.pass)) || 0,

      memo:          (r && r.memo) || "",
      transcriptRaw:  (r && (r.transcriptRaw  || r.transcript_raw  || r.transcript)) || "",
      transcriptKana: (r && (r.transcriptKana || r.transcript_hira)) || ""
    };});
  }

  function mergeScoreWithTheme(s, idx){
    if (s.display_id && idx.byDisplayId.has(String(s.display_id))) {
      return attachThemeFields(s, idx.byDisplayId.get(String(s.display_id)));
    }
    if (s.theme_id && idx.byThemeId.has(String(s.theme_id))) {
      return attachThemeFields(s, idx.byThemeId.get(String(s.theme_id)));
    }
    var key = [s.level||"", String(s.no||""), s.type||""].join("|");
    if (idx.byKey.has(key)) {
      return attachThemeFields(s, idx.byKey.get(key));
    }
    return s;
  }

  function attachThemeFields(s, t){
    return {
      user_id:     s.user_id || "",
      display_id:  s.display_id || t.display_id || "",
      theme_id:    s.theme_id   || t.theme_id   || "",
      level:       s.level      || t.level      || "",
      type:        s.type       || t.type       || "",
      no:          s.no         || t.no         || "",
      title:       s.title      || t.title      || "",
      id:          s.id,
      at:          s.at,
      score:       s.score,
      durationSec: s.durationSec,
      is_pass:     s.is_pass,
      memo:        s.memo,
      transcriptRaw:  s.transcriptRaw,
      transcriptKana: s.transcriptKana
    };
  }

  /* ===== フィルタ・描画 ===== */
  function bindUI(){
    var el;
    el = byId("filterLevel"); if (el) el.addEventListener("change", onFilterChange);
    el = byId("filterType");  if (el) el.addEventListener("change", onFilterChange);
    el = byId("filterOrder"); if (el) el.addEventListener("change", onFilterChange);
    el = byId("btnSearch");   if (el) el.addEventListener("click", onFilterChange);
    el = byId("keyword");     if (el) el.addEventListener("keydown", function(e){ if (e.key === "Enter") onFilterChange(); });
    el = byId("btnReset");    if (el) el.addEventListener("click", function(){
      var lv = byId("filterLevel"), tp = byId("filterType"), od = byId("filterOrder"), kw = byId("keyword");
      if (lv) lv.value = ""; if (tp) tp.value = ""; if (od) od.value = "desc"; if (kw) kw.value = "";
      onFilterChange();
    });

    el = byId("prevPage"); if (el) el.addEventListener("click", function(){ if(page>1){ page--; renderTable(); renderPager(); }});
    el = byId("nextPage"); if (el) el.addEventListener("click", function(){
      var max = Math.max(1, Math.ceil(viewScores.length / PAGE_SIZE));
      if(page<max){ page++; renderTable(); renderPager(); }
    });

    el = byId("detailClose"); if (el) el.addEventListener("click", closeDetail);
    if ($overlay) $overlay.addEventListener("click", function (e) { if (e.target === $overlay) closeDetail(); });

    var ex = byId("btnExportJson"); if (ex) ex.addEventListener("click", exportJson);
    var del= byId("btnDelete");     if (del) del.addEventListener("click", deleteRecord);

    var openLatest = byId("btnOpenLatest");
    if (openLatest) openLatest.addEventListener("click", function(){
      if(viewScores.length) openDetail(viewScores[0]);
    });
  }

  function onFilterChange(){
    page = 1;
    applyFilters();
    renderKPIs();
    renderAchievement();
    renderLatest();
    renderTable();
    renderPager();
  }

  function applyFilters(){
    var lvSel   = (byId("filterLevel") && byId("filterLevel").value || "").trim();
    var typeSel = (byId("filterType")  && byId("filterType").value  || "").trim();
    var order   = (byId("filterOrder") && byId("filterOrder").value || "desc").trim();
    var kwEl = byId("keyword");
    var kw = (kwEl && kwEl.value || "").trim().toLowerCase();

    var rows = allScores.slice();

    if (lvSel)   rows = rows.filter(function(r){ return String(r.level||"").trim() === lvSel; });
    if (typeSel) rows = rows.filter(function(r){ return String(r.type ||"").trim()  === typeSel; });

    if (kw) {
      rows = rows.filter(function(r){
        var text = (stripRuby(r.title || "") + " " + (r.memo || "") + " " + (r.display_id || "")).toLowerCase();
        return text.indexOf((kw)) >= 0;
      });
    }

    if (order === "asc") {
      rows.sort(function(a,b){ return toDate(a.at) - toDate(b.at); });
    } else if (order === "score_desc") {
      rows.sort(function(a,b){ return (Number(b.score)||0) - (Number(a.score)||0); });
    } else if (order === "score_asc") {
      rows.sort(function(a,b){ return (Number(a.score)||0) - (Number(b.score)||0); });
    } else {
      rows.sort(function(a,b){ return toDate(b.at) - toDate(a.at); });
    }
    viewScores = rows;
  }

  function renderKPIs(){
    var count = viewScores.length;
    if (!count) {
      setText("kpiCount", "0");
      setText("kpiAvg", "--");
      return;
    }
    var sum = 0;
    for (var i=0;i<viewScores.length;i++) sum += Number(viewScores[i].score)||0;
    var avg = Math.round(sum / count);
    setText("kpiCount", String(count));
    setText("kpiAvg", String(avg));
  }

  function renderAchievement(){
    var doneEl = byId("achDone");
    var totalEl= byId("achTotal");
    if (!doneEl || !totalEl) return;

    var lvSel   = (byId("filterLevel") && byId("filterLevel").value || "").trim();
    var typeSel = (byId("filterType")  && byId("filterType").value  || "").trim();

    var total = 0;
    for (var i=0;i<allThemes.length;i++){
      var t = allThemes[i];
      var lv = String(t.level||"").trim();
      var tp = String(t.type ||"").trim();
      if (indexOf(allowedLevels, lv) < 0) continue;
      if (indexOf(allowedTypes, tp)  < 0) continue;
      if (lvSel && lv !== lvSel) continue;
      if (typeSel && tp !== typeSel) continue;
      total++;
    }

    var passedMap = {};
    for (var j=0;j<allScores.length;j++){
      var r = allScores[j];
      var lv2 = String(r.level||"").trim();
      var tp2 = String(r.type ||"").trim();
      if (indexOf(allowedLevels, lv2) < 0) continue;
      if (indexOf(allowedTypes, tp2)  < 0) continue;
      if (lvSel && lv2 !== lvSel) continue;
      if (typeSel && tp2 !== typeSel) continue;

      var pass = (r.is_pass === 1 || r.is_pass === "1" || r.is_pass === true);
      if (pass) {
        var key = String(r.display_id || r.theme_id || [r.level||"", String(r.no||""), r.type||""].join("|"));
        passedMap[key] = 1;
      }
    }
    var done = 0; for (var k in passedMap) if (passedMap.hasOwnProperty(k)) done++;
    var rate = total ? Math.max(0, Math.min(100, Math.round(done*100/total))) : 0;

    doneEl.textContent  = String(done);
    totalEl.textContent = String(total);

    var fg = document.querySelector("#achGauge .gauge-fg");
    var tx = document.querySelector("#achGauge .gauge-text");
    var C  = 2 * Math.PI * 52;
    if (fg) fg.setAttribute("stroke-dasharray", String((C*rate)/100) + " " + String(C));
    if (tx) tx.textContent = rate + "%";
  }

  function renderLatest(){
    var card = byId("latestCard");
    if (!card) return;
    if (!viewScores.length){ card.hidden = true; return; }
    card.hidden = false;

    var r = viewScores[0];
    setText("latestLevel", r.level || "—");
    setText("latestType",  r.type  || "—");
    setText("latestAt",    formatDateTime(r.at));

    var el = byId("latestTitle");
    if (el){ el.classList.add("title-ellipsis"); el.innerHTML = r.title || "—"; el.title = (el.textContent || ""); }

    var rate = Math.max(0, Math.min(100, Number(r.score)||0));
    var C  = 2 * Math.PI * 52;
    var fg = document.querySelector(".gauge .gauge-fg");
    var tx = document.querySelector(".gauge .gauge-text");
    if (fg) fg.setAttribute("stroke-dasharray", String((C*rate)/100) + " " + String(C));
    if (tx) tx.textContent = rate + "%";

    var link = byId("latestLink");
    if (link) link.href = "score-detail.html?id=" + encodeURIComponent(r.id);
  }

  function renderTable(){
    var tbody = $tbody;
    var mob   = byId("scoreListMobile");
    tbody.innerHTML = "";
    if (mob) mob.innerHTML = "";

    var start = (page-1)*PAGE_SIZE;
    var rows  = viewScores.slice(start, start+PAGE_SIZE);

    if(!rows.length){
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 8;
      td.textContent = "データがありません。";
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (mob) mob.innerHTML = '<div class="muted">データがありません。</div>';

      // 最新カードも隠す（未挑戦で他人が見える誤解を防止）
      var card = byId("latestCard");
      if (card) card.hidden = true;
      return;
    }

    rows.forEach(function (r){
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td>'+esc(formatDateOnly(r.at))+'</td>'+
        '<td>'+esc(r.level||"")+'</td>'+
        '<td>'+esc(String(r.no||""))+'</td>'+
        '<td>'+esc(r.type||"")+'</td>'+
        '<td><span class="table-title-ellipsis" title="'+esc(stripRuby(r.title||""))+'">'+(r.title||"—")+'</span></td>'+
        '<td class="score">'+esc(String(r.score))+'</td>'+
        '<td>'+esc(formatDuration(r.durationSec))+'</td>'+
        '<td><button class="btn-outline btn-sm" data-id="'+r.id+'">詳細</button></td>';
      tr.querySelector("button").addEventListener("click", function(){ openDetail(r); });
      tbody.appendChild(tr);

      if (mob){
        var card = document.createElement("div");
        card.className = "score-card";
        card.innerHTML =
          '<div class="meta">'+
            '<div class="date">'+esc(formatDateOnly(r.at))+'</div>'+
            '<span>'+esc(r.level||"—")+'</span>'+
            '<span>'+esc(String(r.no||"—"))+'</span>'+
            '<span>'+esc(r.type||"—")+'</span>'+
          '</div>'+
          '<div class="title">'+
            '<span class="table-title-ellipsis" title="'+esc(stripRuby(r.title||""))+'">'+(r.title||"—")+'</span>'+
          '</div>'+
          '<div class="meta_score">'+
            '<div class="score">スコア : '+esc(String(r.score))+'</div>'+
            '<div class="time">タイム : '+esc(formatDuration(r.durationSec))+'</div>'+
            '<div class="action"><button class="btn-outline btn-sm">詳細</button></div>'+
          '</div>';
        card.querySelector("button").addEventListener("click", function(){ openDetail(r); });
        mob.appendChild(card);
      }
    });
  }

  function renderPager(){
    var max = Math.max(1, Math.ceil(viewScores.length / PAGE_SIZE));
    setText("pageInfo", page + " / " + max);
    var prev = byId("prevPage"), next = byId("nextPage");
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= max;
  }

  /* ===== 詳細モーダル ===== */
  function openDetail(rec){
    currentDetail = rec;
    setText("dAt", formatDateTime(rec.at));
    setText("dLevel", rec.level || "—");
    setText("dType", rec.type || "—");
    setText("dNo", String(rec.no||""));
    setText("dDisplayId", rec.display_id || "—");
    setText("dScore", String(rec.score));
    setText("dDuration", formatDuration(rec.durationSec));
    var t = byId("dTitle"); if (t){ t.innerHTML = rec.title || "—"; t.title = t.textContent || ""; }
    setText("dMemo", rec.memo || "—");
    var rr = byId("dTranscriptRaw");  if (rr) rr.textContent  = rec.transcriptRaw  || "";
    var rk = byId("dTranscriptKana"); if (rk) rk.textContent = rec.transcriptKana || "";

    if ($overlay){
      $overlay.hidden = false;
      scrollYBeforeModal = window.scrollY || document.documentElement.scrollTop || 0;
      document.body.style.top = "-" + scrollYBeforeModal + "px";
      document.body.classList.add("modal-open");
    }
  }

  function closeDetail(){
    if ($overlay){
      $overlay.hidden = true;
      document.body.classList.remove("modal-open");
      window.scrollTo(0, scrollYBeforeModal || 0);
      document.body.style.top = "";
    }
    currentDetail = null;
  }

  function exportJson(){
    if(!currentDetail) return;
    try{
      var blob = new Blob([JSON.stringify(currentDetail, null, 2)], {type:"application/json"});
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = String(currentDetail.id || "score") + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    }catch(e){}
  }

  function deleteRecord(){
    if(!currentDetail) return;
    if(!confirm("この記録を削除します。よろしいですか？")) return;

    api.del(SCORES_ENDPOINT + "/" + encodeURIComponent(currentDetail.id))
      .catch(function(){})
      .then(function(){
        var next = [];
        for (var i=0;i<allScores.length;i++){
          if (allScores[i].id !== currentDetail.id) next.push(allScores[i]);
        }
        allScores = next;
        applyFilters(); renderKPIs(); renderAchievement(); renderLatest(); renderTable(); renderPager();
        closeDetail();
      });
  }

  /* ===== ユーティリティ ===== */
  function byId(id){ return document.getElementById(id); }
  function setText(id, text){ var el = byId(id); if (el) el.textContent = String(text == null ? "" : text); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m];}); }
  function indexOf(arr, v){
    if (!arr) return -1;
    for (var i=0;i<arr.length;i++) if (arr[i] === v) return i;
    return -1;
  }

  function toDate(x){
    if (x == null) return new Date(NaN);
    if (x instanceof Date) return x;
    if (typeof x === "number") return new Date(x > 1e12 ? x : x * 1000);
    if (typeof x === "string") {
      var s = x.trim();
      if (/^\d+$/.test(s)) { var n = Number(s); return new Date(n > 1e12 ? n : n * 1000); }
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) s = s.replace(" ", "T") + "Z";
      return new Date(s);
    }
    if (x && typeof x === "object") {
      try { if (typeof x.toDate === "function") return x.toDate(); } catch(e){}
      if (typeof x.seconds === "number")  return new Date(x.seconds  * 1000);
      if (typeof x._seconds === "number") return new Date(x._seconds * 1000);
    }
    try { var d = new Date(x); return isNaN(d.getTime()) ? new Date(NaN) : d; } catch(e){ return new Date(NaN); }
  }

  function formatDateTime(x){
    var d = toDate(x);
    if (isNaN(d.getTime())) return "--";
    var y  = d.getFullYear();
    var mo = ("0"+(d.getMonth()+1)).slice(-2);
    var da = ("0"+d.getDate()).slice(-2);
    var hh = ("0"+d.getHours()).slice(-2);
    var mm = ("0"+d.getMinutes()).slice(-2);
    return y + "/" + mo + "/" + da + " " + hh + ":" + mm;
  }
  function formatDateOnly(x){
    var d = toDate(x); if (isNaN(d.getTime())) return "--";
    var y=d.getFullYear(), mo=("0"+(d.getMonth()+1)).slice(-2), da=("0"+d.getDate()).slice(-2);
    return y+"/"+mo+"/"+da;
  }
  function formatDuration(sec){
    var n = Math.max(0, Number(sec)||0);
    var m = Math.floor(n/60), s = n%60;
    return m + ":" + ("0"+s).slice(-2);
  }
  function stripRuby(html){
    var s = String(html || "");
    var out = s.replace(/<rt[\s\S]*?<\/rt>/gi, '').replace(/<rp[\s\S]*?<\/rp>/gi, '').replace(/<\/?ruby[^>]*>/gi, '');
    out = out.replace(/<[^>]+>/g, '');
    return out.replace(/\s+/g,' ').trim();
  }

  function ensureFilterOptions(id, items, allLabel){
    var sel = byId(id);
    if (!sel) return;
    var hasReal = false;
    var i, opt;
    for(i=0;i<sel.options.length;i++){
      opt = sel.options[i];
      if (opt && opt.value && opt.value !== "") { hasReal = true; break; }
    }
    if (hasReal) return;
    var html = '<option value="">' + allLabel + '</option>';
    for (i=0;i<items.length;i++){
      html += '<option value="'+items[i]+'">'+items[i]+'</option>';
    }
    sel.innerHTML = html;
  }
})();
