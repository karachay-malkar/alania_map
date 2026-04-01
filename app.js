(function () {
  const tg = window.Telegram?.WebApp;
  try { tg?.ready(); } catch {}

  // Views
  const viewDicts = document.getElementById("viewDicts");
  const viewSections = document.getElementById("viewSections");
  const viewLearnMenu = document.getElementById("viewLearnMenu");
const viewSetMenu = document.getElementById("viewSetMenu");
  const viewGlobalTestMenu = document.getElementById("viewGlobalTestMenu");
  const viewMatchMenu = document.getElementById("viewMatchMenu");
  const viewMatchGame = document.getElementById("viewMatchGame");
  const viewMatchResult = document.getElementById("viewMatchResult");
  const viewTest = document.getElementById("viewTest");
  const viewStudy = document.getElementById("viewStudy");
  const viewSessionAnalytics = document.getElementById("viewSessionAnalytics");

  // Dicts
  const dictsList = document.getElementById("dictsList");
  const btnGlobalTest = document.getElementById("btnGlobalTest");

  // Sections
  const sectionsTitle = document.getElementById("sectionsTitle");
  const sectionsList = document.getElementById("sectionsList");
  const btnBackToDicts = document.getElementById("btnBackToDicts");
  // Set menu
  const setMenuTitle = document.getElementById("setMenuTitle");
  const setMenuInfo = document.getElementById("setMenuInfo");
  const btnModeKb = document.getElementById("btnModeKb");
  const btnModeRu = document.getElementById("btnModeRu");
    const btnSetShowAll = document.getElementById("btnSetShowAll");
  const btnSetHideAll = document.getElementById("btnSetHideAll");
  const setWordsList = document.getElementById("setWordsList");
// Study
  const card = document.getElementById("card");
  const wordEl = document.getElementById("word");
  const transEl = document.getElementById("trans");
  const exampleBox = document.getElementById("exampleBox");
  const btnYes = document.getElementById("btnYes");
  const btnNo = document.getElementById("btnNo");
  const btnUndo = document.getElementById("btnUndo");
  const btnFavAction = document.getElementById("btnFavAction");
  const favActionLabel = document.getElementById("favActionLabel");
  const btnBackToSetMenu = document.getElementById("btnBackToSetMenu");

  // Top meta
  const counter = document.getElementById("counter");
  const btnBackArrow = document.getElementById("btnBackArrow");
  const modeEl = document.getElementById("mode");

  // Global test menu
  const globalTestInfo = document.getElementById("globalTestInfo");
  const btnTestScopeToggle = document.getElementById("btnTestScopeToggle");
  const testScopeBody = document.getElementById("testScopeBody");
  const testScopeList = document.getElementById("testScopeList");
  const btnGlobalModeKb = document.getElementById("btnGlobalModeKb");
  const btnGlobalModeRu = document.getElementById("btnGlobalModeRu");
  const btnGlobalTestBack = document.getElementById("btnGlobalTestBack");


  // Match words menu
  const btnMatchWords = document.getElementById("btnMatchWords");
  const matchInfo = document.getElementById("matchInfo");
  const matchScopeBody = document.getElementById("matchScopeBody");
  const matchScopeList = document.getElementById("matchScopeList");
  const btnMatchStart = document.getElementById("btnMatchStart");

  // Match game
  const matchProgress = document.getElementById("matchProgress");
  const matchColLeft = document.getElementById("matchColLeft");
  const matchColRight = document.getElementById("matchColRight");
  const matchResultList = document.getElementById("matchResultList");

  // Test view
  const testTitle = document.getElementById("testTitle");
  const testProgress = document.getElementById("testProgress");
  const testQuestion = document.getElementById("testQuestion");
  const testOptions = document.getElementById("testOptions");
  const btnTestExit = document.getElementById("btnTestExit");
  const btnTestNext = document.getElementById("btnTestNext");
  const exitSessionModal = document.getElementById("exitSessionModal");
  const btnExitStay = document.getElementById("btnExitStay");
  const btnExitConfirm = document.getElementById("btnExitConfirm");

  // ---------- Storage: hidden words (affects ONLY STUDY sessions)
  const HIDDEN_KEY = "fc_hidden_by_set_v7";
  function normalizeId(id) {
    const v = String(id ?? "").trim();
    return v;
  }
  function toIdSet(arr) {
    return new Set((Array.isArray(arr) ? arr : []).map(normalizeId).filter(Boolean));
  }
  function loadHiddenMap() { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || "{}"); } catch { return {}; } }
  function saveHiddenMap(map) { localStorage.setItem(HIDDEN_KEY, JSON.stringify(map)); }
  function keyOf(d, s, setNo) { return `${d}:${s}:${setNo}`; }
  function getHiddenSet(d, s, setNo) {
    const map = loadHiddenMap();
    const arr = Array.isArray(map[keyOf(d, s, setNo)]) ? map[keyOf(d, s, setNo)] : [];
    return toIdSet(arr);
  }
  function setHiddenSet(d, s, setNo, setOfIds) {
    const map = loadHiddenMap();
    map[keyOf(d, s, setNo)] = Array.from(setOfIds);
    saveHiddenMap(map);
  }

  

  // ---------- Storage: finished sets (manual "✅") — v9.8
  const FINISHED_KEY = "fc_finished_sets_v1";
  function loadFinishedMap(){ try { return JSON.parse(localStorage.getItem(FINISHED_KEY) || "{}"); } catch { return {}; } }
  function saveFinishedMap(map){ localStorage.setItem(FINISHED_KEY, JSON.stringify(map)); }
  function isSetFinished(d, s, setNo){
    const map = loadFinishedMap();
    return !!map[keyOf(d, s, setNo)];
  }
  function toggleSetFinished(d, s, setNo){
    const map = loadFinishedMap();
    const k = keyOf(d, s, setNo);
    if (map[k]) delete map[k]; else map[k] = true;
    saveFinishedMap(map);
    return !!map[k];
  }

  // ---------- Storage: favorites (per-device)
  const FAV_KEY = "fc_favorites_v1";
  function loadFavSet() {
    try {
      const arr = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return toIdSet(arr);
    } catch {
      return new Set();
    }
  }
  function saveFavSet(setOfIds) { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(setOfIds))); }
  function isFav(id) { return favIds.has(normalizeId(id)); }
  function toggleFav(id) {
    const nid = normalizeId(id);
    if (!nid) return false;
    if (favIds.has(nid)) favIds.delete(nid); else favIds.add(nid);
    saveFavSet(favIds);
    return favIds.has(nid);
  }

  const STAR_ICON_SVG = `
    <svg class="starSvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 17.27 18.18 21 16.54 13.97 22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z"></path>
    </svg>
  `;
  const STATUS_OK_ICON_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path>
    </svg>
  `;
  const STATUS_BAD_ICON_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
    </svg>
  `;
  function renderStarButton(id, attrs = "") {
    const on = isFav(id);
    return `<button class="starBtn ${on ? "on" : ""}" type="button" aria-label="Избранное" ${attrs}>${STAR_ICON_SVG}</button>`;
  }

  // ---------- Cache
  const CACHE_KEY = window.WORDS_CACHE_KEY || "fc_words_cache_v18";
  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; } }
  function saveCache(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {} }

  // ---------- Sheets URL -> CSV
  function normalizeToCsvUrl(url) {
    const u = (url || "").trim();
    if (!u) return "";
    if (u.includes("output=csv") || u.includes("out:csv") || u.includes("format=csv")) return u;
    const m = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) return u;
    const id = m[1];
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
  }

  async function loadWords() {
    const cached = loadCache();
    if (Array.isArray(cached) && cached.length) return cached.map(normalizeWordEntry).filter(Boolean);

    const sheetUrl = (window.WORDS_SHEET_URL || "").trim();
    const csvUrl = normalizeToCsvUrl(sheetUrl);
    if (csvUrl && csvUrl.startsWith("http")) {
      try {
        const words = await loadWordsFromCsv(csvUrl);
        if (Array.isArray(words) && words.length) { saveCache(words); return words; }
      } catch (e) {
        console.warn("loadWords: fetch failed", e);
      }
    }

    return Array.isArray(window.WORDS_FALLBACK) ? window.WORDS_FALLBACK.map(normalizeWordEntry).filter(Boolean) : [];
  }

  async function loadWordsFromCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("CSV load failed: " + res.status);
    const text = await res.text();
    return parseCsv(text);
  }

  // Expected headers: id, dict, section, set, word, trans, example, synonyms
  // Backward compatible: folder -> section, dict defaults to "Словарь"
  function parseSynonyms(raw) {
    return String(raw || "")
      .toLowerCase()
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  }

  function normalizeWordEntry(row) {
    if (!row || typeof row !== "object") return null;
    const id = normalizeId(row.id);
    const word = String(row.word || "").trim();
    const trans = String(row.trans || "").trim();
    const rawSet = String(row.set ?? "").trim();
    const numSet = Number(rawSet);

    const obj = {
      id,
      dict: String(row.dict || "").trim() || "Словарь",
      section: String(row.section || row.folder || "").trim() || "Раздел",
      set: isNaN(numSet) ? rawSet : numSet,
      word,
      trans,
      pos: String(row.pos || "").trim(),
      example: String(row.example || "").trim(),
      dict_order: Number(row.dict_order || 0),
      synonyms: parseSynonyms(row.synonyms),
    };

    if (!obj.id || !obj.set || !obj.word || !obj.trans) return null;
    return obj;
  }

  const PRIORITY_POS = ["noun", "verb", "adjective", "adverb"];
  const PRIORITY_POS_SET = new Set(PRIORITY_POS);

  function normalizePos(value) {
    return String(value || "").trim().toLowerCase();
  }

  function randomFrom(arr){
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getTransGroupSet(item) {
    return new Set(splitGroups(item?.trans).map(s => s.toLowerCase()).filter(Boolean));
  }

  function getSynonymSet(item) {
    return new Set((Array.isArray(item?.synonyms) ? item.synonyms : [])
      .map(s => String(s || "").trim().toLowerCase())
      .filter(Boolean));
  }

  function hasWordConflict(candidate, selected) {
    const transA = getTransGroupSet(candidate);
    const synA = getSynonymSet(candidate);

    return selected.some(item => {
      if (!item) return false;

      const transB = getTransGroupSet(item);
      for (const t of transA) {
        if (transB.has(t)) return true;
      }

      const synB = getSynonymSet(item);
      for (const s of synA) {
        if (synB.has(s)) return true;
      }

      return false;
    });
  }

  function buildRoundPOSList(globalPool, roundsCount) {
    const allPOS = uniq(globalPool.map(w => normalizePos(w.pos)).filter(Boolean));
    const priorityPOS = allPOS.filter(pos => PRIORITY_POS_SET.has(pos));
    const otherPOS = allPOS.filter(pos => !PRIORITY_POS_SET.has(pos));

    const otherRoundsCount = Math.min(roundsCount, Math.round(roundsCount * 0.1));
    const priorityRoundsCount = roundsCount - otherRoundsCount;
    const roundPOSList = [];

    for (let i = 0; i < priorityRoundsCount; i++) {
      const fallback = otherPOS.length ? otherPOS : PRIORITY_POS;
      const source = priorityPOS.length ? priorityPOS : fallback;
      roundPOSList.push(randomFrom(source));
    }

    for (let i = 0; i < otherRoundsCount; i++) {
      const source = otherPOS.length ? otherPOS : (priorityPOS.length ? priorityPOS : PRIORITY_POS);
      roundPOSList.push(randomFrom(source));
    }

    return shuffle(roundPOSList);
  }

  function buildWordsByPOSRounds(globalPool, totalLimit) {
    const roundsCount = Math.max(1, Math.floor(totalLimit / 5));
    const roundPOSList = buildRoundPOSList(globalPool, roundsCount);
    const usedWords = new Set();
    const rounds = [];

    for (const targetPOS of roundPOSList) {
      const roundWords = [];
      const maxAttempts = globalPool.length * 5;
      let attempts = 0;

      while (roundWords.length < 5 && attempts < maxAttempts) {
        attempts++;
        const word = randomFrom(globalPool);
        if (!word) break;
        if (normalizePos(word.pos) !== targetPOS) continue;

        const wordId = normalizeId(word.id);
        if (!wordId || usedWords.has(wordId)) continue;
        if (hasWordConflict(word, roundWords)) continue;

        roundWords.push(word);
        usedWords.add(wordId);
      }

      rounds.push(roundWords);
    }

    return {
      roundPOSList,
      rounds,
      items: rounds.flat()
    };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cur); cur = ""; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (ch === '\r') {}
        else cur += ch;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];

    const headers = rows[0].map(h => (h || "").trim().toLowerCase());
    const idx = (name) => headers.findIndex(h => h === name);

    const idI = idx("id");
    const dictI = idx("dict");
    const sectionI = idx("section");
    const folderI = idx("folder");
    const setI = idx("set");
    const wordI = idx("word");
    const transI = idx("trans");
    const exI = idx("example");
    const posI = idx("pos");
    const synI = idx("synonyms");

    const dictOrderI = idx("dict_order");
    if (idI === -1 || setI === -1 || wordI === -1 || transI === -1) return [];

    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      if (!cols || cols.every(c => !String(c||"").trim())) continue;

      const dict = dictI !== -1 ? String(cols[dictI] || "").trim() : "Словарь";
      const section = sectionI !== -1 ? String(cols[sectionI] || "").trim()
                    : (folderI !== -1 ? String(cols[folderI] || "").trim() : "Раздел");

      const obj = normalizeWordEntry({
        id: cols[idI],
        dict: dict || "Словарь",
        section: section || "Раздел",
        set: cols[setI],
        word: cols[wordI],
        trans: cols[transI],
        pos: posI !== -1 ? cols[posI] : "",
        example: exI !== -1 ? cols[exI] : "",
        dict_order: dictOrderI !== -1 ? cols[dictOrderI] : 0,
        synonyms: synI !== -1 ? cols[synI] : "",
      });
      if (!obj) continue;
      out.push(obj);
    }
    return out;
  }

  // ---------- Helpers

  // ---------- RU title renderer (v8.6, stage 2)

  function initUnifiedPanels() {
    const panels = Array.from(document.querySelectorAll('.panel[data-unified-panel="1"]'));
    panels.forEach((panel) => {
      if (panel.querySelector(':scope > .panel-header') && panel.querySelector(':scope > .panel-body')) return;

      const title = panel.querySelector('.panelTitle');
      if (!title) return;

      const header = document.createElement('div');
      header.className = 'panel-header';
      const body = document.createElement('div');
      body.className = 'panel-body';

      header.appendChild(title);
      panel.insertBefore(header, panel.firstChild);

      const rest = Array.from(panel.childNodes).filter((n) => n !== header && n !== body);
      rest.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) return;
        body.appendChild(node);
      });

      panel.appendChild(body);
    });
  }

  function renderRuTitle(el, text){
    const groups = splitGroups(text);
    if (!groups.length){
      el.textContent = "";
      return;
    }
    if (groups.length === 1){
      el.textContent = groups[0];
      return;
    }
    el.innerHTML = groups.map((g,i)=>`<div>${i+1}. ${escapeHtml(g)}</div>`).join("");
  }
  function showView(which) {
  [
    viewDicts,
    viewLearnMenu,
    viewSections,
viewSetMenu,
    viewGlobalTestMenu,
    viewMatchMenu,
    viewMatchGame,
    viewMatchResult,
    viewTest,
    viewStudy,
    viewDictContent,
    viewSessionAnalytics
  ].forEach(v => v && v.classList.add("hidden"));

  which.classList.remove("hidden");
}
  // --- Dictionary content visibility helper
  function hideDictContent(){
    if (viewDictContent) viewDictContent.classList.add("hidden");
  }


  
  // ---------- Global back navigation (single arrow in header) — v9.7 clean stack
  let currentView = viewDicts;
  const navStack = [];

  const studySession = { inProgress: false, completed: false, wordsPool: [], progressData: {} };
  const testSession = { inProgress: false, completed: false, wordsPool: [], progressData: {} };
  const matchSession = { inProgress: false, completed: false, wordsPool: [], progressData: {} };
  let exitIntentTargetView = null;

  function isHomeView(v){ return v === viewDicts; }
  function isTestFlowView(v){ return v === viewGlobalTestMenu || v === viewTest; }

  function updateMeta(){
    if (!counter || !modeEl) return;

    const onStudy = (currentView === viewStudy);

    // Counter only in study
    counter.style.display = onStudy ? "" : "none";

    // Mode title hidden in header for test flow
    modeEl.style.display = "none";
    modeEl.textContent = "";
  }

  function updateBackArrow(){
    if (!btnBackArrow) return;
    const shouldShow = !isHomeView(currentView) && navStack.length > 0;
    btnBackArrow.classList.toggle("hidden", !shouldShow);
  }

  function getSessionByView(view){
    if (view === viewStudy || view === viewSessionAnalytics) return studySession;
    if (view === viewTest) return testSession;
    if (view === viewMatchGame || view === viewMatchResult) return matchSession;
    return null;
  }

  function isResultsScreen(view){
    return view === viewSessionAnalytics || view === viewMatchResult || (view === viewTest && testSession.completed);
  }

  function isActiveSession(){
    const currentSession = getSessionByView(currentView);
    return !!(currentSession?.inProgress && !currentSession?.completed);
  }

  function clearSessionState(session){
    if (!session) return;
    session.wordsPool = [];
    session.progressData = {};
    session.inProgress = false;
    session.completed = false;

    if (session === studySession){
      mainQueue = [];
      repeatQueue = [];
      round = "main";
      totalPlanned = 0;
      currentStudyId = 0;
      swipeHistory = [];
      sessionFailMap = {};
    } else if (session === testSession){
      testItems = [];
      testIndex = 0;
      testCorrect = 0;
      testSelected = null;
      testResults = [];
      testOptionPool = [];
    } else if (session === matchSession){
      matchItems = [];
      matchRounds = [];
      matchRoundIndex = 0;
      matchSolvedCount = 0;
      matchTotal = 0;
      matchPosGroups = {};
      matchFailMap = {};
      matchSolved = new Set();
      matchLocked = false;
      matchSelectedIdx = null;
      matchSelectedRef = null;
    }
  }

  function showExitModal(){
    if (!exitSessionModal) return;
    exitSessionModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function hideExitModal(){
    if (!exitSessionModal) return;
    exitSessionModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  function confirmExit(){
    clearSessionState(getSessionByView(currentView));
    hideExitModal();

    const stackPrev = navStack.length ? navStack[navStack.length - 1] : null;
    if (stackPrev && stackPrev === exitIntentTargetView) {
      navStack.pop();
      goView(stackPrev, { push:false, force:true });
    } else if (exitIntentTargetView) {
      goView(exitIntentTargetView, { push:false, force:true });
    }

    exitIntentTargetView = null;
  }

  function goView(nextView, opts = {}){
    hideDictContent();
    const { push = true, resetStack = false, force = false } = opts;

    if (!force && nextView && nextView !== currentView && isActiveSession() && !isResultsScreen(currentView)) {
      exitIntentTargetView = nextView;
      showExitModal();
      return;
    }

    if (resetStack) navStack.length = 0;
    if (push && currentView && currentView !== nextView) navStack.push(currentView);
    showView(nextView);
    currentView = nextView;
    updateBackArrow();
    updateMeta();
  }

  function navigateBack(){
    // v9.9: match game/result are временные, back всегда ведёт в меню игры
    if (currentView === viewMatchGame || currentView === viewMatchResult){
      goView(viewMatchMenu, { push:false });
      return;
    }

    const prev = navStack.length ? navStack[navStack.length - 1] : null;
    if (!prev) return;

    // Keep stack intact while only showing confirmation modal.
    // Real stack rollback must happen only when navigation actually proceeds.
    if (isActiveSession() && !isResultsScreen(currentView)) {
      exitIntentTargetView = prev;
      showExitModal();
      return;
    }

    navStack.pop();
    goView(prev, { push:false });
  }

  if (btnBackArrow) btnBackArrow.addEventListener("click", navigateBack);
  if (btnExitStay) btnExitStay.addEventListener("click", () => { hideExitModal(); exitIntentTargetView = null; });
  if (btnExitConfirm) btnExitConfirm.addEventListener("click", confirmExit);
  if (exitSessionModal) {
    exitSessionModal.addEventListener("click", (e) => {
      if (e.target && e.target.matches("[data-exit-cancel='1']")) {
        hideExitModal();
        exitIntentTargetView = null;
      }
    });
  }




  function uniq(arr) { return Array.from(new Set(arr)); }
  function sortNatural(a, b) { return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" }); }
  function escapeHtml(s) {
    return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  // ---------- Study renderers (v7.3)
  // ---------- RU->ALAN front renderer (v8.6)
  function renderRuAlanFront(el, item){
    // number of groups determined ONLY by Russian translation variants
    const groups = splitGroups(item.trans);
    const exRaw = String(item.example || "").trim();

    // parse examples into indexed groups
    let eGroups = [];
    if(exRaw){
      const parts = exRaw.replace(/\n+/g,";").split(/\s*[;；]\s*/g).map(s=>s.trim()).filter(Boolean);
      let cur = null;
      for(const p of parts){
        const m = p.match(/^\s*(\d+)\s*(?:[\.)]|[-–—])?\s*(.*)$/);
        if(m){
          if(cur) eGroups.push(cur);
          cur = { i: Number(m[1])-1, lines: m[2] ? [m[2]] : [] };
        }else{
          if(!cur) cur = { i: 0, lines: [p] };
          else cur.lines.push(p);
        }
      }
      if(cur) eGroups.push(cur);
    }

    if(!groups.length){
      el.textContent = escapeHtml(item.word);
      return;
    }

    el.innerHTML = `
      <div class="groups">
        ${groups.map((_,i)=>{
          const eg = eGroups.find(g=>g.i===i);
          return `
            <div class="groupRow">
              <span class="groupNum">${i+1}</span>
              <div class="groupPill">
                <div class="gTrans">${escapeHtml(item.word)}</div>
                ${eg ? eg.lines.map(l=>`<div class="gEx">${escapeHtml(l)}</div>`).join("") : ``}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  // ---------- Combined renderer: translation + examples (v8.6)
  function renderCombinedGroups(el, transText, exText){
    const tGroups = splitGroups(transText);
    const eRaw = String(exText||"").trim();

    // parse examples into indexed groups
    let eGroups = [];
    if(eRaw){
      const parts = eRaw.replace(/\n+/g,";").split(/\s*[;；]\s*/g).map(s=>s.trim()).filter(Boolean);
      let cur = null;
      for(const p of parts){
        const m = p.match(/^\s*(\d+)\s*(?:[\.)]|[-–—])?\s*(.*)$/);
        if(m){
          if(cur) eGroups.push(cur);
          cur = { i: Number(m[1])-1, lines: m[2] ? [m[2]] : [] };
        }else{
          if(!cur) cur = { i: 0, lines: [p] };
          else cur.lines.push(p);
        }
      }
      if(cur) eGroups.push(cur);
    }

    const max = Math.max(tGroups.length, eGroups.length);
    if(!max){ el.textContent=""; return; }

    el.innerHTML = `
      <div class="groups">
        ${Array.from({length:max}).map((_,i)=>{
          const t = tGroups[i];
          const eg = eGroups.find(g=>g.i===i);
          return `
            <div class="groupRow">
              <span class="groupNum">${i+1}</span>
              <div class="groupPill">
                ${t ? `<div class="gTrans">${escapeHtml(t)}</div>` : ``}
                ${eg ? eg.lines.map(l=>`<div class="gEx">${escapeHtml(l)}</div>`).join("") : ``}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }
// ---------- Study renderers (v7.3)
  // ---------- RU->ALAN front renderer (v8.6)
  function renderRuAlanFront(el, item){
    // number of groups determined ONLY by Russian translation variants
    const groups = splitGroups(item.trans);
    const exRaw = String(item.example || "").trim();

    // parse examples into indexed groups
    let eGroups = [];
    if(exRaw){
      const parts = exRaw.replace(/\n+/g,";").split(/\s*[;；]\s*/g).map(s=>s.trim()).filter(Boolean);
      let cur = null;
      for(const p of parts){
        const m = p.match(/^\s*(\d+)\s*(?:[\.)]|[-–—])?\s*(.*)$/);
        if(m){
          if(cur) eGroups.push(cur);
          cur = { i: Number(m[1])-1, lines: m[2] ? [m[2]] : [] };
        }else{
          if(!cur) cur = { i: 0, lines: [p] };
          else cur.lines.push(p);
        }
      }
      if(cur) eGroups.push(cur);
    }

    if(!groups.length){
      el.textContent = escapeHtml(item.word);
      return;
    }

    el.innerHTML = `
      <div class="groups">
        ${groups.map((_,i)=>{
          const eg = eGroups.find(g=>g.i===i);
          return `
            <div class="groupRow">
              <span class="groupNum">${i+1}</span>
              <div class="groupPill">
                <div class="gTrans">${escapeHtml(item.word)}</div>
                ${eg ? eg.lines.map(l=>`<div class="gEx">${escapeHtml(l)}</div>`).join("") : ``}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  // Split text into groups by semicolon or newline
  function splitGroups(text){
    return String(text||"")
      .split(/\s*[;；]\s*|\n+/g)
      .map(s=>s.trim())
      .filter(Boolean)
      // strip leading numbering inside group text (e.g. "1. ...", "2) ...", "3 - ...")
      .map(s=>s.replace(/^\s*\d+\s*(?:[\.)]|[-–—])\s*/,"").trim());
  }

  // Render translation groups as pills (group-level)
  function renderTransGroups(el, text){
    const groups = splitGroups(text);
    if(!groups.length){ el.textContent = ""; return; }

    const showNums = groups.length > 1;
    el.innerHTML = `
      <div class="groups">
        ${groups.map((g,i)=>`
          <div class="groupRow">
            ${showNums ? `<span class="groupNum">${i+1}</span>` : ``}
            <div class="groupPill">${escapeHtml(g)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  // Render example groups by numeric markers (1,2,3...)
  function renderExampleGroups(el, text){
    const raw = String(text||"").trim();
    if(!raw){ el.textContent = ""; return; }

    // Split into candidate example lines by semicolons or newlines.
    const parts = raw
      .replace(/\n+/g, ";")
      .split(/\s*[;；]\s*/g)
      .map(s=>s.trim())
      .filter(Boolean);

    let groups = [];
    let current = null;

    for(const part of parts){
      const mm = part.match(/^\s*(\d+)\s*(?:[\.)]|[-–—])?\s*(.*)$/);
      if(mm){
        if(current) groups.push(current);
        const rest = (mm[2]||"").trim();
        current = { num: mm[1], lines: rest ? [rest] : [] };
      }else{
        if(!current){
          current = { num: null, lines: [part] };
        }else{
          current.lines.push(part);
        }
      }
    }
    if(current) groups.push(current);

    const numbered = groups.length >= 1 && groups.every(g => g.num);

    el.innerHTML = `
      <div class="groups examples">
        ${groups.map(g=>`
          <div class="groupRow groupRowEx">
            ${numbered ? `<span class="groupNum groupNumEx">${escapeHtml(g.num)}</span>` : ``}
            <div class="groupExample">
              ${g.lines.map(l=>`<div class="exLine">${escapeHtml(l)}</div>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  // Split "a, b; c, d" into blocks and pills
  // Major separator: semicolon (;). Inside each block: comma (,). Also supports slash (/) as an optional separator.
  function parseMulti(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    // Major blocks by semicolon or newline
    const blocks = raw
      .split(/\s*[;；]\s*|\n+/g)
      .map(s => s.trim())
      .filter(Boolean);

    const splitPills = (s) => {
      // First split by commas
      let parts = s.split(/\s*,\s*/g);

      // Then (optionally) split parts by slashes if it looks like alternatives
      const out = [];
      for (const p of parts) {
        const pp = String(p || "").trim();
        if (!pp) continue;
        // if there is a slash, split, but keep very short combos like "и/или" together
        if (pp.includes("/") && !/^[^\s]{1,4}\/[^\s]{1,4}$/.test(pp)) {
          const bySlash = pp.split(/\s*\/\s*/g).map(x => x.trim()).filter(Boolean);
          out.push(...bySlash);
        } else {
          out.push(pp);
        }
      }
      return out;
    };

    return blocks.map(b => splitPills(b)).filter(arr => arr.length);
  }

  function renderMultiHtml(text) {
    const groups = parseMulti(text);
    if (!groups.length) return "";
    // If only one group with one pill — render as simple text (keeps current look)
    if (groups.length === 1 && groups[0].length <= 1) return escapeHtml(groups[0][0] || "");
    return `
      <div class="multi">
        ${groups.map((pills, i) => `
          <div class="multiRow">
            <span class="multiNum">${i + 1}</span>
            <div class="multiPills">
              ${pills.map(p => `<span class="pill">${escapeHtml(p)}</span>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function setRichOrText(el, text) {
    const html = renderMultiHtml(text);
    if (html) el.innerHTML = html;
    else el.textContent = "";
  }
  function dictTitle(code) { return (window.DICT_TITLES || {})[code] || code; }
  function sectionTitle(code) { return (window.SECTION_TITLES || {})[code] || code; }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- Data helpers
  function dictsFrom(words) { return uniq(words.map(w => w.dict)).sort(sortNatural); }
  function sectionsFrom(words, dict) { return uniq(words.filter(w => w.dict === dict).map(w => w.section)).sort(sortNatural); }
  function setsFrom(words, dict, section) {
    return uniq(words.filter(w => w.dict === dict && w.section === section).map(w => w.set)).sort(sortNatural);
  }
  function wordsForSet(words, dict, section, setNo) {
    return words.filter(w => w.dict === dict && w.section === section && String(w.set) === String(setNo));
  }

  // ---------- App state

  // ---------- Dictionary content (Содержание словаря)
  const viewDictContent = document.getElementById("viewDictContent");
  const btnOpenDictContent = document.getElementById("btnOpenDictContent");
  const dictSearchInput = document.getElementById("dictSearchInput");
  const dictContentList = document.getElementById("dictContentList");

  function renderDictContent(filter = "") {
    if (!dictContentList) return;
    dictContentList.innerHTML = "";
    if (!Array.isArray(DATA) || !currentDict) return;

    const q = String(filter||"").toLowerCase().trim();
    const words = DATA
      .filter(w =>
        w.dict === currentDict &&
        Number(w.dict_order) > 0 &&
        (!q ||
          String(w.word||"").toLowerCase().includes(q) ||
          String(w.trans||"").toLowerCase().includes(q))
      )
      .sort((a,b)=>Number(a.dict_order)-Number(b.dict_order));

    const bySection = {};
    for (const w of words) {
      const sec = (w.section || "Раздел").trim() || "Раздел";
      (bySection[sec] ||= []).push(w);
    }

    for (const [sec, items] of Object.entries(bySection)) {
      const header = document.createElement("div");
      header.className = "sectionHeader";
      header.textContent = "▸ " + sectionTitle(sec);

      const body = document.createElement("div");
      body.classList.add("hidden");

      header.addEventListener("click", () => {
        const closed = body.classList.toggle("hidden");
        header.textContent = (closed ? "▸ " : "▾ ") + sectionTitle(sec);
      });

      for (const w of items) {
        const row = document.createElement("div");
        row.className = "dictWordRow";
        row.innerHTML = `
          <div class="dictNum">${Number(w.dict_order)}.</div>
          <div>
            <div class="w">${escapeHtml(w.word)}</div>
            <div class="t">${escapeHtml(w.trans)}</div>
          </div>
          ${renderStarButton(w.id)}
        `;
        const star = row.querySelector(".starBtn");
        star.addEventListener("click", (e)=>{
          e.stopPropagation();
          const on = toggleFav(w.id);
          star.classList.toggle("on", on);
        });
        body.appendChild(row);
      }

      dictContentList.appendChild(header);
      dictContentList.appendChild(body);
    }
  }

  if (btnOpenDictContent && viewDictContent) {
    btnOpenDictContent.addEventListener("click", () => {
      renderDictContent("");
      goView(viewDictContent);
      if (dictSearchInput) {
        dictSearchInput.value = "";
      }
    });
  }

  if (dictSearchInput) {
    dictSearchInput.addEventListener("input", () => {
      renderDictContent(dictSearchInput.value);
    });
  }

  let DATA = [];
  let favIds = loadFavSet();
  let currentDict = "";
  let currentSection = "";
  let currentSet = 1;

  // Study mode: kb => front word, ru => front trans
  let currentStudyMode = "kb";

  // Study queues
  let mainQueue = [];
  let repeatQueue = [];
  let round = "main";
  let totalPlanned = 0;
  let currentStudyId = 0;

  // v9.3: last swipe undo (single-step)
  let swipeHistory = [];
  let sessionFailMap = {};

  function setRoundIfNeeded() { if (round === "main" && mainQueue.length === 0) round = "repeat"; }
  function currentQueue() { return round === "main" ? mainQueue : repeatQueue; }

  // ---------- Render dicts / sections / sets
  function renderDicts() {
    const dicts = dictsFrom(DATA);
    dictsList.innerHTML = `<button class="btn" data-dict="__fav__">⭐ Избранное</button>` + dicts.map(d => `<button class="btn" data-dict="${escapeHtml(d)}">${escapeHtml(dictTitle(d))}</button>`).join("");
    dictsList.querySelectorAll("button[data-dict]").forEach(btn => {
      btn.addEventListener("click", () => {
        currentDict = btn.getAttribute("data-dict");
        if (currentDict === "__fav__") {
          currentDict = "__fav__"; currentSection = "Избранное"; currentSet = 1; openSetMenu();
          return;
        }
        renderSections(currentDict);
        goView(viewSections);
      });
    });
    
    goView(viewDicts, { push:false, resetStack:true });
  }

  function renderSections(dict) {
    sectionsTitle.textContent = (dict === "__fav__") ? "Избранное" : dictTitle(dict);

    const sections = (dict === "__fav__") ? ["Избранное"] : sectionsFrom(DATA, dict);

    sectionsList.innerHTML = sections.map(sec => {
      const sets = (dict === "__fav__") ? [1] : setsFrom(DATA, dict, sec);

      const tiles = sets.map(setNo => {
        const all = (dict === "__fav__")
          ? DATA.filter(w => favIds.has(w.id))
          : wordsForSet(DATA, dict, sec, setNo);

        const finished = isSetFinished(dict, sec, setNo);

        const title = (dict === "__fav__") ? "Избранное" : (typeof setNo === "number" ? `Сет ${setNo}` : String(setNo));
        return `
          <div class="setTile set-tile ${finished ? 'selected' : ''}" role="button" tabindex="0" data-section="${escapeHtml(sec)}" data-set="${setNo}">
            <button class="setDone setTileCorner set-tile__corner" data-done="1" type="button" aria-label="Отметить как выучено"><svg viewBox="0 0 24 24" class="setCheck ${finished ? 'active' : ''}">
    <rect x="3" y="3" width="18" height="18" rx="4"
          fill="none"
          stroke="rgba(15,23,42,0.25)"
          stroke-width="1.7"/>
    <path d="M7 10.5 L11.5 16 L17 6.5"
          fill="none"
          stroke-width="2.8"
          stroke-linecap="round"
          stroke-linejoin="round"/>
  </svg></button>
            <div class="setTileTitle">${escapeHtml(title)}</div>
          </div>
        `;
      }).join("");

      return `
        <div class="secBlock">
          <div class="secTitle">${escapeHtml(sectionTitle(sec))}</div>
          <div class="setsGrid">${tiles}</div>
        </div>
      `;
    }).join("");

    // Click handlers: open set vs toggle done
    sectionsList.querySelectorAll(".setTile").forEach(tile => {
      const sec = tile.getAttribute("data-section");
      const rawSet = tile.getAttribute("data-set");
      const setNo = isNaN(Number(rawSet)) ? rawSet : Number(rawSet);

      // Toggle ✅
      const doneEl = tile.querySelector("[data-done='1']");
      if (doneEl) {
        doneEl.addEventListener("click", (e) => {
          e.stopPropagation();
          const on = toggleSetFinished(dict, sec, setNo);
          const svg = doneEl.querySelector("svg");
if(svg){
  svg.classList.toggle("active", on);
}
          tile.classList.toggle("selected", on);
        });
      }

      // Open set menu
      tile.addEventListener("click", () => {
        currentSection = sec;
        currentSet = setNo;
        openSetMenu();
      });

      tile.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        currentSection = sec;
        currentSet = setNo;
        openSetMenu();
      });
    });
  }

  btnBackToDicts.addEventListener("click", () => goView(viewDicts));
// ---------- Set menu / hiding words
  let menuHidden = new Set();

  function openSetMenu() {
    menuHidden = getHiddenSet(currentDict, currentSection, currentSet);

    const all = (currentDict === "__fav__") ? DATA.filter(w => favIds.has(w.id)) : wordsForSet(DATA, currentDict, currentSection, currentSet);
    const active = all.filter(w => !menuHidden.has(w.id));
    const setLabel = typeof currentSet === "number" ? `Сет ${currentSet}` : String(currentSet);
    setMenuTitle.textContent = (currentDict === "__fav__") ? "⭐ Избранное" : `${setLabel}`;
    setMenuInfo.textContent = `Слов в сете: ${all.length} • В сессии: ${active.length}`;

    renderSetWordsList();
    goView(viewSetMenu);
  }

  function renderSetWordsList() {
    const all = (currentDict === "__fav__") ? DATA.filter(w => favIds.has(w.id)) : wordsForSet(DATA, currentDict, currentSection, currentSet);
    const filtered = all;

    setWordsList.innerHTML = filtered.map(w => {
      const checked = !menuHidden.has(w.id);
      return `
        <div class="item" data-id="${w.id}">
          <input class="checkbox" type="checkbox" ${checked ? "checked" : ""} />
          <div>
            <div class="w">${escapeHtml(w.word)}</div>
            <div class="t">${escapeHtml(w.trans)}</div>
          </div>
          ${renderStarButton(w.id)}
        </div>
      `;
    }).join("");

    setWordsList.querySelectorAll(".item").forEach(row => {
      const id = normalizeId(row.getAttribute("data-id"));
      const cb = row.querySelector("input[type=checkbox]");
      const star = row.querySelector(".starBtn");
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = toggleFav(id);
        star.classList.toggle("on", on);

        // В Избранном: если убрали звёздочку — слово должно сразу исчезнуть из списка
        if (currentDict === "__fav__" && !on) {
          renderSetWordsList();
          const all2 = DATA.filter(w => favIds.has(w.id));
          const active2 = all2.filter(w => !menuHidden.has(w.id));
          setMenuInfo.textContent = `Слов в сете: ${all2.length} • В сессии: ${active2.length}`;
        }
      });
      cb.addEventListener("change", () => {
        if (cb.checked) menuHidden.delete(id);
        else menuHidden.add(id);
        setHiddenSet(currentDict, currentSection, currentSet, menuHidden);

        const all2 = (currentDict === "__fav__") ? DATA.filter(w => favIds.has(w.id)) : wordsForSet(DATA, currentDict, currentSection, currentSet);
        const active2 = all2.filter(w => !menuHidden.has(w.id));
        setMenuInfo.textContent = `Слов в сете: ${all2.length} • В сессии: ${active2.length}`;
      });
    });
  }

  btnSetShowAll.addEventListener("click", () => {
    menuHidden = new Set();
    setHiddenSet(currentDict, currentSection, currentSet, menuHidden);
    renderSetWordsList();
    const all = (currentDict === "__fav__") ? DATA.filter(w => favIds.has(w.id)) : wordsForSet(DATA, currentDict, currentSection, currentSet);
    setMenuInfo.textContent = `Слов в сете: ${all.length} • В сессии: ${all.length}`;
  });

  btnSetHideAll.addEventListener("click", () => {
    const all = (currentDict === "__fav__") ? DATA.filter(w => favIds.has(w.id)) : wordsForSet(DATA, currentDict, currentSection, currentSet);
    menuHidden = new Set(all.map(w => w.id));
    setHiddenSet(currentDict, currentSection, currentSet, menuHidden);
    renderSetWordsList();
    setMenuInfo.textContent = `Слов в сете: ${all.length} • В сессии: 0`;
  });

  btnModeKb.addEventListener("click", () => { currentStudyMode = "kb"; startStudySession(); });
  btnModeRu.addEventListener("click", () => { currentStudyMode = "ru"; startStudySession(); });

  // ---------- Study counter helper
  function updateStudyCounter(){
    if (!counter) return;
    const known = Math.max(0, totalPlanned - (mainQueue.length + repeatQueue.length));
    counter.textContent = `знаю ${known}/${totalPlanned} слов`;
  }


  // v9.3: UI helpers for study action buttons
  function updateFavActionUI(){
    if (!btnFavAction) return;
    const on = isFav(currentStudyId);
    btnFavAction.classList.toggle("active", on);
    if (favActionLabel) favActionLabel.textContent = on ? "В избранном" : "Отметить слово";
    btnFavAction.setAttribute("aria-label", on ? "Убрать из избранного" : "Отметить слово");
  }

  function updateUndoUI(){
    if (!btnUndo) return;
    const can = swipeHistory.length > 0;
    btnUndo.disabled = !can || isAnimating;
  }

  
  
  function undoLastSwipe(){
    if (!swipeHistory.length || isAnimating) return;

    const { item, known, fromRound } = swipeHistory.pop();

    if (!known) {
      if (sessionFailMap[item.id]) {
        sessionFailMap[item.id]--;
        if (sessionFailMap[item.id] <= 0) delete sessionFailMap[item.id];
      }
      for (let i = repeatQueue.length - 1; i >= 0; i--) {
        if (repeatQueue[i] && repeatQueue[i].id === item.id) {
          repeatQueue.splice(i, 1);
          break;
        }
      }
    }

    if (fromRound === "main") {
      mainQueue.unshift(item);
    } else {
      repeatQueue.unshift(item);
    }

    round = fromRound;

    renderStudyCard();
    updateStudyCounter();
    updateUndoUI();
  }

// ---------- Study session

  function startStudySession() {
    const all = (currentDict === "__fav__") ? DATA.filter(w => favIds.has(w.id)) : wordsForSet(DATA, currentDict, currentSection, currentSet);
    const hidden = getHiddenSet(currentDict, currentSection, currentSet);
    const active = all.filter(w => !hidden.has(w.id));

    mainQueue = shuffle(active.slice());
    repeatQueue = [];
    round = "main";
    totalPlanned = active.length;
    swipeHistory = [];
    sessionFailMap = {};
    studySession.inProgress = true;
    studySession.completed = false;
    studySession.wordsPool = active.slice();
    studySession.progressData = { totalPlanned: active.length, known: 0, unknown: 0 };
    updateStudyCounter();

    goView(viewStudy);
    renderStudyCard();
    updateStudyCounter();
  }

  
function resetFlipInstant() {
  const inner = card.querySelector(".cardInner");
  if (!inner) {
    card.classList.remove("flipped");
    return;
  }

  const prev = inner.style.transition;
  inner.style.transition = "none";
  card.classList.remove("flipped");
  void inner.offsetWidth;
  inner.style.transition = prev || "";
}

function renderStudyCard() {
    
  resetFlipInstant();
setRoundIfNeeded();
    const q = currentQueue();

    // reset front state

    if (totalPlanned === 0) {
      wordEl.textContent = "Пусто 🤷‍♂️";
      transEl.textContent = "В этом сете все слова скрыты. Верни их в меню сета.";
      if (btnFavAction) btnFavAction.classList.add("hidden");
      if (btnUndo) btnUndo.classList.add("hidden");
return;
    } else {
}

    if (q.length === 0) {
      openSessionAnalytics();
      return;
    }

    // original finish block disabled
    if(false){
      transEl.textContent = "Сессия завершена.";
      if (btnFavAction) btnFavAction.classList.add("hidden");
      if (btnUndo) btnUndo.classList.add("hidden");
return;
    }

    const item = q[0];
    currentStudyId = item.id;
    if (btnFavAction) btnFavAction.classList.remove("hidden");
    if (btnUndo) btnUndo.classList.remove("hidden");
    updateFavActionUI();
    updateUndoUI();
    const front = currentStudyMode === "kb" ? item.word : item.trans;
    const back = currentStudyMode === "kb" ? item.trans : item.word;

    // Front rendering (stage 2)
    if (currentStudyMode === "ru") {
      renderRuTitle(wordEl, item.trans);
    } else {
      wordEl.textContent = front;
    }
    // Back rendering depends on mode
    if(currentStudyMode === "ru"){
      // RU → ALAN: pills count from Russian variants
      renderRuAlanFront(transEl, item);
    }else{
      // ALAN → RU (default)
      renderCombinedGroups(transEl, back, item.example);
    }

    const done = totalPlanned - q.length - (round === "repeat" ? 0 : 0);
    
  }

  // Tap: flip (front/back)
  card.addEventListener("click", (e) => {
    if (e.target && e.target.closest && (e.target.closest("#btnUndo") || e.target.closest("#btnFavAction"))) return;
    card.classList.toggle("flipped");
  });
function swipeDecision(known) {
    
  resetFlipInstant();
setRoundIfNeeded();
    const q = currentQueue();
    if (!q.length) return;

    // close back & example

    const fromRound = round;
    const item = q.shift();
    if (!known) {
      sessionFailMap[item.id] = (sessionFailMap[item.id] || 0) + 1;
      repeatQueue.push(item);
      studySession.progressData.unknown = (studySession.progressData.unknown || 0) + 1;
    } else {
      studySession.progressData.known = (studySession.progressData.known || 0) + 1;
    }

    const switchedToRepeat = (round === "main" && mainQueue.length === 0);
    // When main is empty, switch to repeat
    if (switchedToRepeat) round = "repeat";

    // store single-step undo info
    swipeHistory.push({ item, known, fromRound });

    renderStudyCard();
    updateStudyCounter();
    updateUndoUI();
  }

  btnYes.addEventListener("click", () => animateSwipe(1, true));
  btnNo.addEventListener("click", () => animateSwipe(-1, false));

  if (btnUndo) btnUndo.addEventListener("click", (e) => { e.stopPropagation(); undoLastSwipe(); });
  if (btnFavAction) btnFavAction.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = toggleFav(currentStudyId);
    updateFavActionUI();
  });

  
  // ---------- Swipe animation (v8.9 stable)
  let isAnimating = false;

  function animateSwipe(dir, known){
    if(isAnimating) return;
    isAnimating = true;
    updateUndoUI();

    card.style.pointerEvents = "none";
    card.style.transition = "transform .5s ease, opacity .5s ease, box-shadow .5s ease";
    card.style.transform = `translateX(${dir*520}px) rotate(${dir*14}deg)`;
    card.style.opacity = "0";

    setTimeout(()=>{

      swipeDecision(known);
      card.style.boxShadow = "";
      
      requestAnimationFrame(() => {
        card.style.transition = "none";
        card.style.transform = "translateY(-70px)";
        card.style.opacity = "0";

        requestAnimationFrame(() => {
          card.style.transition = "transform .5s ease, opacity .5s ease";
          card.style.transform = "translateY(0)";
          card.style.opacity = "1";
        });
      });

      card.style.pointerEvents = "";
      isAnimating = false;
      updateUndoUI();

    }, 500);
  }

  // Swipe gestures (animated)
  let startX = 0, startY = 0, dragging = false;

  card.addEventListener("touchstart", (e) => {
    if (!e.touches?.[0] || isAnimating) return;
    dragging = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    card.style.transition = "none";
    card.style.boxShadow = "";
  }, { passive: true });

  card.addEventListener("touchmove", (e) => {
  if (!dragging || !e.touches?.[0] || isAnimating) return;

  const dx = e.touches[0].clientX - startX;
  const dy = e.touches[0].clientY - startY;
  if (Math.abs(dy) > Math.abs(dx)) return;

  // Quizlet-like threshold (30% of screen width)
  const threshold = card.offsetWidth * 0.3;
  const progress = Math.min(Math.abs(dx) / threshold, 1);

  const rotate = dx / 22;
  const opacity = 1 - Math.min(Math.abs(dx) / (threshold * 1.6), 0.6);

  card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;
  card.style.opacity = String(opacity);

  // Edge glow feedback
  if (dx > 0) {
    // right edge green
    card.style.boxShadow = `0 10px 30px rgba(17,169,232,0.18), 28px 0 100px rgba(34,197,94,${1 * progress})`;
  } else if (dx < 0) {
    // left edge red
    card.style.boxShadow = `0 10px 30px rgba(17,169,232,0.18), -28px 0 100px rgba(239,68,68,${1 * progress})`;
  } else {
    card.style.boxShadow = "";
  }
}, { passive: true });

  card.addEventListener("touchend", (e) => {
  if (!dragging || isAnimating) return;
  dragging = false;

  const endX = (e.changedTouches?.[0]?.clientX ?? startX);
  const dx = endX - startX;

  // Quizlet-like threshold (30% of screen width)
  const threshold = card.offsetWidth * 0.3;

  card.style.transition = "transform .18s ease, opacity .18s ease, box-shadow .18s ease";

  if (dx > threshold) animateSwipe(1, true);
  else if (dx < -threshold) animateSwipe(-1, false);
  else {
    // snap back
    card.style.transform = "";
    card.style.opacity = "";
    card.style.boxShadow = "";
  }
});

  btnBackToSetMenu.addEventListener("click", () => {
  favIds = loadFavSet();
  openSetMenu();
});

  // ---------- Global test (only global, with dict filter)
  let testMode = "kb"; // kb: Q=word, A=trans; ru: Q=trans, A=word
  let testItems = [];
  let testIndex = 0;
  let testCorrect = 0;
  let testSelected = null;
  let testResults = [];
  let testOptionPool = [];
  function getSelectedTestLimit() {
    const el = document.querySelector('input[name="testLimit"]:checked');
    const n = el ? Number(el.value) : 40;
    return (n === 20 || n === 40 || n === 80) ? n : 40;
  }

  function scopeKey(dict, section) {
    return `${dict}||${section || ""}`;
  }

  function renderTestScopeList() {
    // Build dict -> sections map
    const dicts = dictsFrom(DATA);
    const html = dicts.map(d => {
      const sections = uniq(DATA.filter(w => w.dict === d).map(w => w.section || "")).sort(sortNatural);
      const sectionRows = sections.map(s => {
        const label = s ? sectionTitle(s) : "Без раздела";
        return `
          <label class="scopeSectionRow">
            <input class="scopeCheckbox scopeSection" type="checkbox" data-dict="${escapeHtml(d)}" data-section="${escapeHtml(s)}">
            <span>${escapeHtml(label)}</span>
          </label>
        `;
      }).join("");

      return `
        <div class="scopeBlock">
          <label class="scopeDictRow">
            <input class="scopeCheckbox scopeDict" type="checkbox" data-dict="${escapeHtml(d)}">
            <span>${escapeHtml(dictTitle(d))}</span>
          </label>
          ${sectionRows}
        </div>
      `;
    }).join("");

    testScopeList.innerHTML = html || "<div class='hintText'>Словари не найдены.</div>";

    // Wire behavior
    const dictCbs = [...testScopeList.querySelectorAll(".scopeDict")];
    const sectionCbs = [...testScopeList.querySelectorAll(".scopeSection")];

    function updateDictState(dict) {
      const secs = sectionCbs.filter(cb => cb.dataset.dict === dict);
      const checked = secs.filter(cb => cb.checked).length;
      const dictCb = dictCbs.find(cb => cb.dataset.dict === dict);
      if (!dictCb) return;
      dictCb.indeterminate = checked > 0 && checked < secs.length;
      dictCb.checked = secs.length > 0 && checked === secs.length;
    }

    dictCbs.forEach(dictCb => {
      dictCb.addEventListener("change", () => {
        const d = dictCb.dataset.dict;
        sectionCbs.filter(cb => cb.dataset.dict === d).forEach(cb => { cb.checked = dictCb.checked; });
        dictCb.indeterminate = false;
        updateGlobalTestInfo();
      });
    });

    sectionCbs.forEach(secCb => {
      secCb.addEventListener("change", () => {
        updateDictState(secCb.dataset.dict);
        updateGlobalTestInfo();
      });
    });

    // Default: all checked (so user can quickly uncheck)
    dictCbs.forEach(dcb => { dcb.checked = true; });
    sectionCbs.forEach(scb => { scb.checked = true; });
    dictCbs.forEach(dcb => { dcb.indeterminate = false; });

    updateGlobalTestInfo();
  }

  function getSelectedScopePool() {
    const sectionCbs = [...testScopeList.querySelectorAll(".scopeSection")];
    if (!sectionCbs.length) return DATA;

    const checked = sectionCbs.filter(cb => cb.checked);
    if (checked.length === 0) return [];

    const keys = new Set(checked.map(cb => scopeKey(cb.dataset.dict, cb.dataset.section)));
    return DATA.filter(w => keys.has(scopeKey(w.dict, w.section || "")));
  }

function openGlobalTestMenu() {
    // Scope list is always visible (no accordion)
    if (testScopeBody) testScopeBody.classList.remove("hidden");

    // Build list each time (DATA may change later)
    renderTestScopeList();

    // Update info when limit changes
    document.querySelectorAll('input[name="testLimit"]').forEach(r => (r.onchange = updateGlobalTestInfo));

    goView(viewGlobalTestMenu);
  }


function updateGlobalTestInfo() {
    const pool = getSelectedScopePool();
    const limit = getSelectedTestLimit();

    // Summary counts
    const sectionCbs = [...testScopeList.querySelectorAll(".scopeSection")];
    const checkedSecs = sectionCbs.filter(cb => cb.checked);
    const dictCount = new Set(checkedSecs.map(cb => cb.dataset.dict)).size;
    const secCount = checkedSecs.length;

    const scopeText = (checkedSecs.length === sectionCbs.length)
      ? "Все словари и разделы"
      : `Выбрано: словарей ${dictCount}, разделов ${secCount}`;

    globalTestInfo.textContent = `Источник: ${scopeText} • Слов: ${pool.length} • Тест: ${Math.min(limit, pool.length)} слов`;
  }

  btnGlobalTest.addEventListener("click", openGlobalTestMenu);
  btnGlobalModeKb.addEventListener("click", () => { testMode = "kb"; startTest(); });
  btnGlobalModeRu.addEventListener("click", () => { testMode = "ru"; startTest(); });

  // ---------- Match words (v9.9) — same source scope as test, but matching pairs
  let matchItems = [];
  let matchRounds = [];
  let matchRoundIndex = 0;
  let matchSolvedCount = 0;
  let matchTotal = 0;
  let matchPosGroups = {};
  let matchFailMap = {};
  let matchSolved = new Set();
  let matchLocked = false;
  let matchSelectedIdx = null;
  let matchSelectedRef = null;

  function getSelectedMatchLimit() {
    const el = document.querySelector('input[name="matchLimit"]:checked');
    const n = el ? Number(el.value) : 40;
    return (n === 20 || n === 40 || n === 80) ? n : 40;
  }

  function renderMatchScopeList() {
    const dicts = dictsFrom(DATA);
    const html = dicts.map(d => {
      const sections = uniq(DATA.filter(w => w.dict === d).map(w => w.section || "")).sort(sortNatural);
      const sectionRows = sections.map(s => {
        const label = s ? sectionTitle(s) : "Без раздела";
        return `
          <label class="scopeSectionRow">
            <input class="scopeCheckbox matchScopeSection" type="checkbox" data-dict="${escapeHtml(d)}" data-section="${escapeHtml(s)}">
            <span>${escapeHtml(label)}</span>
          </label>
        `;
      }).join("");

      return `
        <div class="scopeBlock">
          <label class="scopeDictRow">
            <input class="scopeCheckbox matchScopeDict" type="checkbox" data-dict="${escapeHtml(d)}">
            <span>${escapeHtml(dictTitle(d))}</span>
          </label>
          ${sectionRows}
        </div>
      `;
    }).join("");

    matchScopeList.innerHTML = html || "<div class='hintText'>Словари не найдены.</div>";

    const dictCbs = [...matchScopeList.querySelectorAll(".matchScopeDict")];
    const sectionCbs = [...matchScopeList.querySelectorAll(".matchScopeSection")];

    function updateDictState(dict) {
      const secs = sectionCbs.filter(cb => cb.dataset.dict === dict);
      const checked = secs.filter(cb => cb.checked).length;
      const dictCb = dictCbs.find(cb => cb.dataset.dict === dict);
      if (!dictCb) return;
      dictCb.indeterminate = checked > 0 && checked < secs.length;
      dictCb.checked = secs.length > 0 && checked === secs.length;
    }

    dictCbs.forEach(dictCb => {
      dictCb.addEventListener("change", () => {
        const d = dictCb.dataset.dict;
        sectionCbs.filter(cb => cb.dataset.dict === d).forEach(cb => { cb.checked = dictCb.checked; });
        dictCb.indeterminate = false;
        updateMatchInfo();
      });
    });

    sectionCbs.forEach(secCb => {
      secCb.addEventListener("change", () => {
        updateDictState(secCb.dataset.dict);
        updateMatchInfo();
      });
    });

    // Default: all checked
    dictCbs.forEach(dcb => { dcb.checked = true; });
    sectionCbs.forEach(scb => { scb.checked = true; });
    dictCbs.forEach(dcb => { dcb.indeterminate = false; });

    updateMatchInfo();
  }

  function getSelectedMatchScopePool() {
    const sectionCbs = [...matchScopeList.querySelectorAll(".matchScopeSection")];
    if (!sectionCbs.length) return DATA;

    const checked = sectionCbs.filter(cb => cb.checked);
    if (checked.length === 0) return [];

    const keys = new Set(checked.map(cb => scopeKey(cb.dataset.dict, cb.dataset.section)));
    return DATA.filter(w => keys.has(scopeKey(w.dict, w.section || "")));
  }

  function updateMatchInfo() {
    const pool = getSelectedMatchScopePool();
    const limit = getSelectedMatchLimit();

    const sectionCbs = [...matchScopeList.querySelectorAll(".matchScopeSection")];
    const checkedSecs = sectionCbs.filter(cb => cb.checked);
    const dictCount = new Set(checkedSecs.map(cb => cb.dataset.dict)).size;
    const secCount = checkedSecs.length;

    const scopeText = (checkedSecs.length === sectionCbs.length)
      ? "Все словари и разделы"
      : `Выбрано: словарей ${dictCount}, разделов ${secCount}`;

    if (matchInfo) matchInfo.textContent = `Источник: ${scopeText} • Слов: ${pool.length} • Игра: ${Math.min(limit, pool.length)} слов`;
  }

  function openMatchMenu(){
    if (matchScopeBody) matchScopeBody.classList.remove("hidden");
    renderMatchScopeList();
    document.querySelectorAll('input[name="matchLimit"]').forEach(r => (r.onchange = updateMatchInfo));
    goView(viewMatchMenu);
  }

  function startMatchGame(){
    const pool = getSelectedMatchScopePool();
    const limit = getSelectedMatchLimit();

    matchItems = pool.slice();
    matchSession.inProgress = true;
    matchSession.completed = false;
    matchSession.wordsPool = pool.slice();

    const built = buildWordsByPOSRounds(pool, limit);
    matchRounds = built.rounds;
    matchRoundIndex = 0;

    matchSolvedCount = 0;
    matchTotal = matchRounds.reduce((sum, round) => sum + round.length, 0);
    matchPosGroups = {};
    matchFailMap = {};
    matchSolved = new Set();
    matchLocked = false;
    matchSelectedIdx = null;
    matchSelectedRef = null;
    matchSession.progressData = { solved: 0, total: matchTotal };

    if (matchProgress) {
      matchProgress.textContent = `Пройдено: ${matchSolvedCount}/${matchTotal} слов`;
    }

    goView(viewMatchGame, { push:false });
    nextMatchRound();
  }

  function nextMatchRound(){
    if (!matchColLeft || !matchColRight) return;

    let roundWords = [];
    while (matchRoundIndex < matchRounds.length && roundWords.length === 0) {
      roundWords = matchRounds[matchRoundIndex] || [];
      matchRoundIndex++;
    }

    if (!roundWords.length){
      openMatchResult();
      return;
    }

    // Build columns: left = words, right = translations
    const leftCards = shuffle(roundWords.map(w => ({ kind:"w", id:w.id, text:w.word })));
    const rightCards = shuffle(roundWords.map(w => ({ kind:"t", id:w.id, text:w.trans })));

    // Reset selection
    matchLocked = false;
    matchSelectedIdx = null;
    matchSelectedRef = null;

    matchColLeft.innerHTML = leftCards.map((c) => `
      <button class="matchCard" type="button" data-kind="${c.kind}" data-id="${c.id}">
        ${escapeHtml(c.text)}
      </button>
    `).join("");

    matchColRight.innerHTML = rightCards.map((c) => `
      <button class="matchCard" type="button" data-kind="${c.kind}" data-id="${c.id}">
        ${escapeHtml(c.text)}
      </button>
    `).join("");

    const btns = Array.from(document.querySelectorAll("#matchColLeft .matchCard, #matchColRight .matchCard"));

    function clearSelection(){
      btns.forEach(b => b.classList.remove("selected","wrong"));
      matchSelectedIdx = null;
      matchSelectedRef = null;
    }

    function markSolved(id){
      matchSolved.add(normalizeId(id));
    }

    function bumpFail(id){
      const nid = normalizeId(id);
      if (!nid) return;
      if (matchSolved.has(nid)) return;
      matchFailMap[nid] = (matchFailMap[nid] || 0) + 1;
    }

    function allMatched(){
      return btns.length > 0 && btns.every(b => b.classList.contains("matched"));
    }

    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        if (matchLocked) return;
        if (btn.classList.contains("matched")) return;

        const id = normalizeId(btn.dataset.id);
        const kind = btn.dataset.kind;

        // Toggle off if same selected element
        if (matchSelectedIdx && matchSelectedIdx.el === btn){
          btn.classList.remove("selected");
          matchSelectedIdx = null;
          matchSelectedRef = null;
          return;
        }

        // First pick
        if (!matchSelectedIdx){
          clearSelection();
          btn.classList.add("selected");
          matchSelectedIdx = { el: btn };
          matchSelectedRef = { id, kind };
          return;
        }

        const firstBtn = matchSelectedIdx.el;
        const first = matchSelectedRef;
        const second = { id, kind };

        // If same kind — just switch selection
        if (first && second && first.kind === second.kind){
          clearSelection();
          btn.classList.add("selected");
          matchSelectedIdx = { el: btn };
          matchSelectedRef = second;
          return;
        }

        const isCorrect = first && (first.id === second.id) && (first.kind !== second.kind);

        if (isCorrect){
          firstBtn.classList.remove("selected");
          btn.classList.remove("selected");
          firstBtn.classList.add("matched");
          btn.classList.add("matched");
          markSolved(first.id);

          matchSolvedCount++;
          matchSession.progressData.solved = matchSolvedCount;
          if (matchProgress) {
            matchProgress.textContent = `Пройдено: ${matchSolvedCount}/${matchTotal} слов`;
          }

          matchSelectedIdx = null;
          matchSelectedRef = null;

          if (allMatched()){
            matchLocked = true;
            setTimeout(() => {
              matchLocked = false;
              nextMatchRound();
            }, 350);
          }
        } else {
          bumpFail(first.id);
          bumpFail(second.id);

          matchLocked = true;
          firstBtn.classList.add("wrong");
          btn.classList.add("wrong");
          setTimeout(() => {
            matchLocked = false;
            clearSelection();
          }, 600);
        }
      });
    });
  }

  function openMatchResult(){
    if (!matchResultList) return;

    const problemWords = Object.entries(matchFailMap)
      .filter(([id, count]) => count > 0)
      .map(([id, count]) => {
        const word = DATA.find(w => w.id === id);
        return { ...word, fails: count };
      })
      .filter(w => w && w.id)
      .sort((a,b) => b.fails - a.fails);

    if (!problemWords.length){
      matchResultList.innerHTML = `
        <div class="smallNote noteCenter">
          <div class="noteTitle">Аперим!</div>
          <div class="successNoteLine">✅ Все пары собраны с первого раза</div>
        </div>
      `;
    } else {
      matchResultList.innerHTML = problemWords.map(w => `
        <div class="resultItem analyticsResultItem" data-id="${w.id}">
          <div class="resultMark bad analyticsFailMark" aria-label="Ошибок: ${w.fails}">
            ${STATUS_BAD_ICON_SVG}<span class="analyticsFailCount">${w.fails}</span>
          </div>
          <div class="resultBody">
            <div class="resultWord">${escapeHtml(w.word)}</div>
            <div class="resultLine analyticsTranslation">${escapeHtml(w.trans)}</div>
          </div>
          ${renderStarButton(w.id)}
        </div>
      `).join("");

      matchResultList.querySelectorAll(".starBtn").forEach((btn, i) => {
        const word = problemWords[i];
        btn.addEventListener("click", () => {
          const on = toggleFav(word.id);
          btn.classList.toggle("on", on);
        });
      });
    }

    matchSession.inProgress = false;
    matchSession.completed = true;
    goView(viewMatchResult, { push:false });
  }

  if (btnMatchWords) btnMatchWords.addEventListener("click", openMatchMenu);
  if (btnMatchStart) btnMatchStart.addEventListener("click", startMatchGame);

  function startTest() {
    const pool = getSelectedScopePool();
    const testLimit = getSelectedTestLimit();

    // full scope pool for answer options
    testOptionPool = pool.slice();

    testItems = buildWordsByPOSRounds(pool, testLimit).items;

    testIndex = 0;
    testCorrect = 0;
    testSelected = null;
    testResults = [];
    testSession.inProgress = true;
    testSession.completed = false;
    testSession.wordsPool = pool.slice();
    testSession.progressData = { index: 0, total: testItems.length, correct: 0 };

    btnTestNext.classList.remove("hidden");
    btnTestNext.textContent = "Дальше";
    btnTestNext.disabled = true;

    goView(viewTest);
    renderTestQuestion();
  }

  function pickOptions(correctItem) {
    const correct = testMode === "kb" ? correctItem.trans : correctItem.word;
    const targetPOS = (correctItem.pos || "").trim();

    let pool = testOptionPool.filter(w =>
      w.id !== correctItem.id &&
      (!targetPOS || (w.pos && String(w.pos).trim() === targetPOS))
    );

    if (pool.length < 3) {
      pool = testOptionPool.filter(w => w.id !== correctItem.id);
    }

    const opts = [correct];
    let guard = 0;
    while (opts.length < 4 && guard < 2000) {
      guard++;
      const cand = pool[Math.floor(Math.random() * pool.length)];
      if (!cand) break;
      const text = testMode === "kb" ? cand.trans : cand.word;
      if (!text) continue;
      if (opts.includes(text)) continue;
      opts.push(text);
    }
    return shuffle(opts);
  }

  function renderTestQuestion() {
    if (testItems.length === 0) {
      testTitle.textContent = "Тест";
      testProgress.textContent = "Нет слов для теста.";
      testQuestion.textContent = "Пусто 🤷‍♂️";
      testQuestion.style.display = "";
      testOptions.classList.remove("resultScroll");
      testOptions.innerHTML = "";
      btnTestNext.classList.add("hidden");
      return;
    }

    if (testIndex >= testItems.length) {
      renderTestResults();
      return;
    }

    const item = testItems[testIndex];
    const question = testMode === "kb" ? item.word : item.trans;
    const correctAnswer = testMode === "kb" ? item.trans : item.word;

    testSelected = null;
    btnTestNext.classList.remove("hidden");
    btnTestNext.textContent = "Дальше";
    btnTestNext.disabled = true;

    testTitle.textContent = "Тест: выбрать перевод";
    testProgress.textContent = `Вопрос ${testIndex + 1} из ${testItems.length}`;
    testQuestion.textContent = question;
    testQuestion.style.display = "";

    const options = pickOptions(item);
    testOptions.classList.remove("resultScroll");
    testOptions.innerHTML = options.map(opt => `
      <button class="optionBtn" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>
    `).join("");

    const buttons = Array.from(testOptions.querySelectorAll("button.optionBtn"));
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        testSelected = btn.getAttribute("data-opt");
        buttons.forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        btnTestNext.disabled = !testSelected;
      });
    });

    // Store current correct answer on the container for "Дальше"
    testOptions.setAttribute("data-correct", correctAnswer);
    testOptions.setAttribute("data-itemid", String(item.id));
  }

  function renderTestResults() {
    const pct = Math.round((testCorrect / Math.max(1, testItems.length)) * 100);

    testTitle.textContent = "Результаты теста";
    testProgress.textContent = `Правильно: ${testCorrect}/${testItems.length} (${pct}%)`;
    testQuestion.textContent = "";
    testQuestion.style.display = "none";

    const rows = testResults.map(r => `
      <div class="resultItem" data-id="${r.id}">
        <div class="resultMark ${r.isCorrect ? "ok" : "bad"}">${r.isCorrect ? STATUS_OK_ICON_SVG : STATUS_BAD_ICON_SVG}</div>
        <div class="resultBody">
          <div class="resultWord">${escapeHtml(r.questionText || r.word)}</div>
          <div class="resultLine"><span class="lbl">Правильно:</span> ${escapeHtml(r.correctAnswer)}</div>
          <div class="resultLine"><span class="lbl">Твой ответ:</span> ${escapeHtml(r.userAnswer || "—")}</div>
        </div>
        ${renderStarButton(r.id)}
      </div>
    `).join("");

    testSession.inProgress = false;
    testSession.completed = true;
    testOptions.classList.add("resultScroll");
    testOptions.innerHTML = `
      <div class="resultList">
        ${rows || "<div class='hintText'>Нет результатов.</div>"}
      </div>
      <div class="row">
        <button class="btn primary" id="btnTestAgain2">Пройти ещё раз</button>
      </div>
    `;

    // Wire favorites
    testOptions.querySelectorAll(".resultItem").forEach(row => {
      const id = normalizeId(row.getAttribute("data-id"));
      const star = row.querySelector(".starBtn");
      star.addEventListener("click", () => {
        const on = toggleFav(id);
        star.classList.toggle("on", on);
      });
    });

    const again = document.getElementById("btnTestAgain2");
    if (again) again.addEventListener("click", startTest);

    btnTestNext.classList.add("hidden");
  }

  btnTestNext.addEventListener("click", () => {
    if (testIndex >= testItems.length) return;
    if (!testSelected) return;

    const item = testItems[testIndex];
    const questionText = testMode === "kb" ? item.word : item.trans;
    const correctAnswer = testMode === "kb" ? item.trans : item.word;
    const isCorrect = testSelected === correctAnswer;

    if (isCorrect) testCorrect++;
    testSession.progressData.correct = testCorrect;

    testResults.push({
      id: item.id,
      questionText,
      word: item.word,
      trans: item.trans,
      correctAnswer,
      userAnswer: testSelected,
      isCorrect,
    });

    testIndex++;
    testSession.progressData.index = testIndex;
    renderTestQuestion();
  });




  function openSessionAnalytics() {
    const viewSessionAnalytics = document.getElementById("viewSessionAnalytics");
    const analyticsList = document.getElementById("analyticsList");

    const problemWords = Object.entries(sessionFailMap)
      .filter(([id, count]) => count > 0)
      .map(([id, count]) => {
        const word = DATA.find(w => w.id === id);
        return { ...word, fails: count };
      })
      .sort((a,b) => b.fails - a.fails);

    if (!problemWords.length) {
      analyticsList.innerHTML = `
        <div class="smallNote noteCenter">
          <div class="noteTitle">Аперим!</div>
          <div class="successNoteLine">✅ Не было незнакомых слов</div>
        </div>
      `;
    } else {
      analyticsList.innerHTML = problemWords.map(w => `
        <div class="resultItem analyticsResultItem" data-id="${w.id}">
          <div class="resultMark bad analyticsFailMark" aria-label="Ошибок: ${w.fails}">
            ${STATUS_BAD_ICON_SVG}<span class="analyticsFailCount">${w.fails}</span>
          </div>
          <div class="resultBody">
            <div class="resultWord">${escapeHtml(w.word)}</div>
            <div class="resultLine analyticsTranslation">${escapeHtml(w.trans)}</div>
          </div>
          ${renderStarButton(w.id)}
        </div>
      `).join("");

      analyticsList.querySelectorAll(".starBtn").forEach((btn, i) => {
        const word = problemWords[i];
        btn.addEventListener("click", () => {
          const on = toggleFav(word.id);
          btn.classList.toggle("on", on);
        });
      });
    }

    studySession.inProgress = false;
    studySession.completed = true;
    goView(viewSessionAnalytics, { push:false });
  }

  // ---------- Init
  initUnifiedPanels();

  (async () => {
    DATA = await loadWords();

    if (!Array.isArray(DATA) || !DATA.length) {
      dictsList.innerHTML = "<div class='smallNote'>Нет данных. Проверь таблицу и заголовки: id, dict, section, set, word, trans, example</div>";
      goView(viewDicts);
      return;
    }

    // normalize
    DATA = DATA.map(w => ({
      ...w,
      dict: (w.dict || "Словарь").trim() || "Словарь",
      section: (w.section || "Раздел").trim() || "Раздел",
    }));

    renderDicts();


  const btnOpenLearnMenu = document.getElementById("btnOpenLearnMenu");
  if(btnOpenLearnMenu){
    btnOpenLearnMenu.addEventListener("click", () => {
      goView(viewLearnMenu);
    });
  }
  })();
})();
