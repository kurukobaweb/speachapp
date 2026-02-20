import { api } from '../js/api.js';

/* /js/score-detail.js — 共通authFetch/api利用版（テーマ情報でスコアを補完して集計） + admin切替 */
(function(){
  "use strict";

  var SCORES_ENDPOINT         = "/api/scores";
  var THEMES_ENDPOINT         = "/api/themes";
  var THEME_OPTIONS_ENDPOINT  = "/api/theme-options";

  /**
   * ★追加：admin/owner の表示範囲切替
   * false（デフォルト）: admin/owner でも本人のみ表示
   * true              : admin/owner は全員分表示
   */
  var SHOW_ALL_SCORES = false;

  // ログイン必須：トークンが無ければログインへ
  function requireToken(){
    var t = localStorage.getItem("authToken");
    if (!t) location.href = "../login.html";
    return t;
  }

  var ALL_LEVELS  = ["初級","中級","上級","超級","面接対応","10秒スピーチチャレンジ","小中学生のための60秒スピーチ","大学生のための就活面接40秒スピーチ"];
  var ALL_TYPES  = ["二択", "単体", "なし", "自分のこと", "学校生活・友だち", "家族・家のこと", "趣味・好きなもの", "社会・世界・地域", "夢・将来", "心・考え・生き方", "チャレンジ・希望", "基本情報・自己紹介", "学業・研究内容", "経験・エピソード", "価値観・考え方", "将来・キャリアビジョン", "時事・一般常識・その他"];
  var FREE_LEVELS = ["初級","中級","上級","超級"];
  var FREE_TYPES  = ["二択"];
  var allowedLevels = ALL_LEVELS.slice();
  var allowedTypes  = ALL_TYPES.slice();

  function detectRoleCourse(){
    try{
      var t = localStorage.getItem("authToken")||"";
      var b = (t.split(".")[1]||"");
      var pad = new Array((4-(b.length%4))%4+1).join("=");
      var p = JSON.parse(decodeURIComponent(escape(atob((b+pad).replace(/-/g,"+").replace(/_/g,"/")))));
      if (p && (p.role || p.course_id)) return {role:p.role||"user", course:String(p.course_id||"").toLowerCase()};
    }catch(e){}
    try{
      var u = JSON.parse(localStorage.getItem("userProfile")||"{}");
      if (u && (u.role||u.course_id||u.course)) return {role:(u.role||"user"), course:String(u.course_id||u.course||"").toLowerCase()};
    }catch(e2){}
    return {role:"user", course:"free"};
  }

  function safeAtobUrl(b64url){
    var b = String(b64url || "");
    var pad = new Array((4 - (b.length % 4)) % 4 + 1).join("=");
    b = (b + pad).replace(/-/g, "+").replace(/_/g, "/");
    try { return atob(b); } catch (e) { return ""; }
  }
  function decodeJwtPayload(token){
    try{
      var parts = String(token||"").split(".");
      if (parts.length < 2) return null;
      var json = safeAtobUrl(parts[1]);
      if (!json) return null;
      var str = "";
      try { str = decodeURIComponent(escape(json)); } catch (e2) { str = json; }
      var p = JSON.parse(str);
      return (p && typeof p === "object") ? p : null;
    }catch(e){ return null; }
  }
  function detectRoleCourseAndUserId(){
    var t = localStorage.getItem("authToken") || "";
    var p = decodeJwtPayload(t) || null;
    var role = (p && p.role) ? String(p.role).toLowerCase() : "user";
    var uid  = (p && (p.uid || p.userId || p.id || p.sub)) ? String(p.uid || p.userId || p.id || p.sub) : "";
    // fallback: userProfile
    if (!uid) {
      try{
        var u = JSON.parse(localStorage.getItem("userProfile")||"{}");
        uid = String(u.uid || u.userId || u.id || u.sub || u.user_id || "");
        if (u.role) role = String(u.role).toLowerCase();
      }catch(_){}
    }
    var course = (p && p.course_id) ? String(p.course_id).toLowerCase() : "free";
    return { role: role, course: course, userId: uid };
  }

  /* 先頭付近のどこでもOK：色パレットを定義 */
  var SCORE_COLORS = ["#BFD4FF", "#8FB3FF", "#6B8DF0"]; // 0–59,60–79,80–100
  var TIME_COLOR   = "#93C5FD";                          // 学習時間の棒
  var AXIS_COLOR   = "#CBD5E1";                          // 軸線色
  var NS = "http://www.w3.org/2000/svg";
  function createRect(x,y,w,h){ var r=document.createElementNS(NS,"rect");
    r.setAttribute("x",x); r.setAttribute("y",y);
    r.setAttribute("width",w); r.setAttribute("height",h);
    r.setAttribute("rx","6"); r.setAttribute("ry","6"); return r; }
  function createText(x,y,txt){ var t=document.createElementNS(NS,"text");
    t.setAttribute("x",x); t.setAttribute("y",y);
    t.setAttribute("text-anchor","middle"); t.setAttribute("font-size","10");
    t.textContent=txt; return t; }

  // ★ /api/theme-options → 共通api.getで取得。失敗時はJWTフォールバック。
  async function loadAllowedOptions(){
    try{
      var js = await api.get(THEME_OPTIONS_ENDPOINT, { cache:"no-cache" });
      allowedLevels = Array.isArray(js.levels)? js.levels.slice() : ALL_LEVELS.slice();
      allowedTypes  = Array.isArray(js.types) ? js.types.slice()  : ALL_TYPES.slice();
    }catch(_){
      var rc = detectRoleCourse();
      if (rc.role==="owner"||rc.role==="admin"||rc.course!=="free"){
        allowedLevels = ALL_LEVELS.slice();
        allowedTypes  = ALL_TYPES.slice();
      }else{
        allowedLevels = FREE_LEVELS.slice();
        allowedTypes  = FREE_TYPES.slice();
      }
    }
  }

  var themes = [];
  var scores = [];
  var fLevel = "";
  var fType  = "";

  document.addEventListener("DOMContentLoaded", async function(){
    // ログイン必須
    requireToken();
    bindUI();

    // ロール/ユーザーID確定（score.jsと同じ思想）
    var rc = detectRoleCourseAndUserId();
    window.currentUserId = rc.userId || "";
    window.currentRole   = rc.role   || "user";

    var q = new URLSearchParams(location.search);
    var lv0 = (q.get("level")||"").trim();
    var tp0 = (q.get("type") ||"").trim();
    var s1 = byId("fLevel"), s2 = byId("fType");
    if (lv0 && s1){ s1.value = lv0; fLevel = lv0; }
    if (tp0 && s2){ s2.value = tp0; fType  = tp0; }

    try{
      await loadAllowedOptions();

      var [rawScores, rawThemes] = await Promise.all([
        api.get(SCORES_ENDPOINT),
        api.get(THEMES_ENDPOINT)
      ]);

      // 1) normalize
      var nScores = normalizeScores(rawScores);

      // 2) ★表示範囲を確定（userは強制本人のみ / adminはフラグで切替）
      var role = String(window.currentRole || "user").toLowerCase();
      var myId  = String(window.currentUserId || "");

      // user_idが空でも漏れないよう補完
      nScores = nScores.map(function(s){
        if (s.user_id == null || String(s.user_id) === "") s.user_id = myId;
        return s;
      });

      if (role === "admin" || role === "owner") {
        if (SHOW_ALL_SCORES !== true) {
          nScores = nScores.filter(function(s){ return String(s.user_id) === myId; });
        }
      } else {
        nScores = nScores.filter(function(s){ return String(s.user_id) === myId; });
      }

      // themes
      var themesRaw =
        (rawThemes && (rawThemes.all || rawThemes.themes || rawThemes.items)) ? (rawThemes.all || rawThemes.themes || rawThemes.items)
        : rawThemes;

      themes = normalizeThemes(themesRaw);

      // ★ テーマ情報でスコアを補完
      var idx = indexThemes(themes);
      scores = nScores.map(function(s){ return mergeScoreWithTheme(s, idx); });

      ensureFilterOptions("fLevel", allowedLevels, "全てのLV");
      ensureFilterOptions("fType",  allowedTypes,  "全てのタイプ");

      renderAll();

      // 戻るボタン：history.back()だと不安定なのでscore.htmlへ固定
      var b = byId("btnBackToList");
      if (b) b.addEventListener("click", function(){ location.href = "score.html"; });

      var ex = byId("btnExportDetailJson");
      if (ex) ex.addEventListener("click", onExport);

    }catch(e){
      console.error(e);
    }
  });

  function bindUI(){
    bindLevelTypeFilter("fLevel", "fType", true);

    var rst = byId("btnResetDetail");
    if (rst) rst.addEventListener("click", function(){
      var lv = byId("fLevel"), tp = byId("fType");
      if (lv) lv.value=""; if (tp) tp.value="";
      fLevel=""; fType="";

      // disabled解除（全て選べる状態へ）
      applyDisabledOptions(tp, allTypesFromMap(), true);
      applyDisabledOptions(lv, allLevelsFromMap(), true);

      renderAll();
    });
  }

  function filterThemes(){
    return themes.filter(function(t){
      var lv = String(t.level||"").trim();
      var tp = String(t.type ||"").trim();

      if (fLevel && lv!==fLevel) return false;
      if (fType  && tp!==fType)  return false;
      return true;
    });
  }
  function filterScores(){
    return scores.filter(function(s){
      var lv = String(s.level||"").trim();
      var tp = String(s.type ||"").trim();

      if (fLevel && lv!==fLevel) return false;
      if (fType  && tp!==fType)  return false;
      return true;
    });
  }

  /* ===== レベル⇄タイプ 連動（score.js と同等） ===================== */

  var LEVEL_TYPE_MAP = {
    "初級": ["二択", "単体"],
    "中級": ["二択", "単体"],
    "上級": ["二択", "単体"],
    "超級": ["二択", "単体"],
    "面接対応": ["基本情報・自己紹介","学業・研究内容","経験・エピソード","価値観・考え方","将来・キャリアビジョン","時事・一般常識・その他"],
    "10秒スピーチチャレンジ": ["なし"],
    "小中学生のための60秒スピーチ": ["自分のこと","学校生活・友だち","家族・家のこと","趣味・好きなもの","社会・世界・地域","夢・将来","心・考え・生き方","チャレンジ・希望"],
    "大学生のための就活面接40秒スピーチ": ["基本情報・自己紹介","学業・研究内容","経験・エピソード","価値観・考え方","将来・キャリアビジョン","時事・一般常識・その他"]
  };

  function norm(v){ return String(v == null ? "" : v).trim(); }

  function uniq(arr){
    var out = [];
    for (var i=0;i<arr.length;i++){
      if (out.indexOf(arr[i]) < 0) out.push(arr[i]);
    }
    return out;
  }

  function allLevelsFromMap(){
    return Object.keys(LEVEL_TYPE_MAP);
  }

  function allTypesFromMap(){
    var all = [];
    Object.keys(LEVEL_TYPE_MAP).forEach(function(lv){
      (LEVEL_TYPE_MAP[lv] || []).forEach(function(tp){ all.push(tp); });
    });
    return uniq(all);
  }

  function allowedTypesForLevel(lv){
    return (LEVEL_TYPE_MAP[lv] || []).slice();
  }

  function allowedLevelsForType(tp){
    var out = [];
    Object.keys(LEVEL_TYPE_MAP).forEach(function(lv){
      var arr = LEVEL_TYPE_MAP[lv] || [];
      if (arr.indexOf(tp) >= 0) out.push(lv);
    });
    return out;
  }

  function applyDisabledOptions(selectEl, itemsAllowed, allowBlank){
    if (!selectEl) return;
    var set = {};
    for (var i=0;i<itemsAllowed.length;i++) set[norm(itemsAllowed[i])] = 1;

    for (var j=0;j<selectEl.options.length;j++){
      var opt = selectEl.options[j];
      var v = norm(opt.value);
      if (allowBlank && v === "") { opt.disabled = false; continue; }
      opt.disabled = !set[v];
    }
  }

  function normalizeSelectedIfDisabled(selectEl, allowBlank){
    if (!selectEl) return;
    var cur = selectEl.options[selectEl.selectedIndex];
    if (cur && !cur.disabled) return;

    if (allowBlank) {
      selectEl.value = "";
      return;
    }
    for (var i=0;i<selectEl.options.length;i++){
      if (!selectEl.options[i].disabled) {
        selectEl.selectedIndex = i;
        return;
      }
    }
  }

  function bindLevelTypeFilter(levelId, typeId, allowBlank){
    var levelSel = byId(levelId);
    var typeSel  = byId(typeId);
    if (!levelSel || !typeSel) return;

    function onLevelChange(){
      var lv = norm(levelSel.value);

      if (allowBlank && lv === ""){
        applyDisabledOptions(typeSel, allTypesFromMap(), true);
        return;
      }

      applyDisabledOptions(typeSel, allowedTypesForLevel(lv), allowBlank);
      normalizeSelectedIfDisabled(typeSel, allowBlank);
    }

    function onTypeChange(){
      var tp = norm(typeSel.value);

      if (allowBlank && tp === ""){
        applyDisabledOptions(levelSel, allLevelsFromMap(), true);
        return;
      }

      if (allowBlank && norm(levelSel.value) === ""){
        applyDisabledOptions(levelSel, allLevelsFromMap(), true);
        return;
      }

      applyDisabledOptions(levelSel, allowedLevelsForType(tp), allowBlank);
      normalizeSelectedIfDisabled(levelSel, allowBlank);
    }

    levelSel.addEventListener("change", function(){
      fLevel = norm(levelSel.value);
      onLevelChange();
      renderAll();
    });

    typeSel.addEventListener("change", function(){
      fType = norm(typeSel.value);
      onTypeChange();
      renderAll();
    });

    onLevelChange();
    onTypeChange();
  }

  function renderAll(){
    var th = filterThemes();
    var sc = filterScores();
    renderAchievement(th, sc);
    renderScore(sc);
    renderTime(sc);
  }

  function themeKeyFromScore(s){
    if (s.theme_id)   return String(s.theme_id);
    if (s.display_id) return "disp:"+String(s.display_id);
    return ["cmp", String(s.level||""), String(s.no||""), String(s.type||"")].join("|");
  }

  function renderAchievement(th, sc){
    var total = th.length;
    var uniq = Object.create(null);
    for (var i=0;i<sc.length;i++){ var k=themeKeyFromScore(sc[i]); if (k) uniq[k]=1; }
    var done = Object.keys(uniq).length;

    setText("totalCnt", String(total));
    setText("doneCnt",  String(done));

    var rate = total ? Math.round(done*100/total) : 0;
    var C = 2*Math.PI*64;
    var fg = document.querySelector(".gauge-fg");
    var tx = document.querySelector(".gauge-text");
    if (fg) fg.setAttribute("stroke-dasharray", String((C*rate)/100)+" "+String(C));
    if (tx) tx.textContent = rate + "%";
  }

  function renderScore(sc){
    var arr = sc.map(function(x){ return Number(x.score)||0; });
    var cnt = arr.length;
    var avg = cnt ? Math.round(arr.reduce(function(a,b){return a+b;},0)/cnt) : 0;
    var max = cnt ? Math.max.apply(Math, arr) : 0;
    setText("avgScore", cnt? String(avg):"--");
    setText("maxScore", cnt? String(max):"--");
    setText("cntScore", String(cnt));

    var b0 = arr.filter(function(x){ return x<=59; }).length;
    var b1 = arr.filter(function(x){ return x>=60 && x<=79; }).length;
    var b2 = arr.filter(function(x){ return x>=80; }).length;
    drawBars("#scoreChart", [b0,b1,b2]);
  }

  function renderTime(sc){
    var cnt = sc.length;
    var total = sc.reduce(function(s,r){ return s + (Number(r.durationSec)||0); }, 0);
    var avg = cnt ? Math.round(total/cnt) : 0;
    setText("sumTime", formatDuration(total));
    setText("avgTime", formatDuration(avg));
    setText("cntTime", String(cnt));

    function dayKey(d){
      var dt = toDate(d);
      var y = dt.getFullYear(), m=("0"+(dt.getMonth()+1)).slice(-2), da=("0"+dt.getDate()).slice(-2);
      return y+"-"+m+"-"+da;
    }
    var today = new Date();
    var keys = [];
    for (var i=0;i<7;i++){ var d=new Date(today); d.setHours(0,0,0,0); d.setDate(d.getDate()-(6-i)); keys.push(dayKey(d)); }

    var map = {}; for (var k=0;k<keys.length;k++) map[keys[k]]=0;
    for (var j=0;j<sc.length;j++){
      var k2 = dayKey(sc[j].at);
      if (map.hasOwnProperty(k2)) map[k2] += Number(sc[j].durationSec)||0;
    }
    var vals = keys.map(function(k){ return map[k]||0; });
    drawTimeBars("#timeChart", keys, vals);
  }

  /* ====== 正規化 ====== */
  function normalizeThemes(rows){
    var src = Array.isArray((rows && rows.items) || rows) ? ((rows && rows.items) || rows) : (rows ? [rows] : []);
    return src.map(function(t,i){ return {
      theme_id:   String((t && (t.theme_key || t.theme_id || t.id)) || ("theme_"+i)),
      display_id: (t && (t.display_id || t.displayId)) || "",
      level:      (t && t.level) || "",
      type:       (t && t.type)  || "",
      no:         (t && (t.no || t.sub)) || "",
      title:      (t && (t.title || t.question || t.prompt)) || ""
    };});
  }

  // ★修正：duration_s / taken_at を正しく読む
  function normalizeScores(rows){
    var src = Array.isArray((rows && rows.items) || rows) ? ((rows && rows.items) || rows) : (rows ? [rows] : []);
    return src.map(function(r,i){
      var dur =
        (r && isFinite(r.duration_s)) ? Number(r.duration_s)
        : (r && isFinite(r.duration_sec)) ? Number(r.duration_sec)
        : (r && isFinite(r.durationSec)) ? Number(r.durationSec)
        : (r && isFinite(r.duration)) ? Number(r.duration)
        : 0;

      var at =
        (r && (r.taken_at || r.evaluated_at || r.at || r.created_at || r.updated_at)) || new Date().toISOString();

      return {
        id:          String((r && (r.id || r._id || r.doc_id)) || ("rec_"+Date.now()+"_"+i)),
        theme_id:    String((r && (r.theme_id || r.themeId)) || ""),
        display_id:  (r && (r.display_id || r.displayId)) || "",
        level:       (r && r.level) || "",
        type:        (r && r.type)  || "",
        no:          (r && (r.no || r.sub)) || "",
        title:       (r && (r.title || r.prompt)) || "",
        score:       (r && isFinite(r.score)) ? r.score : ((r && r.totalScore) || 0),
        durationSec: dur,
        at:          at,
        // ★ user_id を保持（サーバが返す/返さない両方に対応）
        user_id:     (r && (r.user_id || r.userId || r.uid || r.sub)) || ""
      };
    });
  }

  /* ====== スコア ←→ テーマのマージ ====== */
  function indexThemes(themes){
    var byDisplayId = new Map(), byThemeId = new Map(), byKey = new Map(); // level|no|type
    themes.forEach(function(t){
      if (t.display_id) byDisplayId.set(String(t.display_id), t);
      if (t.theme_id)   byThemeId.set(String(t.theme_id), t);
      byKey.set([t.level||"", String(t.no||""), t.type||""].join("|"), t);
    });
    return { byDisplayId:byDisplayId, byThemeId:byThemeId, byKey:byKey };
  }
  function attachThemeFields(s, t){
    return {
      id: s.id,
      theme_id:   s.theme_id || t.theme_id || "",
      display_id: s.display_id || t.display_id || "",
      level:      s.level || t.level || "",
      type:       s.type  || t.type  || "",
      no:         s.no    || t.no    || "",
      title:      s.title || t.title || "",
      score:       s.score,
      durationSec: s.durationSec,
      at:          s.at,
      user_id:     s.user_id
    };
  }
  function mergeScoreWithTheme(s, idx){
    if (s.display_id && idx.byDisplayId.has(String(s.display_id))) return attachThemeFields(s, idx.byDisplayId.get(String(s.display_id)));
    if (s.theme_id   && idx.byThemeId.has(String(s.theme_id)))     return attachThemeFields(s, idx.byThemeId.get(String(s.theme_id)));
    var key = [s.level||"", String(s.no||""), s.type||""].join("|");
    if (idx.byKey.has(key)) return attachThemeFields(s, idx.byKey.get(key));
    return s;
  }

  /* ====== SVG描画 ====== */
  function drawBars(selector, counts){
    var svg = document.querySelector(selector); if (!svg) return;
    var W=320, H=160, P=20, bw=60, gap=30;
    svg.setAttribute("viewBox","0 0 "+W+" "+H);
    svg.innerHTML = "";

    var axis = document.createElementNS(NS,"line");
    axis.setAttribute("x1",P); axis.setAttribute("y1",H-P);
    axis.setAttribute("x2",W-P); axis.setAttribute("y2",H-P);
    axis.setAttribute("stroke",AXIS_COLOR); axis.setAttribute("stroke-width","1");
    svg.appendChild(axis);

    var mx = Math.max(1, Math.max.apply(Math, counts));
    counts.forEach(function(v,i){
      var x = P + i*(bw+gap);
      var h = Math.round((v/mx) * (H-P*2));
      var y = H - P - h;
      var r = createRect(x,y,bw,h);
      r.setAttribute("fill", SCORE_COLORS[i] || SCORE_COLORS[SCORE_COLORS.length-1]);
      svg.appendChild(r);

      var label = createText(x + bw/2, H-6, i===0?"0–59":i===1?"60–79":"80–100");
      svg.appendChild(label);
    });
  }

  function drawTimeBars(selector, keys, vals){
    var svg = document.querySelector(selector); if (!svg) return;
    var W=400, H=200, P=24, bw=32, gap=(W-P*2-bw*7)/6;
    svg.setAttribute("viewBox","0 0 "+W+" "+H);
    svg.innerHTML = "";

    var axis = document.createElementNS(NS,"line");
    axis.setAttribute("x1",P); axis.setAttribute("y1",H-P);
    axis.setAttribute("x2",W-P); axis.setAttribute("y2",H-P);
    axis.setAttribute("stroke",AXIS_COLOR); axis.setAttribute("stroke-width","1");
    svg.appendChild(axis);

    var mx = Math.max(1, Math.max.apply(Math, vals));
    keys.forEach(function(k,i){
      var v = vals[i];
      var x = P + i*(bw+gap);
      var h = Math.round((v/mx) * (H-P*2));
      var y = H - P - h;
      var r = createRect(x,y,bw,h);
      r.setAttribute("fill", TIME_COLOR);
      svg.appendChild(r);

      var t = createText(x + bw/2, H-6, k.slice(5)); // MM-DD
      svg.appendChild(t);
    });
  }

  /* ====== Util ====== */
  function byId(id){ return document.getElementById(id); }
  function setText(id, v){ var el=byId(id); if(el) el.textContent=String(v==null? "":v); }
  function formatDuration(sec){ var n=Math.max(0,Number(sec)||0), m=Math.floor(n/60), s=n%60; return m+":"+("0"+s).slice(-2); }
  function toDate(x){
    if (x==null) return new Date(NaN);
    if (typeof x==="number") return new Date(x>1e12? x : x*1000);
    if (typeof x==="string"){ var s=x.trim(); if (/^\d+$/.test(s)){ var n=Number(s); return new Date(n>1e12? n : n*1000);} return new Date(s); }
    if (x.seconds)  return new Date(x.seconds*1000);
    if (x._seconds) return new Date(x._seconds*1000);
    var d=new Date(x); return isNaN(d)? new Date(NaN):d;
  }
  function ensureFilterOptions(id, items, allLabel){
    var sel=byId(id); if(!sel) return;
    var hasReal=Array.prototype.some.call(sel.options,function(o){return o.value;});
    if (hasReal) return;
    var ph=(sel.options[0] && sel.options[0].outerHTML) || '<option value="">'+allLabel+'</option>';
    sel.innerHTML = ph + items.map(function(v){ return '<option value="'+v+'">'+v+'</option>'; }).join("");
  }

  function onExport(){
    var th=filterThemes(), sc=filterScores();
    var uniq=Object.create(null); for (var i=0;i<sc.length;i++){ uniq[themeKeyFromScore(sc[i])]=1; }
    var payload={
      exported_at:new Date().toISOString(),
      filters:{level:fLevel,type:fType},
      allowed:{levels:allowedLevels,types:allowedTypes},
      achievement:{done:Object.keys(uniq).length,total:th.length},
      score_summary:(function(){
        var arr=sc.map(function(x){return Number(x.score)||0;});
        var cnt=arr.length, avg=cnt? Math.round(arr.reduce(function(a,b){return a+b;},0)/cnt):0;
        var max=cnt? Math.max.apply(Math,arr):0;
        return {avg:avg,max:max,count:cnt};
      })(),
      time_summary:(function(){
        var cnt=sc.length, total=sc.reduce(function(s,r){return s+(Number(r.durationSec)||0);},0);
        var avg=cnt? Math.round(total/cnt):0;
        return {totalSec:total, avgSec:avg, count:cnt};
      })()
    };
    var blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    var d=new Date();
    a.download="score-detail_"+d.getFullYear()+("0"+(d.getMonth()+1)).slice(-2)+("0"+d.getDate()).slice(-2)+"_"+("0"+d.getHours()).slice(-2)+("0"+d.getMinutes()).slice(-2)+".json";
    a.click(); URL.revokeObjectURL(a.href);
  }

})();
