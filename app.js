const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const GRID_START = 8 * 60;       // 08:00
const GRID_END = 26 * 60;        // 02:00 do dia seguinte
const DESKTOP_PX_HOUR = 58;
const MOBILE_PX_HOUR = 62;
const STORAGE_KEY = "rafael-lidia-nyc-plan-v3";
const LEGACY_KEYS = ["rafael-lidia-nyc-plan-v2", "rafael-lidia-nyc-plan-v1"];

const state = {
  places: [],
  byId: {},
  travel: new Map(),
  days: [],
  recommended: {},
  plan: {},
  preferences: { rafael:new Set(), lidia:new Set() },
  selectedDayIndex: 0,
  selectedPlaceId: null,
  dragging: null,
  search: "",
  filters: { rafael:false, lidia:false },
  theme: "colorful"
};

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
const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

function travelKey(a,b){ return `${a}|${b}`; }
function getTravel(a,b){
  if(a===b) return {planning_min:0,estimated_min:0,mode:""};
  return state.travel.get(travelKey(a,b)) || {planning_min:25,estimated_min:20,mode:"deslocamento"};
}
function dayDate(){ return state.days[state.selectedDayIndex]?.date; }
function isInPlan(id){ return Object.values(state.plan).some(ids=>ids.includes(id)); }
function indicatedBy(id,person){ return state.preferences[person].has(id); }
function currentPlanIds(){ return new Set(Object.values(state.plan).flat()); }

function prefGlyph(person,active){
  if(state.theme === "division"){
    if(person === "rafael") return active ? "◆" : "◇";
    return active ? "⬢" : "⬡";
  }
  return active ? "♥" : "♡";
}
function preferenceButtons(id, compact=true){
  const r=indicatedBy(id,"rafael"), l=indicatedBy(id,"lidia");
  return `<div class="preference-badges ${compact?"compact":""}" aria-label="Indicações">
    <button class="preference-button pref-rafael ${r?"active":""}" type="button" data-pref-person="rafael" data-pref-id="${id}" aria-pressed="${r}" title="Rafael">${prefGlyph("rafael",r)}</button>
    <button class="preference-button pref-lidia ${l?"active":""}" type="button" data-pref-person="lidia" data-pref-id="${id}" aria-pressed="${l}" title="Lídia">${prefGlyph("lidia",l)}</button>
  </div>`;
}

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    plan: state.plan,
    preferences:{rafael:[...state.preferences.rafael],lidia:[...state.preferences.lidia]},
    selectedDayIndex:state.selectedDayIndex,
    theme:state.theme
  }));
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
  const ids=state.plan[date]||[];
  let cur=9*60, prev="L01", totalCost=0,totalActivity=0,totalTravel=0;
  const rows=[];
  ids.forEach(id=>{
    const p=state.byId[id]; if(!p) return;
    const t=getTravel(prev,id);
    const travelStart=cur;
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
    cur=end; prev=id;
    totalCost+=Number(p.cost_couple||0);
    totalActivity+=Number(p.duration||0);
  });
  const back=ids.length?getTravel(prev,"L01").planning_min:0;
  totalTravel+=back;
  return {rows,totalCost,totalActivity,totalTravel,returnTravel:back,end:cur+back};
}

function applyTheme(){
  document.body.dataset.theme=state.theme;
  const label=state.theme==="division"?"Tema: Division":"Tema: Colorido";
  if($("#theme-toggle")) $("#theme-toggle").textContent=label;
  if($("#drawer-theme-toggle")) $("#drawer-theme-toggle").textContent=state.theme==="division"?"⬢":"◐";
  updateFilterButtons();
}
function toggleTheme(){ state.theme=state.theme==="colorful"?"division":"colorful"; render(); }

function render(){
  applyTheme();
  renderHeader();
  renderDesktopWeek();
  renderMobileDay();
  renderDrawer();
  save();
}
function renderHeader(){
  let totalCost=0,totalTravel=0,totalCount=0;
  state.days.forEach(d=>{
    const s=scheduleFor(d.date);
    totalCost+=s.totalCost; totalTravel+=s.totalTravel; totalCount+=s.rows.length;
  });
  $("#summary-cost").textContent=fmtMoney(totalCost);
  $("#summary-travel").textContent=fmtDuration(totalTravel);
  $("#summary-count").textContent=totalCount;
}

function hourLabel(min){ return toTime(min); }
function hourAxisHTML(pxPerHour, className=""){
  let html=`<div class="calendar-axis ${className}" style="--px-hour:${pxPerHour}px">`;
  for(let m=GRID_START;m<=GRID_END;m+=60){
    const top=((m-GRID_START)/60)*pxPerHour;
    html+=`<span class="axis-label" style="top:${top}px">${hourLabel(m)}</span>`;
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
function calendarBlocks(date,pxPerHour,mode){
  const s=scheduleFor(date);
  let html="";
  s.rows.forEach((r,i)=>{
    if(r.t.planning_min>=5){
      html+=`<div class="calendar-block transit-block" style="${blockStyle(r.travelStart,r.arrival,pxPerHour)}" title="${esc(r.t.mode)} · ${r.t.planning_min} min">
        <span>${routeIcon(r.t.mode)} ${r.t.planning_min}m</span>
      </div>`;
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
  return {html,summary:s};
}

function renderDesktopWeek(){
  const board=$("#week-board"); if(!board) return;
  const height=((GRID_END-GRID_START)/60)*DESKTOP_PX_HOUR;
  const headers=state.days.map((d,i)=>{
    const s=scheduleFor(d.date);
    return `<button class="week-day-header ${i===state.selectedDayIndex?"selected":""}" type="button" data-select-date="${d.date}">
      <span class="week-weekday">${d.weekday}</span><strong>${d.label}</strong>
      <small>${fmtDuration(s.totalActivity)} · ${fmtMoney(s.totalCost)}</small>
    </button>`;
  }).join("");
  const columns=state.days.map((d,i)=>{
    const b=calendarBlocks(d.date,DESKTOP_PX_HOUR,"desktop");
    return `<div class="calendar-day-column ${i===state.selectedDayIndex?"selected":""}" data-drop-date="${d.date}" style="height:${height}px;--px-hour:${DESKTOP_PX_HOUR}px">${b.html}</div>`;
  }).join("");
  board.innerHTML=`
    <div class="week-grid">
      <div class="week-corner">HORÁRIO</div>${headers}
      ${hourAxisHTML(DESKTOP_PX_HOUR,"week-axis")}${columns}
    </div>`;
  bindCalendarCards(board);
  bindDesktopDaySelectors();
}

function renderMobileDay(){
  const day=state.days[state.selectedDayIndex]; if(!day) return;
  const s=scheduleFor(day.date);
  $("#day-label").textContent=day.label;
  $("#day-weekday").textContent=day.weekday;
  $("#day-time").textContent=fmtDuration(s.totalActivity);
  $("#day-travel").textContent=`${s.totalTravel} min desloc.`;
  $("#day-cost").textContent=`${fmtMoney(s.totalCost)} casal`;
  const axis=$("#mobile-time-axis");
  const timeline=$("#timeline");
  const height=((GRID_END-GRID_START)/60)*MOBILE_PX_HOUR;
  axis.innerHTML=hourAxisHTML(MOBILE_PX_HOUR,"mobile-axis-inner");
  axis.style.height=`${height}px`;
  const blocks=calendarBlocks(day.date,MOBILE_PX_HOUR,"mobile");
  timeline.dataset.dropDate=day.date;
  timeline.style.height=`${height}px`;
  timeline.innerHTML=blocks.html || `<div class="empty-calendar"><strong>Dia livre</strong><span>Segure um passeio na gaveta e arraste para cá.</span></div>`;
  bindCalendarCards(timeline);
}

function bindDesktopDaySelectors(){
  $$('[data-select-date]').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=state.days.findIndex(d=>d.date===btn.dataset.selectDate);
    if(idx>=0){state.selectedDayIndex=idx;render();}
  }));
}

function updateFilterButtons(){
  [["rafael","#filter-rafael"],["lidia","#filter-lidia"]].forEach(([person,selector])=>{
    const btn=$(selector); if(!btn) return;
    const active=state.filters[person];
    btn.setAttribute("aria-pressed",String(active));
    btn.classList.toggle("active",active);
    const glyph=$(".filter-glyph",btn); if(glyph) glyph.textContent=prefGlyph(person,active);
  });
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
  $("#places-strip").innerHTML=places.map(p=>`
    <article class="place-card" data-place-id="${p.id}" tabindex="0">
      ${preferenceButtons(p.id)}
      <div class="card-title">${esc(p.name)}</div>
      <div class="card-subtitle">${esc(p.region)} · ${esc(p.category)}</div>
      <div class="mini-meta">${fmtDuration(p.duration)} · ${p.cost_couple?fmtMoney(p.cost_couple)+" casal":"grátis"}</div>
      <div class="drag-hint">segure e arraste ↑</div>
    </article>`).join("") || `<div class="drawer-empty">Nenhum passeio neste filtro.</div>`;
  bindDrawerCards();
  bindPreferenceButtons();
  updateFilterButtons();
  const helper=$("#drawer-helper");
  if(helper){
    const day=state.days[state.selectedDayIndex];
    helper.textContent=`arraste para qualquer dia · selecionado: ${day?.label||""}`;
  }
}

function togglePreference(id,person){
  const set=state.preferences[person];
  if(set.has(id)) set.delete(id); else set.add(id);
  render();
  if(!$("#details-backdrop").hidden&&state.selectedPlaceId===id) updateDetailsPreferences(id);
}
function bindPreferenceButtons(){
  $$('[data-pref-person][data-pref-id]').forEach(btn=>btn.addEventListener('click',e=>{
    e.stopPropagation(); togglePreference(btn.dataset.prefId,btn.dataset.prefPerson);
  }));
}
function updateDetailsPreferences(id){
  ["rafael","lidia"].forEach(person=>{
    const btn=$(`#details-${person}`); if(!btn) return;
    const active=indicatedBy(id,person);
    btn.setAttribute("aria-pressed",String(active));
    btn.classList.toggle("active",active);
    const glyph=$(".choice-glyph",btn); if(glyph) glyph.textContent=prefGlyph(person,active);
  });
}

function openDetails(id){
  const p=state.byId[id]; if(!p) return;
  state.selectedPlaceId=id;
  $("#details-title").textContent=p.name;
  $("#details-region").textContent=`${p.region} · ${p.category}`;
  $("#details-description").textContent=p.desc;
  $("#details-duration").textContent=fmtDuration(p.duration);
  $("#details-cost").textContent=p.cost_couple?fmtMoney(p.cost_couple):"gratuito / sem ingresso";
  $("#details-hours").textContent=`${p.open}–${p.close}`;
  $("#details-area").textContent=p.region;
  $("#details-map").href=p.source||`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
  $("#details-hero").textContent=p.name;
  $("#details-remove").hidden=!isInPlan(id);
  $("#details-add").hidden=isInPlan(id);
  updateDetailsPreferences(id);
  $("#details-backdrop").hidden=false;
}
function closeDetails(){ $("#details-backdrop").hidden=true;state.selectedPlaceId=null; }

function findPlanLocation(id){
  for(const [date,ids] of Object.entries(state.plan)){
    const index=ids.indexOf(id); if(index>=0) return {date,index};
  }
  return {date:null,index:-1};
}
function removeFromPlan(id){ Object.keys(state.plan).forEach(date=>state.plan[date]=state.plan[date].filter(x=>x!==id)); }
function addToPlan(id,index,date=dayDate()){
  const old=findPlanLocation(id);
  removeFromPlan(id);
  const list=state.plan[date]||[];
  let target=Math.max(0,Math.min(index,list.length));
  if(old.date===date&&old.index>=0&&old.index<index) target=Math.max(0,target-1);
  list.splice(target,0,id); state.plan[date]=list;
  const idx=state.days.findIndex(d=>d.date===date); if(idx>=0) state.selectedDayIndex=idx;
}

function beginDrag(id,source,pointer){
  if(state.dragging) return;
  const origin=findPlanLocation(id);
  state.dragging={id,source,pointerId:pointer.pointerId,origin};
  $("#app").classList.add("dragging");
  const p=state.byId[id];
  const ghost=document.createElement("div");
  ghost.className="drag-ghost";ghost.id="drag-ghost";
  ghost.innerHTML=`<strong>${esc(p.name)}</strong><span>${fmtDuration(p.duration)} · ${p.cost_couple?fmtMoney(p.cost_couple)+" casal":"grátis"}</span>`;
  document.body.appendChild(ghost); moveGhost(pointer.clientX,pointer.clientY);
}
function moveGhost(x,y){const g=$("#drag-ghost");if(g){g.style.left=`${x}px`;g.style.top=`${y}px`;}}
function clearDropHighlights(){ $$(".calendar-day-column,.timeline").forEach(x=>x.classList.remove("drop-target")); }
function updateDrag(pointer){
  if(!state.dragging) return;
  moveGhost(pointer.clientX,pointer.clientY);
  const drawerRect=$("#places-drawer").getBoundingClientRect();
  $("#app").classList.toggle("return-mode",pointer.clientY>=drawerRect.top);
  clearDropHighlights();
  const under=document.elementFromPoint(pointer.clientX,pointer.clientY);
  under?.closest?.("[data-drop-date]")?.classList.add("drop-target");
}
function insertionIndex(column,clientY){
  const cards=$$(".activity-block",column).sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
  for(let i=0;i<cards.length;i++){
    const r=cards[i].getBoundingClientRect();
    if(clientY<r.top+r.height/2) return i;
  }
  return cards.length;
}
function endDrag(pointer){
  if(!state.dragging) return;
  const {id,source}=state.dragging;
  const drawerRect=$("#places-drawer").getBoundingClientRect();
  const under=document.elementFromPoint(pointer.clientX,pointer.clientY);
  if(pointer.clientY>=drawerRect.top){
    if(source==="planner") removeFromPlan(id);
  }else{
    const column=under?.closest?.("[data-drop-date]");
    if(column){
      const date=column.dataset.dropDate;
      addToPlan(id,insertionIndex(column,pointer.clientY),date);
    }
  }
  $("#drag-ghost")?.remove();
  $("#app").classList.remove("dragging","return-mode");
  clearDropHighlights();
  state.dragging=null;render();
}
function bindPressDrag(el,id,source){
  let timer=null,startX=0,startY=0,armed=false,downEvent=null;
  const fine=matchMedia("(pointer:fine)").matches;
  el.addEventListener("pointerdown",e=>{
    if(e.target.closest("button")) return;
    startX=e.clientX;startY=e.clientY;armed=false;downEvent=e;
    const delay=source==="drawer"?(fine?150:340):(fine?100:190);
    timer=setTimeout(()=>{armed=true;el.classList.add("held");beginDrag(id,source,downEvent);},delay);
  });
  el.addEventListener("pointermove",e=>{
    if(!timer&&!armed) return;
    const dist=Math.hypot(e.clientX-startX,e.clientY-startY);
    if(!armed&&dist>10){
      if(fine&&source!=="drawer"){
        clearTimeout(timer);timer=null;armed=true;el.classList.add("held");beginDrag(id,source,e);
      }else{clearTimeout(timer);timer=null;return;}
    }
    if(armed){e.preventDefault();updateDrag(e);}
  });
  const cancel=()=>{clearTimeout(timer);timer=null;el.classList.remove("held");};
  el.addEventListener("pointerup",e=>{
    if(armed){e.preventDefault();el.classList.remove("held");endDrag(e);armed=false;timer=null;}
    else{
      clearTimeout(timer);timer=null;
      if(Math.hypot(e.clientX-startX,e.clientY-startY)<8) openDetails(id);
    }
  });
  el.addEventListener("pointercancel",()=>{
    if(armed){$("#drag-ghost")?.remove();$("#app").classList.remove("dragging","return-mode");state.dragging=null;clearDropHighlights();}
    cancel();armed=false;
  });
}
function bindDrawerCards(){ $$(".place-card").forEach(el=>bindPressDrag(el,el.dataset.placeId,"drawer")); }
function bindCalendarCards(root=document){
  $$(".activity-block",root).forEach(el=>bindPressDrag(el,el.dataset.placeId,"planner"));
  bindPreferenceButtons();
}

function loadRecommendedPlan(){
  state.plan=structuredClone(state.recommended);
  state.selectedDayIndex=0;
  render();
}

async function init(){
  const [places,travelData,recommended]=await Promise.all([
    fetch("./data/places.json").then(r=>r.json()),
    fetch("./data/travel-times.json").then(r=>r.json()),
    fetch("./data/recommended-plan.json").then(r=>r.json())
  ]);
  state.places=places;state.byId=Object.fromEntries(places.map(p=>[p.id,p]));
  travelData.forEach(t=>{
    state.travel.set(travelKey(t.origin_id,t.destination_id),t);
    state.travel.set(travelKey(t.destination_id,t.origin_id),t);
  });
  state.days=recommended.days;state.recommended=recommended.plan;
  state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));
  restore();

  $("#prev-day").addEventListener("click",()=>{state.selectedDayIndex=Math.max(0,state.selectedDayIndex-1);render();});
  $("#next-day").addEventListener("click",()=>{state.selectedDayIndex=Math.min(state.days.length-1,state.selectedDayIndex+1);render();});
  $("#theme-toggle").addEventListener("click",toggleTheme);
  $("#drawer-theme-toggle").addEventListener("click",toggleTheme);
  $("#load-recommended").addEventListener("click",loadRecommendedPlan);
  $("#mobile-load-recommended")?.addEventListener("click",loadRecommendedPlan);
  $("#reset-plan").addEventListener("click",()=>{
    if(confirm("Limpar todo o planner?")){
      state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));render();
    }
  });
  $("#filter-rafael").addEventListener("click",()=>{state.filters.rafael=!state.filters.rafael;renderDrawer();});
  $("#filter-lidia").addEventListener("click",()=>{state.filters.lidia=!state.filters.lidia;renderDrawer();});
  $("#open-search").addEventListener("click",()=>{
    const row=$("#search-row");row.hidden=!row.hidden;if(!row.hidden)$("#place-search").focus();
  });
  $("#place-search").addEventListener("input",e=>{state.search=e.target.value;renderDrawer();});
  $("#close-details").addEventListener("click",closeDetails);
  $("#details-backdrop").addEventListener("click",e=>{if(e.target.id==="details-backdrop")closeDetails();});
  $("#details-rafael").addEventListener("click",()=>{if(state.selectedPlaceId)togglePreference(state.selectedPlaceId,"rafael");});
  $("#details-lidia").addEventListener("click",()=>{if(state.selectedPlaceId)togglePreference(state.selectedPlaceId,"lidia");});
  $("#details-add").addEventListener("click",()=>{
    const id=state.selectedPlaceId;if(!id)return;addToPlan(id,(state.plan[dayDate()]||[]).length);closeDetails();render();
  });
  $("#details-remove").addEventListener("click",()=>{
    const id=state.selectedPlaceId;if(!id)return;removeFromPlan(id);closeDetails();render();
  });

  render();
  // Durante o desenvolvimento, removemos SWs antigos para não misturar versões.
  if("serviceWorker" in navigator){
    navigator.serviceWorker.getRegistrations()
      .then(regs=>regs.forEach(reg=>reg.unregister()))
      .catch(()=>{});
  }

  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").then(reg=>reg.update()).catch(()=>{});
}

init().catch(err=>{
  console.error(err);
  $("#week-board") && ($("#week-board").innerHTML=`<div class="load-error">Não foi possível carregar os dados do planner.</div>`);
  $("#timeline") && ($("#timeline").innerHTML=`<div class="load-error">Não foi possível carregar os dados do planner.</div>`);
});
