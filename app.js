const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const GRID_START = 8 * 60;
const GRID_END = 26 * 60;
const DESKTOP_PX_HOUR = 58;
const MOBILE_PX_HOUR = 62;
const STORAGE_KEY = "rafael-lidia-nyc-plan-v3";
const LEGACY_KEYS = ["rafael-lidia-nyc-plan-v2", "rafael-lidia-nyc-plan-v1"];
const DESKTOP_QUERY = "(min-width: 681px)";

const state = {
  places: [], byId: {}, travel: new Map(), days: [], recommended: {}, plan: {},
  preferences: {rafael:new Set(), lidia:new Set()},
  selectedDayIndex: 0, selectedPlaceId: null,
  search: "", filters: {rafael:false,lidia:false}, theme: "colorful",
  dragging: null
};

let scheduleCache = new Map();
let saveTimer = null;
let dragFrame = 0;
let dragPoint = null;
let lastDropTarget = null;
let press = null;
let lastDesktop = matchMedia(DESKTOP_QUERY).matches;

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    plan:state.plan,
    preferences:{rafael:[...state.preferences.rafael],lidia:[...state.preferences.lidia]},
    selectedDayIndex:state.selectedDayIndex,
    theme:state.theme
  }));
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
    if(p.fixed){
      const fixed=toMin(p.fixed);
      if(arrival<=fixed){wait=fixed-arrival;start=fixed;} else conflict=true;
    }else{
      const opening=toMin(p.open);
      if(start<opening){wait=opening-start;start=opening;}
    }
    const end=start+Number(p.duration||0);
    if(end>toMin(p.close)) conflict=true;
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
      <div class="calendar-meta">${fmtDuration(r.p.duration)} · ${r.p.cost_couple?fmtMoney(r.p.cost_couple):"grátis"}</div>
      ${r.conflict?`<span class="calendar-warning">⚠</span>`:""}
    </article>`;
  });
  return html;
}

function renderDesktopWeek(){
  const board=$("#week-board"); if(!board) return;
  const height=((GRID_END-GRID_START)/60)*DESKTOP_PX_HOUR;
  const headers=state.days.map((d,i)=>{
    const s=scheduleFor(d.date);
    return `<button class="week-day-header ${i===state.selectedDayIndex?"selected":""}" type="button" data-select-date="${d.date}">
      <span class="week-weekday">${d.weekday}</span><strong>${d.label}</strong><small>${fmtDuration(s.totalActivity)} · ${fmtMoney(s.totalCost)}</small>
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
function renderDrawer(){
  const used=currentPlanIds();
  let places=state.places.filter(p=>p.id!=="L01"&&!used.has(p.id));
  if(state.filters.rafael) places=places.filter(p=>indicatedBy(p.id,"rafael"));
  if(state.filters.lidia) places=places.filter(p=>indicatedBy(p.id,"lidia"));
  if(state.search){
    const q=state.search.toLowerCase();
    places=places.filter(p=>(`${p.name} ${p.region} ${p.category}`).toLowerCase().includes(q));
  }
  $("#places-strip").innerHTML=places.map(p=>`<article class="place-card" data-place-id="${p.id}" tabindex="0">
    ${preferenceButtons(p.id)}
    <div class="card-title">${esc(p.name)}</div><div class="card-subtitle">${esc(p.region)} · ${esc(p.category)}</div>
    <div class="mini-meta">${fmtDuration(p.duration)} · ${p.cost_couple?fmtMoney(p.cost_couple)+" casal":"grátis"}</div><div class="drag-hint">segure e arraste ↑</div>
  </article>`).join("")||`<div class="drawer-empty">Nenhum passeio neste filtro.</div>`;
  updateFilterButtons();updateDrawerHelper();
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
  $("#details-duration").textContent=fmtDuration(p.duration);$("#details-cost").textContent=p.cost_couple?fmtMoney(p.cost_couple):"gratuito / sem ingresso";
  $("#details-hours").textContent=`${p.open}–${p.close}`;$("#details-area").textContent=p.region;
  $("#details-map").href=p.source||`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;$("#details-hero").textContent=p.name;
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
function addToPlan(id,index,date=dayDate()){
  const old=findPlanLocation(id);removeFromPlan(id);
  const list=state.plan[date]||[];let target=Math.max(0,Math.min(index,list.length));
  if(old.date===date&&old.index>=0&&old.index<index)target=Math.max(0,target-1);
  list.splice(target,0,id);state.plan[date]=list;
  const idx=state.days.findIndex(d=>d.date===date);if(idx>=0)state.selectedDayIndex=idx;
  invalidateSchedules();
}

function beginDrag(id,source,event){
  if(state.dragging)return;
  state.dragging={id,source,pointerId:event.pointerId,origin:findPlanLocation(id)};
  $("#app").classList.add("dragging");
  const p=state.byId[id],ghost=document.createElement("div");ghost.className="drag-ghost";ghost.id="drag-ghost";
  ghost.innerHTML=`<strong>${esc(p.name)}</strong><span>${fmtDuration(p.duration)} · ${p.cost_couple?fmtMoney(p.cost_couple)+" casal":"grátis"}</span>`;
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
    if(column)addToPlan(id,insertionIndex(column,event.clientY),column.dataset.dropDate);
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
    fetch("./data/places.json").then(r=>r.json()),fetch("./data/travel-times.json").then(r=>r.json()),fetch("./data/recommended-plan.json").then(r=>r.json())
  ]);
  state.places=places;state.byId=Object.fromEntries(places.map(p=>[p.id,p]));
  travelData.forEach(t=>{state.travel.set(travelKey(t.origin_id,t.destination_id),t);state.travel.set(travelKey(t.destination_id,t.origin_id),t);});
  state.days=recommended.days;state.recommended=recommended.plan;state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));restore();

  setupDelegatedInteraction();
  $("#prev-day").addEventListener("click",()=>{const i=Math.max(0,state.selectedDayIndex-1);selectDay(state.days[i].date);});
  $("#next-day").addEventListener("click",()=>{const i=Math.min(state.days.length-1,state.selectedDayIndex+1);selectDay(state.days[i].date);});
  $("#theme-toggle").addEventListener("click",toggleTheme);$("#drawer-theme-toggle").addEventListener("click",toggleTheme);
  $("#load-recommended").addEventListener("click",loadRecommendedPlan);$("#mobile-load-recommended")?.addEventListener("click",loadRecommendedPlan);
  $("#reset-plan").addEventListener("click",()=>{if(confirm("Limpar todo o planner?")){state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));renderAfterPlanChange();}});
  $("#filter-rafael").addEventListener("click",()=>{state.filters.rafael=!state.filters.rafael;renderDrawer();});
  $("#filter-lidia").addEventListener("click",()=>{state.filters.lidia=!state.filters.lidia;renderDrawer();});
  $("#open-search").addEventListener("click",()=>{const row=$("#search-row");row.hidden=!row.hidden;if(!row.hidden)$("#place-search").focus();});
  let searchFrame=0;$("#place-search").addEventListener("input",e=>{state.search=e.target.value;if(searchFrame)cancelAnimationFrame(searchFrame);searchFrame=requestAnimationFrame(()=>{searchFrame=0;renderDrawer();});});
  $("#close-details").addEventListener("click",closeDetails);$("#details-backdrop").addEventListener("click",e=>{if(e.target.id==="details-backdrop")closeDetails();});
  $("#details-rafael").addEventListener("click",()=>{if(state.selectedPlaceId)togglePreference(state.selectedPlaceId,"rafael");});
  $("#details-lidia").addEventListener("click",()=>{if(state.selectedPlaceId)togglePreference(state.selectedPlaceId,"lidia");});
  $("#details-add").addEventListener("click",()=>{const id=state.selectedPlaceId;if(!id)return;addToPlan(id,(state.plan[dayDate()]||[]).length);closeDetails();renderAfterPlanChange();});
  $("#details-remove").addEventListener("click",()=>{const id=state.selectedPlaceId;if(!id)return;removeFromPlan(id);closeDetails();renderAfterPlanChange();});

  matchMedia(DESKTOP_QUERY).addEventListener("change",e=>{if(e.matches!==lastDesktop){lastDesktop=e.matches;renderActivePlanner();}});

  renderAll();
  // V8: não registramos service worker durante desenvolvimento; removemos versões antigas uma vez.
  if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(regs=>regs.forEach(reg=>reg.unregister())).catch(()=>{});}
}

init().catch(err=>{
  console.error(err);
  $("#week-board") && ($("#week-board").innerHTML=`<div class="load-error">Não foi possível carregar os dados do planner.</div>`);
  $("#timeline") && ($("#timeline").innerHTML=`<div class="load-error">Não foi possível carregar os dados do planner.</div>`);
});
