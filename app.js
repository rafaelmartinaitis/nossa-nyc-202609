const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const GRID_START = 8 * 60;
const GRID_END = 26 * 60;
const DESKTOP_PX_HOUR = 58;
const MOBILE_PX_HOUR = 62;
const STORAGE_KEY = "rafael-lidia-nyc-plan-v5";
const SYNC_URL = "https://wqjhhklysjqtxucduyah.supabase.co/functions/v1/trip-sync";
const SYNC_SESSION_KEY = "nossa-nyc-sync-password";
const SYNC_POLL_MS = 10000;
const LEGACY_KEYS = ["rafael-lidia-nyc-plan-v2", "rafael-lidia-nyc-plan-v1"];
const DESKTOP_QUERY = "(min-width: 681px)";

const state = {
  places: [], byId: {}, travel: new Map(), days: [], recommended: {}, plan: {},
  preferences: {rafael:new Set(), lidia:new Set()},
  selectedDayIndex: 0, selectedPlaceId: null,
  search: "", filters: {rafael:false,lidia:false}, theme: "colorful",
  dragging: null,
  eventSessions: {},
  anchors: [],
  constraints: {}
};

let scheduleCache = new Map();
let saveTimer = null;
let dragFrame = 0;
let dragPoint = null;
let lastDropTarget = null;
let press = null;
let lastDesktop = matchMedia(DESKTOP_QUERY).matches;

let remoteSaveTimer = null;
let remotePollTimer = null;
let remoteVersion = null;
let lastSyncedJSON = "";
let syncPassword = "";
let syncAuthenticated = false;
let syncSaving = false;
let syncLoading = false;
let syncConflict = null;
let firstRemoteLoadDone = false;


const toMin = value => {
  const [h,m] = String(value).split(":").map(Number);
  return (h||0)*60 + (m||0);
};
const toTime = mins => {
  const v = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(v/60)).padStart(2,"0")}:${String(v%60).padStart(2,"0")}`;
};
const fmtDuration = mins => mins >= 60
  ? `${Math.floor(mins/60)}h${mins%60 ? String(mins%60).padStart(2,"0") : ""}`
  : `${mins} min`;
const fmtMoney = value => `US$ ${Math.round(value).toLocaleString("pt-BR")}`;
const esc = value => String(value ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

const imageCache = new Map();
let imageObserver = null;
let toastTimer = null;

function priceLabel(p){
  if(p.cost_couple === null || p.cost_couple === undefined) return p.cost_note || "preço variável";
  return Number(p.cost_couple) ? `${fmtMoney(p.cost_couple)} casal` : "grátis";
}
function enabledSessions(p,date=null){
  if(!Array.isArray(p.sessions)) return [];
  return p.sessions.filter(s=>!s.disabled && (!date || s.date===date));
}
function selectedSessionFor(id,date=null){
  const p=state.byId[id]; if(!p?.sessions) return null;
  const selected=state.eventSessions[id];
  if(selected){
    const hit=p.sessions.find(s=>s.date===selected.date&&s.start===selected.start&&!s.disabled);
    if(hit && (!date || hit.date===date)) return hit;
  }
  return enabledSessions(p,date)[0] || null;
}
function showToast(message){
  const el=$("#app-toast"); if(!el) return;
  clearTimeout(toastTimer); el.textContent=message; el.hidden=false;
  requestAnimationFrame(()=>el.classList.add("show"));
  toastTimer=setTimeout(()=>{el.classList.remove("show");setTimeout(()=>el.hidden=true,180);},2800);
}
async function resolvePlaceImage(p){
  if(!p) return null;
  if(imageCache.has(p.id)) return imageCache.get(p.id);
  const storageKey=`nyc-img:${p.id}`;
  try{
    const saved=sessionStorage.getItem(storageKey);
    if(saved){const parsed=JSON.parse(saved);imageCache.set(p.id,parsed);return parsed;}
  }catch{}
  const title=p.wiki_title||p.name;
  let result=null;
  try{
    const url=`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ","_"))}`;
    const r=await fetch(url);
    if(r.ok){
      const d=await r.json();
      if(d.thumbnail?.source) result={src:d.thumbnail.source,source:d.content_urls?.desktop?.page||""};
    }
  }catch{}
  if(!result){
    try{
      const q=encodeURIComponent(title);
      const url=`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrlimit=1&prop=pageimages%7Cinfo&inprop=url&piprop=thumbnail&pithumbsize=640&format=json&origin=*`;
      const r=await fetch(url); if(r.ok){
        const d=await r.json(); const page=Object.values(d.query?.pages||{})[0];
        if(page?.thumbnail?.source) result={src:page.thumbnail.source,source:page.fullurl||""};
      }
    }catch{}
  }
  imageCache.set(p.id,result);
  try{sessionStorage.setItem(storageKey,JSON.stringify(result));}catch{}
  return result;
}
async function hydrateImageElement(img){
  if(!img || img.dataset.loaded==="1") return;
  img.dataset.loaded="1";
  const p=state.byId[img.dataset.imageId]; const found=await resolvePlaceImage(p);
  const wrap=img.closest(".place-thumb");
  if(found?.src){img.src=found.src;img.alt=p.name;wrap?.classList.add("has-image");}
  else wrap?.classList.add("no-image");
}
function setupImageObserver(){
  imageObserver?.disconnect();
  imageObserver=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){hydrateImageElement(entry.target);imageObserver.unobserve(entry.target);}
    });
  },{root:$("#places-strip"),rootMargin:"180px"});
  $$("img[data-image-id]").forEach(img=>imageObserver.observe(img));
}
function sessionMeta(p){
  if(!p.sessions) return "";
  const dates=[...new Set(enabledSessions(p).map(s=>s.date.slice(8)))];
  return `horários fixos · ${dates.join(", ")} SET`;
}


function anchorsForDate(date){
  return state.anchors.filter(a=>a.date===date);
}
function constraintForDate(date){
  return state.constraints?.[date] || null;
}
function anchorChipsHTML(date){
  const items=anchorsForDate(date).filter(a=>a.header);
  if(!items.length) return "";
  return `<div class="day-anchor-chips">${items.map(a=>`<span class="day-anchor-chip ${a.kind||""}" title="${esc(a.detail||a.label)}">${a.kind?.includes("flight")?"✈":"⛔"} ${esc(a.label)}</span>`).join("")}</div>`;
}
function fixedAnchorBlocks(date,pxPerHour){
  return anchorsForDate(date).filter(a=>a.start&&a.end).map(a=>{
    const start=toMin(a.start),end=toMin(a.end);
    return `<div class="calendar-block fixed-anchor-block ${a.kind||""}" style="${blockStyle(start,end,pxPerHour)}" aria-label="${esc(a.label)}">
      <span class="fixed-anchor-kicker">FIXO</span>
      <strong>${esc(a.label)}</strong>
      <small>${esc(a.detail||"")}</small>
    </div>`;
  }).join("");
}
function violatesConstraint(date){
  const c=constraintForDate(date);
  if(!c?.return_to_hotel_by) return false;
  invalidateSchedules();
  const s=scheduleFor(date);
  return s.end > toMin(c.return_to_hotel_by);
}

function sharedStatePayload(){
  return {
    schemaVersion:1,
    plan:structuredClone(state.plan),
    preferences:{
      rafael:[...state.preferences.rafael],
      lidia:[...state.preferences.lidia]
    },
    eventSessions:structuredClone(state.eventSessions)
  };
}
function sharedJSON(){ return JSON.stringify(sharedStatePayload()); }

function hasRemotePlannerData(data){
  return !!(data && typeof data==="object" && (
    data.plan ||
    data.preferences ||
    data.eventSessions ||
    data.schemaVersion
  ));
}
function applySharedState(data){
  if(!data || typeof data!=="object") return;
  if(data.plan && typeof data.plan==="object"){
    const next={};
    state.days.forEach(d=>{
      const ids=Array.isArray(data.plan[d.date]) ? data.plan[d.date] : [];
      next[d.date]=ids.filter(id=>state.byId[id]);
    });
    state.plan=next;
  }
  if(data.preferences?.rafael) state.preferences.rafael=new Set(data.preferences.rafael.filter(id=>state.byId[id]));
  if(data.preferences?.lidia) state.preferences.lidia=new Set(data.preferences.lidia.filter(id=>state.byId[id]));
  if(data.eventSessions && typeof data.eventSessions==="object") state.eventSessions=structuredClone(data.eventSessions);
  invalidateSchedules();
}
function syncStatus(kind,text){
  const main=$("#sync-status"), drawer=$("#drawer-sync-status");
  if(main){
    main.dataset.status=kind;
    const label=$("span",main); if(label) label.textContent=text;
  }
  if(drawer){
    drawer.dataset.status=kind;
    drawer.title=text;
  }
}
async function syncRequest(action,extra={}){
  if(!syncPassword) throw new Error("no_password");
  const response=await fetch(SYNC_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,password:syncPassword,...extra})
  });
  let body={};
  try{body=await response.json();}catch{}
  return {response,body};
}
function saveLocalOnly(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    plan:state.plan,
    preferences:{rafael:[...state.preferences.rafael],lidia:[...state.preferences.lidia]},
    selectedDayIndex:state.selectedDayIndex,
    theme:state.theme,
    eventSessions:state.eventSessions
  }));
}
function markSynced(){
  lastSyncedJSON=sharedJSON();
  syncStatus("synced","sincronizado");
}
function hideConflict(){
  syncConflict=null;
  const el=$("#sync-conflict"); if(el) el.hidden=true;
}
function showConflict(remoteState,version,updatedAt){
  syncConflict={remoteState,version,updatedAt};
  const el=$("#sync-conflict"); if(el) el.hidden=false;
  syncStatus("conflict","conflito");
}
async function remoteLoad({background=false}={}){
  if(!syncAuthenticated || syncLoading || syncSaving || syncConflict || !navigator.onLine) return false;
  syncLoading=true;
  if(!background) syncStatus("loading","carregando");
  try{
    const {response,body}=await syncRequest("load");
    if(response.status===401){
      lockAccess("Senha inválida.");
      return false;
    }
    if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);

    const serverVersion=Number(body.version)||1;
    const remoteState=body.state||{};
    const localNow=sharedJSON();
    const localDirty=!!lastSyncedJSON && localNow!==lastSyncedJSON;

    if(!firstRemoteLoadDone){
      firstRemoteLoadDone=true;
      remoteVersion=serverVersion;
      if(hasRemotePlannerData(remoteState)){
        applySharedState(remoteState);
        lastSyncedJSON=sharedJSON();
        saveLocalOnly();
        renderAll();
        markSynced();
      }else{
        // Primeiro uso: o estado já existente neste dispositivo vira a base compartilhada.
        lastSyncedJSON="";
        await remoteSave({force:true});
      }
      return true;
    }

    if(serverVersion>Number(remoteVersion||0)){
      if(localDirty){
        showConflict(remoteState,serverVersion,body.updatedAt);
      }else{
        remoteVersion=serverVersion;
        applySharedState(remoteState);
        lastSyncedJSON=sharedJSON();
        saveLocalOnly();
        renderAll();
        showToast("Planner atualizado por outro dispositivo.");
        markSynced();
      }
    }else if(!localDirty){
      markSynced();
    }
    return true;
  }catch(error){
    console.warn("sync load",error);
    syncStatus("offline",navigator.onLine?"erro de sync":"offline");
    return false;
  }finally{
    syncLoading=false;
  }
}
async function remoteSave({force=false}={}){
  if(!syncAuthenticated || syncSaving || syncConflict || !navigator.onLine) return false;
  const payload=sharedStatePayload();
  const payloadJSON=JSON.stringify(payload);
  if(!force && payloadJSON===lastSyncedJSON) return true;

  if(!Number.isInteger(remoteVersion)){
    await remoteLoad({background:true});
    if(!Number.isInteger(remoteVersion) || syncConflict) return false;
  }

  syncSaving=true;
  syncStatus("saving","salvando");
  try{
    const {response,body}=await syncRequest("save",{state:payload,version:remoteVersion});
    if(response.status===409){
      showConflict(body.state||{},Number(body.version)||remoteVersion,body.updatedAt);
      return false;
    }
    if(response.status===401){
      lockAccess("A sessão expirou. Digite a senha novamente.");
      return false;
    }
    if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
    remoteVersion=Number(body.version)||remoteVersion+1;
    lastSyncedJSON=payloadJSON;
    syncStatus("synced","sincronizado");
    return true;
  }catch(error){
    console.warn("sync save",error);
    syncStatus("offline",navigator.onLine?"não salvo":"offline");
    return false;
  }finally{
    syncSaving=false;
  }
}
function queueRemoteSave(){
  if(!syncAuthenticated) return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer=setTimeout(()=>remoteSave(),500);
}
function startRemotePolling(){
  clearInterval(remotePollTimer);
  remotePollTimer=setInterval(()=>{
    if(document.visibilityState==="visible") remoteLoad({background:true});
  },SYNC_POLL_MS);
}
function stopRemotePolling(){
  clearInterval(remotePollTimer);
  remotePollTimer=null;
}
function unlockAccess(){
  document.body.classList.remove("access-locked");
  $("#access-gate").hidden=true;
}
function lockAccess(message=""){
  syncAuthenticated=false;
  syncPassword="";
  remoteVersion=null;
  firstRemoteLoadDone=false;
  lastSyncedJSON="";
  stopRemotePolling();
  sessionStorage.removeItem(SYNC_SESSION_KEY);
  document.body.classList.add("access-locked");
  $("#access-gate").hidden=false;
  $("#access-message").textContent=message;
  syncStatus("locked","bloqueado");
}
async function authenticateSync(password,{silent=false}={}){
  const clean=String(password||"").trim();
  if(!clean) return false;
  const submit=$("#access-submit"),message=$("#access-message");
  if(submit) submit.disabled=true;
  if(message) message.textContent=silent?"Reconectando…":"Verificando…";
  syncPassword=clean;
  syncStatus("loading","conectando");
  try{
    const {response,body}=await syncRequest("login");
    if(!response.ok){
      syncPassword="";
      if(message) message.textContent=response.status===401?"Senha incorreta.":"Não foi possível entrar.";
      syncStatus("locked","bloqueado");
      return false;
    }
    syncAuthenticated=true;
    sessionStorage.setItem(SYNC_SESSION_KEY,clean);
    unlockAccess();
    remoteVersion=null;
    firstRemoteLoadDone=false;
    await remoteLoad();
    startRemotePolling();
    return true;
  }catch(error){
    console.warn("sync login",error);
    syncPassword="";
    if(message) message.textContent="Sem conexão com o planner compartilhado.";
    syncStatus("offline","offline");
    return false;
  }finally{
    if(submit) submit.disabled=false;
  }
}
function setupSyncUI(){
  $("#access-form").addEventListener("submit",async e=>{
    e.preventDefault();
    await authenticateSync($("#access-password").value);
  });
  $("#conflict-use-remote").addEventListener("click",()=>{
    if(!syncConflict) return;
    remoteVersion=syncConflict.version;
    applySharedState(syncConflict.remoteState);
    hideConflict();
    lastSyncedJSON=sharedJSON();
    saveLocalOnly();
    renderAll();
    markSynced();
    showToast("Versão compartilhada carregada.");
  });
  $("#conflict-keep-local").addEventListener("click",async()=>{
    if(!syncConflict) return;
    remoteVersion=syncConflict.version;
    hideConflict();
    const ok=await remoteSave({force:true});
    if(ok) showToast("Este dispositivo passou a ser a versão compartilhada.");
  });
  window.addEventListener("online",()=>{
    syncStatus("loading","reconectando");
    remoteLoad({background:true});
    queueRemoteSave();
  });
  window.addEventListener("offline",()=>syncStatus("offline","offline"));
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible") remoteLoad({background:true});
  });
}

function isDesktop(){ return matchMedia(DESKTOP_QUERY).matches; }
function travelKey(a,b){ return `${a}|${b}`; }
function getTravel(a,b){
  if(a===b) return {planning_min:0,estimated_min:0,mode:""};
  return state.travel.get(travelKey(a,b)) || {planning_min:25,estimated_min:20,mode:"deslocamento"};
}
function dayDate(){ return state.days[state.selectedDayIndex]?.date; }
function isInPlan(id){ return Object.values(state.plan).some(ids=>ids.includes(id)); }
function indicatedBy(id,person){ return state.preferences[person].has(id); }
function currentPlanIds(){ return new Set(Object.values(state.plan).flat()); }
function invalidateSchedules(){ scheduleCache.clear(); }

function prefGlyph(person,active){
  if(state.theme === "division"){
    if(person === "rafael") return active ? "◆" : "◇";
    return active ? "⬢" : "⬡";
  }
  return active ? "♥" : "♡";
}
function preferenceButtons(id){
  const r=indicatedBy(id,"rafael"), l=indicatedBy(id,"lidia");
  return `<div class="preference-badges compact" aria-label="Indicações">
    <button class="preference-button pref-rafael ${r?"active":""}" type="button" data-pref-person="rafael" data-pref-id="${id}" aria-pressed="${r}" title="Rafael">${prefGlyph("rafael",r)}</button>
    <button class="preference-button pref-lidia ${l?"active":""}" type="button" data-pref-person="lidia" data-pref-id="${id}" aria-pressed="${l}" title="Lídia">${prefGlyph("lidia",l)}</button>
  </div>`;
}

function saveNow(){
  saveLocalOnly();
  if(syncAuthenticated && sharedJSON()!==lastSyncedJSON) queueRemoteSave();
}
function queueSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveNow,120);
}
function restore(){
  try{
    let data=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
    if(!data){
      for(const key of LEGACY_KEYS){
        data=JSON.parse(localStorage.getItem(key)||"null");
        if(data) break;
      }
    }
    if(!data) return;
    if(data.plan) state.plan=data.plan;
    if(data.preferences?.rafael) state.preferences.rafael=new Set(data.preferences.rafael);
    if(data.preferences?.lidia) state.preferences.lidia=new Set(data.preferences.lidia);
    if(Number.isInteger(data.selectedDayIndex)) state.selectedDayIndex=Math.max(0,Math.min(state.days.length-1,data.selectedDayIndex));
    if(data.theme==="colorful"||data.theme==="division") state.theme=data.theme;
    if(data.eventSessions && typeof data.eventSessions==="object") state.eventSessions=data.eventSessions;
  }catch{}
}

function scheduleFor(date){
  if(scheduleCache.has(date)) return scheduleCache.get(date);
  const ids=state.plan[date]||[];
  let cur=9*60,prev="L01",totalCost=0,totalActivity=0,totalTravel=0;
  const rows=[];
  ids.forEach(id=>{
    const p=state.byId[id]; if(!p) return;
    const t=getTravel(prev,id), travelStart=cur;
    totalTravel+=t.planning_min;
    const arrival=cur+t.planning_min;
    let start=arrival,wait=0,conflict=false;
    const eventSession=p.event_type==="scheduled" ? selectedSessionFor(id,date) : null;
    if(p.event_type==="scheduled"){
      if(!eventSession){ conflict=true; }
      else{
        const fixed=toMin(eventSession.start);
        if(arrival<=fixed){wait=fixed-arrival;start=fixed;} else {start=fixed;conflict=true;}
      }
    }else if(p.fixed){
      const fixed=toMin(p.fixed);
      if(arrival<=fixed){wait=fixed-arrival;start=fixed;} else conflict=true;
    }else{
      const opening=toMin(p.open);
      if(start<opening){wait=opening-start;start=opening;}
    }
    const end=start+Number(p.duration||0);
    if(p.event_type!=="scheduled" && end>toMin(p.close)) conflict=true;
    rows.push({id,p,t,travelStart,arrival,start,end,wait,conflict});
    cur=end;prev=id;
    totalCost+=Number(p.cost_couple||0);
    totalActivity+=Number(p.duration||0);
  });
  const back=ids.length?getTravel(prev,"L01").planning_min:0;
  totalTravel+=back;
  const result={rows,totalCost,totalActivity,totalTravel,returnTravel:back,end:cur+back};
  scheduleCache.set(date,result);
  return result;
}

function applyTheme(){
  document.body.dataset.theme=state.theme;
  const btn=$("#theme-toggle"); if(btn) btn.textContent=state.theme==="division"?"Tema: Division":"Tema: Colorido";
  const mobile=$("#drawer-theme-toggle"); if(mobile) mobile.textContent=state.theme==="division"?"⬢":"◐";
  updateFilterButtons();
}
function toggleTheme(){
  state.theme=state.theme==="colorful"?"division":"colorful";
  applyTheme();
  syncAllPreferenceGlyphs();
  queueSave();
}
function syncAllPreferenceGlyphs(){
  $$('[data-pref-person][data-pref-id]').forEach(btn=>{
    const person=btn.dataset.prefPerson,id=btn.dataset.prefId,active=indicatedBy(id,person);
    btn.textContent=prefGlyph(person,active);
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",String(active));
  });
  if(state.selectedPlaceId) updateDetailsPreferences(state.selectedPlaceId);
}

function renderAll(){
  applyTheme();
  renderHeader();
  renderActivePlanner();
  renderDrawer();
}
function renderActivePlanner(){
  if(isDesktop()) renderDesktopWeek(); else renderMobileDay();
}
function renderAfterPlanChange(){
  invalidateSchedules();
  renderHeader();
  renderActivePlanner();
  renderDrawer();
  queueSave();
}
function renderHeader(){
  let totalCost=0,totalTravel=0,totalCount=0;
  state.days.forEach(d=>{
    const s=scheduleFor(d.date);
    totalCost+=s.totalCost;totalTravel+=s.totalTravel;totalCount+=s.rows.length;
  });
  $("#summary-cost").textContent=fmtMoney(totalCost);
  $("#summary-travel").textContent=fmtDuration(totalTravel);
  $("#summary-count").textContent=totalCount;
}

function hourAxisHTML(pxPerHour,className=""){
  let html=`<div class="calendar-axis ${className}" style="--px-hour:${pxPerHour}px">`;
  for(let m=GRID_START;m<=GRID_END;m+=60){
    const top=((m-GRID_START)/60)*pxPerHour;
    html+=`<span class="axis-label" style="top:${top}px">${toTime(m)}</span>`;
  }
  return html+`</div>`;
}
function blockStyle(start,end,pxPerHour){
  const safeStart=Math.max(GRID_START,Math.min(start,GRID_END));
  const safeEnd=Math.max(safeStart+5,Math.min(end,GRID_END));
  const top=((safeStart-GRID_START)/60)*pxPerHour;
  const height=Math.max(10,((safeEnd-safeStart)/60)*pxPerHour);
  return `top:${top}px;height:${height}px`;
}
function routeIcon(mode=""){
  const m=mode.toLowerCase();
  if(m.includes("caminhada")) return "↟";
  if(m.includes("ferry")) return "≋";
  if(m.includes("ônibus")) return "↔";
  if(m.includes("metrô")) return "●";
  return "→";
}
function calendarBlocks(date,pxPerHour){
  const s=scheduleFor(date);
  let html="";
  s.rows.forEach((r,i)=>{
    if(r.t.planning_min>=5){
      html+=`<div class="calendar-block transit-block" style="${blockStyle(r.travelStart,r.arrival,pxPerHour)}" title="${esc(r.t.mode)} · ${r.t.planning_min} min"><span>${routeIcon(r.t.mode)} ${r.t.planning_min}m</span></div>`;
    }
    if(r.wait>=15){
      html+=`<div class="calendar-block free-block" style="${blockStyle(r.arrival,r.start,pxPerHour)}" title="Tempo livre / espera · ${r.wait} min"><span>${r.wait}m livre</span></div>`;
    }
    html+=`<article class="calendar-block activity-block ${r.conflict?"conflict":""}" style="${blockStyle(r.start,r.end,pxPerHour)}" data-place-id="${r.id}" data-plan-index="${i}" data-date="${date}" tabindex="0">
      ${preferenceButtons(r.id)}
      <div class="calendar-time">${toTime(r.start)}–${toTime(r.end)}</div>
      <div class="calendar-title">${esc(r.p.name)}</div>
      <div class="calendar-meta">${fmtDuration(r.p.duration)} · ${priceLabel(r.p)}</div>
      ${r.conflict?`<span class="calendar-warning">⚠</span>`:""}
    </article>`;
  });
  html += fixedAnchorBlocks(date,pxPerHour);
  return html;
}

function renderDesktopWeek(){
  const board=$("#week-board"); if(!board) return;
  const height=((GRID_END-GRID_START)/60)*DESKTOP_PX_HOUR;
  const headers=state.days.map((d,i)=>{
    const s=scheduleFor(d.date);
    return `<button class="week-day-header ${i===state.selectedDayIndex?"selected":""}" type="button" data-select-date="${d.date}">
      <span class="week-weekday">${d.weekday}</span><strong>${d.label}</strong><small>${fmtDuration(s.totalActivity)} · ${fmtMoney(s.totalCost)}</small>
      ${anchorChipsHTML(d.date)}
    </button>`;
  }).join("");
  const columns=state.days.map((d,i)=>`<div class="calendar-day-column ${i===state.selectedDayIndex?"selected":""}" data-drop-date="${d.date}" style="height:${height}px;--px-hour:${DESKTOP_PX_HOUR}px">${calendarBlocks(d.date,DESKTOP_PX_HOUR)}</div>`).join("");
  board.innerHTML=`<div class="week-grid"><div class="week-corner">HORÁRIO</div>${headers}${hourAxisHTML(DESKTOP_PX_HOUR,"week-axis")}${columns}</div>`;
}
function renderMobileDay(){
  const day=state.days[state.selectedDayIndex]; if(!day) return;
  const s=scheduleFor(day.date), height=((GRID_END-GRID_START)/60)*MOBILE_PX_HOUR;
  $("#day-label").textContent=day.label;
  $("#day-weekday").textContent=day.weekday;
  $("#day-time").textContent=fmtDuration(s.totalActivity);
  $("#day-travel").textContent=`${s.totalTravel} min desloc.`;
  $("#day-cost").textContent=`${fmtMoney(s.totalCost)} casal`;
  const mobileAnchors=$("#mobile-day-anchors");
  if(mobileAnchors) mobileAnchors.innerHTML=anchorChipsHTML(day.date);
  const axis=$("#mobile-time-axis"), timeline=$("#timeline");
  axis.innerHTML=hourAxisHTML(MOBILE_PX_HOUR,"mobile-axis-inner");axis.style.height=`${height}px`;
  timeline.dataset.dropDate=day.date;timeline.style.height=`${height}px`;
  timeline.innerHTML=calendarBlocks(day.date,MOBILE_PX_HOUR)||`<div class="empty-calendar"><strong>Dia livre</strong><span>Segure um passeio na gaveta e arraste para cá.</span></div>`;
}

function selectDay(date){
  const idx=state.days.findIndex(d=>d.date===date); if(idx<0||idx===state.selectedDayIndex) return;
  state.selectedDayIndex=idx;
  if(isDesktop()){
    $$('.week-day-header.selected,.calendar-day-column.selected').forEach(el=>el.classList.remove('selected'));
    $(`[data-select-date="${date}"]`)?.classList.add('selected');
    $(`[data-drop-date="${date}"]`)?.classList.add('selected');
    updateDrawerHelper();
  }else renderMobileDay();
  queueSave();
}

function updateFilterButtons(){
  [["rafael","#filter-rafael"],["lidia","#filter-lidia"]].forEach(([person,selector])=>{
    const btn=$(selector);if(!btn)return;
    const active=state.filters[person];
    btn.setAttribute("aria-pressed",String(active));btn.classList.toggle("active",active);
    const glyph=$(".filter-glyph",btn);if(glyph)glyph.textContent=prefGlyph(person,active);
  });
}
function updateDrawerHelper(){
  const helper=$("#drawer-helper"),day=state.days[state.selectedDayIndex];
  if(helper) helper.textContent=`arraste para qualquer dia · selecionado: ${day?.label||""}`;
}
function drawerReferencePlaceId(){
  const date=dayDate();
  const ids=state.plan[date]||[];
  return ids.length ? ids[ids.length-1] : "L01";
}
function drawerDistanceMinutes(placeId){
  return getTravel(drawerReferencePlaceId(),placeId)?.planning_min ?? 9999;
}
function distanceSortLabel(){
  const refId=drawerReferencePlaceId();
  const ref=state.byId[refId];
  return refId==="L01" ? "do hotel" : `de ${ref?.name||"última parada"}`;
}

function renderDrawer(){
  const used=currentPlanIds();
  let places=state.places.filter(p=>p.id!=="L01"&&!used.has(p.id));
  if(state.filters.rafael) places=places.filter(p=>indicatedBy(p.id,"rafael"));
  if(state.filters.lidia) places=places.filter(p=>indicatedBy(p.id,"lidia"));
  if(state.sortByDistance){
    places=places.slice().sort((a,b)=>{
      const da=drawerDistanceMinutes(a.id), db=drawerDistanceMinutes(b.id);
      if(da!==db) return da-db;
      return a.name.localeCompare(b.name,"pt-BR");
    });
  }
  if(state.search){
    const q=state.search.toLowerCase();
    places=places.filter(p=>{
      const haystack=[
        p.name,p.region,p.category,p.desc,p.game_style,p.immersive_type,p.milestone_type,
        ...(p.tags||[]),...(p.shopping_targets||[])
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }
  $("#places-strip").innerHTML=places.map(p=>`<article class="place-card ${p.event_type==="scheduled"?"scheduled-card":""} ${p.unavailable_on_trip?"unavailable-card":""}" data-place-id="${p.id}" tabindex="0">
    <div class="place-thumb"><img data-image-id="${p.id}" alt="" loading="lazy"><span>${esc(p.name).slice(0,1)}</span></div>
    <div class="place-card-content">
      ${preferenceButtons(p.id)}
      <button class="details-icon" type="button" data-open-details="${p.id}" aria-label="Ver detalhes de ${esc(p.name)}" title="Ver detalhes">ⓘ</button>
      <div class="card-title">${esc(p.name)}</div><div class="card-subtitle">${esc(p.region)} · ${esc(p.category)}</div>
      <div class="mini-meta">${p.unavailable_on_trip?"indisponível nas datas":(p.event_type==="scheduled"?sessionMeta(p):`${fmtDuration(p.duration)} · ${priceLabel(p)}`)}${state.sortByDistance?` · ${drawerDistanceMinutes(p.id)} min ${distanceSortLabel()}`:""}</div>
      <div class="drag-hint">${p.event_type==="scheduled"?"arraste para um dia com sessão ↑":"segure e arraste ↑"}</div>
    </div>
  </article>`).join("")||`<div class="drawer-empty">Nenhum passeio neste filtro.</div>`;
  updateFilterButtons();updateDrawerHelper();setupImageObserver();
  const sortBtn=$("#sort-distance");
  if(sortBtn){
    sortBtn.setAttribute("aria-pressed",String(state.sortByDistance));
    sortBtn.classList.toggle("active",state.sortByDistance);
    sortBtn.title=state.sortByDistance
      ? `Ordenado por proximidade ${distanceSortLabel()}`
      : "Ordenar por proximidade ao último ponto do dia";
  }
}

function togglePreference(id,person){
  const set=state.preferences[person];
  if(set.has(id))set.delete(id);else set.add(id);
  if(state.filters.rafael||state.filters.lidia) renderDrawer();
  else syncAllPreferenceGlyphs();
  if(state.selectedPlaceId===id) updateDetailsPreferences(id);
  queueSave();
}
function updateDetailsPreferences(id){
  ["rafael","lidia"].forEach(person=>{
    const btn=$(`#details-${person}`);if(!btn)return;
    const active=indicatedBy(id,person);btn.setAttribute("aria-pressed",String(active));btn.classList.toggle("active",active);
    const glyph=$(".choice-glyph",btn);if(glyph)glyph.textContent=prefGlyph(person,active);
  });
}
function openDetails(id){
  const p=state.byId[id];if(!p)return;
  state.selectedPlaceId=id;
  $("#details-title").textContent=p.name;$("#details-region").textContent=`${p.region} · ${p.category}`;$("#details-description").textContent=p.desc;
  $("#details-duration").textContent=fmtDuration(p.duration);$("#details-cost").textContent=priceLabel(p);
  $("#details-hours").textContent=p.event_type==="scheduled"?"sessões fixas":`${p.open}–${p.close}`;$("#details-area").textContent=p.region;
  $("#details-map").href=p.source||`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
  const hero=$("#details-hero"); hero.style.backgroundImage=""; $("#details-hero-label").textContent=p.name;
  const credit=$("#details-image-source"); credit.hidden=true;
  resolvePlaceImage(p).then(found=>{if(state.selectedPlaceId!==id||!found?.src)return;hero.style.backgroundImage=`linear-gradient(180deg,rgba(10,20,24,.05),rgba(10,20,24,.58)),url("${found.src}")`;if(found.source){credit.href=found.source;credit.hidden=false;}});
  const panel=$("#details-session-panel"),options=$("#details-sessions");
  if(p.event_type==="scheduled"){
    panel.hidden=false;
    const selected=state.eventSessions[id];
    options.innerHTML=p.sessions.map(s=>`<button type="button" class="session-option ${selected?.date===s.date&&selected?.start===s.start?"selected":""}" data-session-id="${id}" data-session-date="${s.date}" data-session-start="${s.start}" ${s.disabled?"disabled":""}>${esc(s.label)}${s.note?`<small>${esc(s.note)}</small>`:""}</button>`).join("");
  }else{panel.hidden=true;options.innerHTML="";}
  $("#details-remove").hidden=!isInPlan(id);$("#details-add").hidden=isInPlan(id);updateDetailsPreferences(id);$("#details-backdrop").hidden=false;
}
function closeDetails(){$("#details-backdrop").hidden=true;state.selectedPlaceId=null;}

function findPlanLocation(id){
  for(const [date,ids] of Object.entries(state.plan)){const index=ids.indexOf(id);if(index>=0)return{date,index};}
  return{date:null,index:-1};
}
function removeFromPlan(id){
  Object.keys(state.plan).forEach(date=>{const i=state.plan[date].indexOf(id);if(i>=0)state.plan[date].splice(i,1);});
  invalidateSchedules();
}
function addToPlan(id,index,date=dayDate(),sessionStart=null){
  const p=state.byId[id];
  if(p?.unavailable_on_trip){
    showToast(p.unavailable_reason || `${p.name} não está disponível durante a viagem.`);
    return false;
  }
  const planSnapshot=structuredClone(state.plan);
  const sessionSnapshot=structuredClone(state.eventSessions);

  if(p?.event_type==="scheduled"){
    const valid=enabledSessions(p,date);
    if(!valid.length){showToast(`${p.name} não tem sessão disponível em ${date.slice(8)}/09.`);return false;}
    let chosen=sessionStart ? valid.find(s=>s.start===sessionStart) : selectedSessionFor(id,date);
    if(!chosen) chosen=valid[0];
    state.eventSessions[id]={date:chosen.date,start:chosen.start};
  }

  const old=findPlanLocation(id);removeFromPlan(id);
  const list=state.plan[date]||[];let target=Math.max(0,Math.min(index,list.length));
  if(old.date===date&&old.index>=0&&old.index<index)target=Math.max(0,target-1);
  list.splice(target,0,id);state.plan[date]=list;
  invalidateSchedules();

  if(violatesConstraint(date)){
    const c=constraintForDate(date);
    state.plan=planSnapshot;
    state.eventSessions=sessionSnapshot;
    invalidateSchedules();
    showToast(c?.reason || "Este item ultrapassa uma janela fixa da viagem.");
    return false;
  }

  const idx=state.days.findIndex(d=>d.date===date);if(idx>=0)state.selectedDayIndex=idx;
  return true;
}

function beginDrag(id,source,event){
  if(state.dragging)return;
  state.dragging={id,source,pointerId:event.pointerId,origin:findPlanLocation(id)};
  $("#app").classList.add("dragging");
  const p=state.byId[id],ghost=document.createElement("div");ghost.className="drag-ghost";ghost.id="drag-ghost";
  ghost.innerHTML=`<strong>${esc(p.name)}</strong><span>${fmtDuration(p.duration)} · ${priceLabel(p)}</span>`;
  document.body.appendChild(ghost);moveGhost(event.clientX,event.clientY);
  try{press?.el?.setPointerCapture(event.pointerId);}catch{}
}
function moveGhost(x,y){const g=$("#drag-ghost");if(g){g.style.transform=`translate3d(${x}px,${y}px,0)`;}}
function setDropTarget(el){
  if(lastDropTarget===el)return;
  lastDropTarget?.classList.remove("drop-target");lastDropTarget=el;lastDropTarget?.classList.add("drop-target");
}
function processDragPoint(x,y){
  if(!state.dragging)return;
  moveGhost(x,y);
  const drawer=$("#places-drawer"),drawerTop=drawer.getBoundingClientRect().top;
  $("#app").classList.toggle("return-mode",y>=drawerTop);
  if(y>=drawerTop){setDropTarget(null);return;}
  const under=document.elementFromPoint(x,y);setDropTarget(under?.closest?.("[data-drop-date]")||null);
}
function scheduleDragFrame(x,y){
  dragPoint={x,y};
  if(dragFrame)return;
  dragFrame=requestAnimationFrame(()=>{dragFrame=0;const p=dragPoint;dragPoint=null;if(p)processDragPoint(p.x,p.y);});
}
function insertionIndex(column,clientY){
  const cards=$$(".activity-block",column);
  for(let i=0;i<cards.length;i++){
    const r=cards[i].getBoundingClientRect();if(clientY<r.top+r.height/2)return i;
  }
  return cards.length;
}
function endDrag(event){
  if(!state.dragging)return;
  if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;dragPoint=null;}
  const {id,source}=state.dragging,drawerTop=$("#places-drawer").getBoundingClientRect().top;
  const under=document.elementFromPoint(event.clientX,event.clientY);
  if(event.clientY>=drawerTop){if(source==="planner")removeFromPlan(id);}
  else{
    const column=under?.closest?.("[data-drop-date]");
    if(column){
      const date=column.dataset.dropDate,p=state.byId[id];
      const ok=addToPlan(id,insertionIndex(column,event.clientY),date);
      if(ok && p?.event_type==="scheduled" && enabledSessions(p,date).length>1){
        setTimeout(()=>openDetails(id),0);
      }
    }
  }
  $("#drag-ghost")?.remove();$("#app").classList.remove("dragging","return-mode");setDropTarget(null);state.dragging=null;renderAfterPlanChange();
}
function cancelPress(){
  if(press?.timer)clearTimeout(press.timer);
  press?.el?.classList.remove("held");press=null;
}

function setupDelegatedInteraction(){
  document.addEventListener("click",e=>{
    const pref=e.target.closest("[data-pref-person][data-pref-id]");
    if(pref){e.stopPropagation();togglePreference(pref.dataset.prefId,pref.dataset.prefPerson);return;}
    const details=e.target.closest("[data-open-details]");
    if(details){openDetails(details.dataset.openDetails);return;}
    const session=e.target.closest("[data-session-id]");
    if(session && !session.disabled){
      const id=session.dataset.sessionId,date=session.dataset.sessionDate,start=session.dataset.sessionStart;
      state.eventSessions[id]={date,start};
      if(isInPlan(id)){
        const loc=findPlanLocation(id); addToPlan(id,loc.index,date,start); renderAfterPlanChange();
      }
      openDetails(id); queueSave(); return;
    }
    const day=e.target.closest("[data-select-date]");
    if(day){selectDay(day.dataset.selectDate);return;}
  });

  document.addEventListener("pointerdown",e=>{
    if(e.button!==undefined&&e.button!==0)return;
    if(e.target.closest("button,a,input"))return;
    const el=e.target.closest(".place-card,.activity-block");if(!el)return;
    const source=el.classList.contains("place-card")?"drawer":"planner";
    const fine=matchMedia("(pointer:fine)").matches;
    press={el,id:el.dataset.placeId,source,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,armed:false,fine,timer:null};
    const delay=source==="drawer"?(fine?130:320):(fine?80:180);
    press.timer=setTimeout(()=>{
      if(!press)return;press.armed=true;press.el.classList.add("held");beginDrag(press.id,press.source,e);
    },delay);
  },{passive:true});

  document.addEventListener("pointermove",e=>{
    if(!press||e.pointerId!==press.pointerId)return;
    const dist=Math.hypot(e.clientX-press.startX,e.clientY-press.startY);
    if(!press.armed&&dist>10){
      if(press.fine&&press.source!=="drawer"){
        clearTimeout(press.timer);press.timer=null;press.armed=true;press.el.classList.add("held");beginDrag(press.id,press.source,e);
      }else{cancelPress();return;}
    }
    if(press?.armed){e.preventDefault();scheduleDragFrame(e.clientX,e.clientY);}
  },{passive:false});

  document.addEventListener("pointerup",e=>{
    if(!press||e.pointerId!==press.pointerId)return;
    const snapshot=press;
    if(snapshot.timer)clearTimeout(snapshot.timer);
    snapshot.el.classList.remove("held");
    press=null;
    if(snapshot.armed){e.preventDefault();endDrag(e);}
    else if(Math.hypot(e.clientX-snapshot.startX,e.clientY-snapshot.startY)<8)openDetails(snapshot.id);
  },{passive:false});

  document.addEventListener("pointercancel",()=>{
    if(state.dragging){$("#drag-ghost")?.remove();$("#app").classList.remove("dragging","return-mode");state.dragging=null;setDropTarget(null);}
    cancelPress();
  });
}

function loadRecommendedPlan(){state.plan=structuredClone(state.recommended);state.selectedDayIndex=0;renderAfterPlanChange();}

async function init(){
  const [places,travelData,recommended]=await Promise.all([
    fetch("./data/places.json?v=15").then(r=>r.json()),fetch("./data/travel-times.json?v=15").then(r=>r.json()),fetch("./data/recommended-plan.json?v=15").then(r=>r.json())
  ]);
  state.places=places;state.byId=Object.fromEntries(places.map(p=>[p.id,p]));
  travelData.forEach(t=>{state.travel.set(travelKey(t.origin_id,t.destination_id),t);state.travel.set(travelKey(t.destination_id,t.origin_id),t);});
  state.days=recommended.days;state.recommended=recommended.plan;state.anchors=recommended.anchors||[];state.constraints=recommended.constraints||{};state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));restore();

  setupSyncUI();
  setupDelegatedInteraction();
  $("#prev-day").addEventListener("click",()=>{const i=Math.max(0,state.selectedDayIndex-1);selectDay(state.days[i].date);});
  $("#next-day").addEventListener("click",()=>{const i=Math.min(state.days.length-1,state.selectedDayIndex+1);selectDay(state.days[i].date);});
  $("#theme-toggle").addEventListener("click",toggleTheme);$("#drawer-theme-toggle").addEventListener("click",toggleTheme);
  $("#load-recommended").addEventListener("click",loadRecommendedPlan);$("#mobile-load-recommended")?.addEventListener("click",loadRecommendedPlan);
  $("#reset-plan").addEventListener("click",()=>{if(confirm("Limpar todo o planner?")){state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));renderAfterPlanChange();}});
  $("#filter-rafael").addEventListener("click",()=>{state.filters.rafael=!state.filters.rafael;renderDrawer();});
  $("#filter-lidia").addEventListener("click",()=>{state.filters.lidia=!state.filters.lidia;renderDrawer();});
  $("#sort-distance").addEventListener("click",()=>{
    state.sortByDistance=!state.sortByDistance;
    const btn=$("#sort-distance");
    btn.setAttribute("aria-pressed",String(state.sortByDistance));
    btn.classList.toggle("active",state.sortByDistance);
    btn.title=state.sortByDistance
      ? `Ordenado por proximidade ${distanceSortLabel()}`
      : "Ordenar por proximidade ao último ponto do dia";
    renderDrawer();
  });
  $("#open-search").addEventListener("click",()=>{const row=$("#search-row");row.hidden=!row.hidden;if(!row.hidden)$("#place-search").focus();});
  let searchFrame=0;$("#place-search").addEventListener("input",e=>{state.search=e.target.value;if(searchFrame)cancelAnimationFrame(searchFrame);searchFrame=requestAnimationFrame(()=>{searchFrame=0;renderDrawer();});});
  $("#close-details").addEventListener("click",closeDetails);$("#details-backdrop").addEventListener("click",e=>{if(e.target.id==="details-backdrop")closeDetails();});
  $("#details-rafael").addEventListener("click",()=>{if(state.selectedPlaceId)togglePreference(state.selectedPlaceId,"rafael");});
  $("#details-lidia").addEventListener("click",()=>{if(state.selectedPlaceId)togglePreference(state.selectedPlaceId,"lidia");});
  $("#details-add").addEventListener("click",()=>{
    const id=state.selectedPlaceId;if(!id)return;const p=state.byId[id];
    let date=dayDate(),start=null;
    if(p?.event_type==="scheduled"){
      const selected=state.eventSessions[id];
      if(selected){date=selected.date;start=selected.start;}
      else{
        const candidate=enabledSessions(p,date)[0]||enabledSessions(p)[0];
        if(!candidate){showToast("Nenhuma sessão disponível.");return;}
        date=candidate.date;start=candidate.start;
      }
    }
    if(addToPlan(id,(state.plan[date]||[]).length,date,start)){closeDetails();renderAfterPlanChange();}
  });
  $("#details-remove").addEventListener("click",()=>{const id=state.selectedPlaceId;if(!id)return;removeFromPlan(id);closeDetails();renderAfterPlanChange();});

  matchMedia(DESKTOP_QUERY).addEventListener("change",e=>{if(e.matches!==lastDesktop){lastDesktop=e.matches;renderActivePlanner();}});

  renderAll();

  const remembered=sessionStorage.getItem(SYNC_SESSION_KEY);
  if(remembered){
    $("#access-password").value=remembered;
    await authenticateSync(remembered,{silent:true});
  }else{
    syncStatus("locked","bloqueado");
    setTimeout(()=>$("#access-password")?.focus(),50);
  }

  // Enquanto desenvolvemos, removemos SWs antigos para evitar versões misturadas.
  if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(regs=>regs.forEach(reg=>reg.unregister())).catch(()=>{});}
}

init().catch(err=>{
  console.error(err);
  $("#week-board") && ($("#week-board").innerHTML=`<div class="load-error">Não foi possível carregar os dados do planner.</div>`);
  $("#timeline") && ($("#timeline").innerHTML=`<div class="load-error">Não foi possível carregar os dados do planner.</div>`);
});
