
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const state = {
  places: [],
  byId: {},
  travel: new Map(),
  days: [],
  recommended: {},
  plan: {},
  preferences: {
    rafael: new Set(),
    lidia: new Set()
  },
  selectedDayIndex: 0,
  selectedPlaceId: null,
  dragging: null,
  search: "",
  filters: {
    rafael: false,
    lidia: false
  },
  theme: "colorful"
};

const STORAGE_KEY = "rafael-lidia-nyc-plan-v2";
const LEGACY_KEY = "rafael-lidia-nyc-plan-v1";

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

function travelKey(a,b){ return `${a}|${b}`; }
function getTravel(a,b){
  if(a === b) return {planning_min:0, estimated_min:0, mode:""};
  return state.travel.get(travelKey(a,b)) || {planning_min:25, estimated_min:20, mode:"deslocamento"};
}
function dayDate(){ return state.days[state.selectedDayIndex]?.date; }
function isInPlan(id){ return Object.values(state.plan).some(ids=>ids.includes(id)); }
function indicatedBy(id, person){ return state.preferences[person].has(id); }

function prefGlyph(person, active){
  if(state.theme === "division"){
    if(person === "rafael") return active ? "◆" : "◇";
    return active ? "⬢" : "⬡";
  }
  return active ? "♥" : "♡";
}

function preferenceButtons(id, compact=true){
  const r = indicatedBy(id,"rafael");
  const l = indicatedBy(id,"lidia");
  return `<div class="preference-badges ${compact?"compact":""}" aria-label="Indicações">
    <button class="preference-button pref-rafael ${r?"active":""}" type="button" data-pref-person="rafael" data-pref-id="${id}" aria-pressed="${r}" aria-label="${r?"Remover":"Marcar"} indicação de Rafael">${prefGlyph("rafael",r)}</button>
    <button class="preference-button pref-lidia ${l?"active":""}" type="button" data-pref-person="lidia" data-pref-id="${id}" aria-pressed="${l}" aria-label="${l?"Remover":"Marcar"} indicação de Lídia">${prefGlyph("lidia",l)}</button>
  </div>`;
}

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    plan: state.plan,
    preferences: {
      rafael: [...state.preferences.rafael],
      lidia: [...state.preferences.lidia]
    },
    selectedDayIndex: state.selectedDayIndex,
    theme: state.theme
  }));
}

function restore(){
  try{
    let data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if(!data){
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if(legacy){
        data = {
          plan: legacy.plan,
          selectedDayIndex: legacy.selectedDayIndex,
          theme: legacy.theme
        };
      }
    }
    if(!data) return;
    if(data.plan) state.plan = data.plan;
    if(data.preferences?.rafael) state.preferences.rafael = new Set(data.preferences.rafael);
    if(data.preferences?.lidia) state.preferences.lidia = new Set(data.preferences.lidia);
    if(Number.isInteger(data.selectedDayIndex)){
      state.selectedDayIndex = Math.max(0, Math.min(state.days.length-1, data.selectedDayIndex));
    }
    if(data.theme === "colorful" || data.theme === "division") state.theme = data.theme;
  }catch{}
}

function scheduleFor(date){
  const ids = state.plan[date] || [];
  let cur=9*60, prev="L01", totalCost=0, totalActivity=0, totalTravel=0;
  const rows=[];
  ids.forEach(id=>{
    const p=state.byId[id];
    if(!p) return;
    const t=getTravel(prev,id);
    totalTravel+=t.planning_min;
    let arrival=cur+t.planning_min, start=arrival, wait=0, conflict=false;
    if(p.fixed){
      const fixed=toMin(p.fixed);
      if(arrival<=fixed){wait=fixed-arrival;start=fixed;} else conflict=true;
    }else{
      const opening=toMin(p.open);
      if(start<opening){wait=opening-start;start=opening;}
    }
    const end=start+p.duration;
    if(end>toMin(p.close)) conflict=true;
    rows.push({id,p,t,start,end,wait,conflict});
    cur=end;
    prev=id;
    totalCost+=Number(p.cost_couple||0);
    totalActivity+=Number(p.duration||0);
  });
  const back=ids.length?getTravel(prev,"L01").planning_min:0;
  totalTravel+=back;
  return {rows,totalCost,totalActivity,totalTravel,returnTravel:back};
}

function currentPlanIds(){ return new Set(Object.values(state.plan).flat()); }

function loadRecommendedPlan(){
  state.plan=structuredClone(state.recommended);
  state.selectedDayIndex=0;
  render();
}

function applyTheme(){
  document.body.dataset.theme=state.theme;
  const label=state.theme==="division"?"Tema: Division":"Tema: Colorido";
  $("#theme-toggle") && ($("#theme-toggle").textContent=label);
  $("#drawer-theme-toggle") && ($("#drawer-theme-toggle").textContent=state.theme==="division"?"⬢":"◐");
  updateFilterButtons();
}
function toggleTheme(){
  state.theme=state.theme==="colorful"?"division":"colorful";
  applyTheme();
  render();
}
function updateFilterButtons(){
  [["rafael","#filter-rafael"],["lidia","#filter-lidia"]].forEach(([person,selector])=>{
    const btn=$(selector);
    if(!btn) return;
    const active=state.filters[person];
    btn.setAttribute("aria-pressed",String(active));
    btn.classList.toggle("active",active);
    const glyph=$(".filter-glyph",btn);
    if(glyph) glyph.textContent=prefGlyph(person,active);
  });
}

function render(){
  applyTheme();
  renderHeader();
  renderPlanner();
  renderDrawer();
  save();
}
function renderHeader(){
  let totalCost=0,totalTravel=0,totalCount=0;
  state.days.forEach(d=>{
    const s=scheduleFor(d.date);
    totalCost+=s.totalCost;
    totalTravel+=s.totalTravel;
    totalCount+=s.rows.length;
  });
  $("#summary-cost").textContent=fmtMoney(totalCost);
  $("#summary-travel").textContent=fmtDuration(totalTravel);
  $("#summary-count").textContent=totalCount;
}
function renderPlanner(){
  const day=state.days[state.selectedDayIndex];
  if(!day) return;
  const s=scheduleFor(day.date);
  $("#day-label").textContent=day.label;
  $("#day-weekday").textContent=day.weekday;
  $("#day-time").textContent=fmtDuration(s.totalActivity);
  $("#day-travel").textContent=`${s.totalTravel} min desloc.`;
  $("#day-cost").textContent=`${fmtMoney(s.totalCost)} casal`;

  const timeline=$("#timeline");
  if(!s.rows.length && !state.dragging){
    timeline.innerHTML=`<div class="empty-plan"><div><strong>Dia livre</strong><br><span>Segure um passeio na gaveta e arraste para cá.</span></div></div>`;
    return;
  }

  let html=`<div class="drop-marker" data-drop-index="0">Soltar no início do dia</div>`;
  s.rows.forEach((r,i)=>{
    html+=`<div class="travel-row"><span>${i===0?"Hotel":s.rows[i-1].p.name}</span><span class="line"></span><strong>${r.t.planning_min} min</strong></div>`;
    if(r.wait>15) html+=`<div class="travel-row"><span>tempo livre / espera</span><span class="line"></span><strong>${r.wait} min</strong></div>`;
    html+=`<article class="timeline-card ${r.conflict?"conflict":""}" data-place-id="${r.id}" data-plan-index="${i}">
      ${preferenceButtons(r.id)}
      <div class="time">${toTime(r.start)}–${toTime(r.end)}${r.p.fixed?" · fixo":""}</div>
      <div class="card-title">${r.p.name}</div>
      <div class="card-subtitle">${r.p.region} · ${r.p.category}</div>
      <div class="card-pills">
        <span class="pill">⏱ ${fmtDuration(r.p.duration)}</span>
        <span class="pill">${r.p.cost_couple?fmtMoney(r.p.cost_couple)+" casal":"grátis"}</span>
        ${r.conflict?`<span class="pill">⚠ conflito</span>`:""}
      </div>
    </article>`;
    html+=`<div class="drop-marker" data-drop-index="${i+1}">Soltar aqui</div>`;
  });
  if(s.rows.length){
    html+=`<div class="travel-row"><span>retorno ao hotel</span><span class="line"></span><strong>${s.returnTravel} min</strong></div>`;
  }
  timeline.innerHTML=html;
  bindPlannerCards();
  bindPreferenceButtons();
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
      <div class="card-title">${p.name}</div>
      <div class="card-subtitle">${p.region} · ${p.category}</div>
      <div class="mini-meta">${fmtDuration(p.duration)} · ${p.cost_couple?fmtMoney(p.cost_couple)+" casal":"grátis"}</div>
      <div class="drag-hint">segure para arrastar ↑</div>
    </article>
  `).join("")||`<div class="empty-plan" style="min-width:220px;min-height:98px">Nenhum passeio neste filtro.</div>`;
  bindDrawerCards();
  bindPreferenceButtons();
  updateFilterButtons();
}

function togglePreference(id,person){
  const set=state.preferences[person];
  if(set.has(id)) set.delete(id); else set.add(id);
  render();
  if(!$("#details-backdrop").hidden && state.selectedPlaceId===id) updateDetailsPreferences(id);
}
function bindPreferenceButtons(){
  $$("[data-pref-person][data-pref-id]").forEach(btn=>{
    btn.addEventListener("click",e=>{
      e.stopPropagation();
      togglePreference(btn.dataset.prefId,btn.dataset.prefPerson);
    });
  });
}
function updateDetailsPreferences(id){
  ["rafael","lidia"].forEach(person=>{
    const btn=$(`#details-${person}`);
    if(!btn) return;
    const active=indicatedBy(id,person);
    btn.setAttribute("aria-pressed",String(active));
    btn.classList.toggle("active",active);
    const glyph=$(".choice-glyph",btn);
    if(glyph) glyph.textContent=prefGlyph(person,active);
  });
}

function openDetails(id){
  const p=state.byId[id];
  if(!p) return;
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
function closeDetails(){
  $("#details-backdrop").hidden=true;
  state.selectedPlaceId=null;
}

function removeFromPlan(id){
  Object.keys(state.plan).forEach(date=>state.plan[date]=state.plan[date].filter(x=>x!==id));
}
function addToPlan(id,index){
  removeFromPlan(id);
  const date=dayDate();
  const list=state.plan[date]||[];
  list.splice(Math.max(0,Math.min(index,list.length)),0,id);
  state.plan[date]=list;
}

function beginDrag(id,source,pointer){
  if(state.dragging) return;
  state.dragging={id,source,pointerId:pointer.pointerId};
  $("#app").classList.add("dragging");
  const p=state.byId[id];
  const ghost=document.createElement("div");
  ghost.className="drag-ghost";
  ghost.id="drag-ghost";
  ghost.innerHTML=`<strong>${p.name}</strong><span>${fmtDuration(p.duration)} · ${p.cost_couple?fmtMoney(p.cost_couple)+" casal":"grátis"}</span>`;
  document.body.appendChild(ghost);
  moveGhost(pointer.clientX,pointer.clientY);
  renderPlanner();
}
function moveGhost(x,y){
  const g=$("#drag-ghost");
  if(!g) return;
  g.style.left=`${x}px`;
  g.style.top=`${y}px`;
}
function updateDrag(pointer){
  if(!state.dragging) return;
  moveGhost(pointer.clientX,pointer.clientY);
  const drawerRect=$("#places-drawer").getBoundingClientRect();
  $("#app").classList.toggle("return-mode",pointer.clientY>=drawerRect.top);
  $$("[data-drop-index]").forEach(m=>m.classList.remove("active"));
  const under=document.elementFromPoint(pointer.clientX,pointer.clientY);
  under?.closest?.("[data-drop-index]")?.classList.add("active");
}
function endDrag(pointer){
  if(!state.dragging) return;
  const {id,source}=state.dragging;
  const drawerRect=$("#places-drawer").getBoundingClientRect();
  const under=document.elementFromPoint(pointer.clientX,pointer.clientY);
  const marker=under?.closest?.("[data-drop-index]");
  const timelineCard=under?.closest?.("[data-plan-index]");
  if(marker){
    addToPlan(id,Number(marker.dataset.dropIndex));
  }else if(timelineCard){
    addToPlan(id,Number(timelineCard.dataset.planIndex));
  }else if(pointer.clientY>=drawerRect.top && source==="planner"){
    removeFromPlan(id);
  }
  $("#drag-ghost")?.remove();
  $("#app").classList.remove("dragging","return-mode");
  state.dragging=null;
  render();
}
function bindLongPressDrag(el,id,source){
  let timer=null,startX=0,startY=0,armed=false;
  el.addEventListener("pointerdown",e=>{
    if(e.target.closest("button")) return;
    startX=e.clientX;
    startY=e.clientY;
    armed=false;
    timer=setTimeout(()=>{
      armed=true;
      el.classList.add("held");
      beginDrag(id,source,e);
    },source==="drawer"?330:180);
  });
  el.addEventListener("pointermove",e=>{
    if(!timer&&!armed) return;
    if(!armed&&Math.hypot(e.clientX-startX,e.clientY-startY)>9){
      clearTimeout(timer);timer=null;return;
    }
    if(armed){e.preventDefault();updateDrag(e);}
  });
  const finish=e=>{
    clearTimeout(timer);timer=null;
    if(armed){
      e.preventDefault();
      el.classList.remove("held");
      endDrag(e);
      armed=false;
    }
  };
  el.addEventListener("pointerup",e=>{
    if(!armed){
      clearTimeout(timer);timer=null;
      if(Math.hypot(e.clientX-startX,e.clientY-startY)<8) openDetails(id);
    }else finish(e);
  });
  el.addEventListener("pointercancel",finish);
}
function bindDrawerCards(){
  $$(".place-card").forEach(el=>bindLongPressDrag(el,el.dataset.placeId,"drawer"));
}
function bindPlannerCards(){
  $$(".timeline-card").forEach(el=>bindLongPressDrag(el,el.dataset.placeId,"planner"));
}

async function init(){
  const [places,travelData,recommended]=await Promise.all([
    fetch("./data/places.json").then(r=>r.json()),
    fetch("./data/travel-times.json").then(r=>r.json()),
    fetch("./data/recommended-plan.json").then(r=>r.json())
  ]);
  state.places=places;
  state.byId=Object.fromEntries(places.map(p=>[p.id,p]));
  travelData.forEach(t=>{
    state.travel.set(travelKey(t.origin_id,t.destination_id),t);
    state.travel.set(travelKey(t.destination_id,t.origin_id),t);
  });
  state.days=recommended.days;
  state.recommended=recommended.plan;
  state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));
  restore();

  $("#prev-day").addEventListener("click",()=>{
    state.selectedDayIndex=Math.max(0,state.selectedDayIndex-1);
    render();
  });
  $("#next-day").addEventListener("click",()=>{
    state.selectedDayIndex=Math.min(state.days.length-1,state.selectedDayIndex+1);
    render();
  });
  $("#theme-toggle")?.addEventListener("click",toggleTheme);
  $("#drawer-theme-toggle")?.addEventListener("click",toggleTheme);

  $("#filter-rafael").addEventListener("click",()=>{
    state.filters.rafael=!state.filters.rafael;
    renderDrawer();
  });
  $("#filter-lidia").addEventListener("click",()=>{
    state.filters.lidia=!state.filters.lidia;
    renderDrawer();
  });

  $("#load-recommended").addEventListener("click",loadRecommendedPlan);
  $("#mobile-load-recommended")?.addEventListener("click",loadRecommendedPlan);
  $("#reset-plan").addEventListener("click",()=>{
    if(confirm("Limpar todo o planner?")){
      state.plan=Object.fromEntries(state.days.map(d=>[d.date,[]]));
      render();
    }
  });
  $("#open-search").addEventListener("click",()=>{
    const row=$("#search-row");
    row.hidden=!row.hidden;
    if(!row.hidden) $("#place-search").focus();
  });
  $("#place-search").addEventListener("input",e=>{
    state.search=e.target.value;
    renderDrawer();
  });

  $("#close-details").addEventListener("click",closeDetails);
  $("#details-backdrop").addEventListener("click",e=>{
    if(e.target.id==="details-backdrop") closeDetails();
  });
  $("#details-rafael").addEventListener("click",()=>{
    if(state.selectedPlaceId) togglePreference(state.selectedPlaceId,"rafael");
  });
  $("#details-lidia").addEventListener("click",()=>{
    if(state.selectedPlaceId) togglePreference(state.selectedPlaceId,"lidia");
  });
  $("#details-add").addEventListener("click",()=>{
    const id=state.selectedPlaceId;
    if(!id) return;
    const list=state.plan[dayDate()]||[];
    addToPlan(id,list.length);
    closeDetails();
    render();
  });
  $("#details-remove").addEventListener("click",()=>{
    const id=state.selectedPlaceId;
    if(!id) return;
    removeFromPlan(id);
    closeDetails();
    render();
  });

  render();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

init().catch(err=>{
  console.error(err);
  $("#timeline").innerHTML=`<div class="empty-plan">Não foi possível carregar os dados do planner.</div>`;
});
