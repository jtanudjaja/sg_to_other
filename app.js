"use strict";
/* Board logic: state, filtering, rendering, sheets. Depends on data.js. */

/* ===================================================================
   TIME HELPERS
   =================================================================== */
const TZ={SG:'Asia/Singapore',ID:'Asia/Jakarta'};
const OFFSET={SG:8,ID:7};                       /* fixed, no DST in either zone */
const DAY_S=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_L=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_S=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LEAD=35;                                   /* operator check-in cutoff, minutes before departure */

const fmtCache={};
function zoned(tz){
  const f=fmtCache[tz]||(fmtCache[tz]=new Intl.DateTimeFormat('en-GB',{timeZone:tz,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    second:'2-digit',hourCycle:'h23'}));
  const p={};
  for(const x of f.formatToParts(new Date())) p[x.type]=x.value;
  const y=+p.year,m=+p.month,d=+p.day,hh=+p.hour,mm=+p.minute,ss=+p.second;
  return {y,m,d,hh,mm,ss,min:hh*60+mm,
          ymd:`${p.year}-${p.month}-${p.day}`,
          dow:new Date(Date.UTC(y,m-1,d)).getUTCDay()};
}
const nowZ=()=>zoned(TZ[state.dir]);
const toMin=t=>{const i=t.indexOf(':');return +t.slice(0,i)*60 + +t.slice(i+1);};
const hhmm=m=>{m=((m%1440)+1440)%1440;return String(m/60|0).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
/* "45 min" / "2h 05m" — for durations relative to now */
const span=m=>m<60?`${m} min`:`${m/60|0}h ${String(m%60).padStart(2,'0')}m`;
function shiftYmd(ymd,n){
  const [y,m,d]=ymd.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d+n));
  return {ymd:dt.toISOString().slice(0,10),dow:dt.getUTCDay(),
          dom:dt.getUTCDate(),mon:MON_S[dt.getUTCMonth()],y:dt.getUTCFullYear(),m:dt.getUTCMonth()+1};
}
function durOf(e){
  const sgSide=e.dir==='SG'?e.from:e.to, idSide=e.dir==='SG'?e.to:e.from;
  return DUR[sgSide+'|'+idSide]||null;
}
/* arrival, expressed in the ARRIVAL port's local time */
function arrivalMin(e){
  const d=durOf(e); if(d===null) return null;
  const shift=e.dir==='SG'?-60:60;              /* SG(UTC+8) → WIB(UTC+7) and back */
  return toMin(e.time)+d+shift;
}

/* ===================================================================
   STATE
   =================================================================== */
const KEY='sgbatam.v2';
const MAIN_PORTS=['Batam Centre','Harbour Bay'];
const portsInGroup=()=>state.portGroup==='other'
  ? ID_PORTS.filter(p=>!MAIN_PORTS.includes(p)) : MAIN_PORTS;
const state={
  dir:'SG', pinned:false,
  date:null,                                     /* 'YYYY-MM-DD' in departure tz */
  browseToday:false,                             /* explicit review of today's closed sailings */
  brands:new Set(Object.keys(BRANDS)),
  sg:new Set(SG_PORTS),
  portGroup:'main',
  id:new Set(MAIN_PORTS),
  showPast:false,
};
function save(){
  try{localStorage.setItem(KEY,JSON.stringify({
    dir:state.dir,pinned:state.pinned,brands:[...state.brands],sg:[...state.sg],id:[...state.id],portGroup:state.portGroup
  }));}catch(e){}
}
function load(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY)||'null'); if(!s) return;
    if(s.dir==='SG'||s.dir==='ID') state.dir=s.dir;
    state.pinned=!!s.pinned;
    if(Array.isArray(s.brands)&&s.brands.length) state.brands=new Set(s.brands.filter(b=>BRANDS[b]));
    if(Array.isArray(s.sg)&&s.sg.length) state.sg=new Set(s.sg.filter(p=>SG_PORTS.includes(p)));
    // Older saved filters start in the main group as well.
    state.portGroup=s.portGroup==='other'?'other':'main';
    state.id=new Set(Array.isArray(s.id)
      ? s.id.filter(p=>portsInGroup().includes(p)) : portsInGroup());
    if(!state.brands.size) state.brands=new Set(Object.keys(BRANDS));
    if(!state.sg.size) state.sg=new Set(SG_PORTS);
    if(!state.id.size) state.id=new Set(portsInGroup());
  }catch(e){}
}

const $=id=>document.getElementById(id);

/* ===================================================================
   FILTER + QUERY
   =================================================================== */
function matches(e,dow){
  if(e.dir!==state.dir) return false;
  if(!e.days.includes(dow)) return false;
  if(!state.brands.has(e.brand)) return false;
  const sg=state.dir==='SG';
  if(!state.sg.has(sg?e.from:e.to)) return false;
  if(!state.id.has(sg?e.to:e.from)) return false;
  return true;
}
function sailings(dow){
  return D.filter(e=>matches(e,dow)).sort((a,b)=>
    toMin(a.time)-toMin(b.time) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
/* At the cutoff itself check-in is already closed. */
const firstOpenCheckin=(rows,n)=>rows.findIndex(e=>toMin(e.time)-LEAD>n.min);
const activeFilterCount=()=>
  (state.brands.size<4?1:0)+(state.sg.size<SG_PORTS.length?1:0)+(state.id.size<portsInGroup().length?1:0);

/* ===================================================================
   DIRECTION
   =================================================================== */
function syncDirection(){
  const sg=state.dir==='SG';
  $('vFrom').textContent = sg?'Singapore':'Batam';
  $('vTo').textContent   = sg?'Batam':'Singapore';
  $('route').setAttribute('aria-label',
    sg?'Showing Singapore to Batam. Tap to reverse.':'Showing Batam to Singapore. Tap to reverse.');
  $('lblSG').textContent = sg?'Departing · Singapore':'Arriving · Singapore';
  $('lblID').textContent = sg?'Arriving · Batam':'Departing · Batam';
  /* departure terminal always sits first — that's the one people filter on */
  const gSG=$('grpSG'), gID=$('grpID');
  gSG.parentNode.insertBefore(sg?gSG:gID, sg?gID:gSG);
  state.date=null;                                /* re-anchor to "today" in the new tz */
  state.browseToday=false;
  buildDates(); renderAll();
}
$('route').addEventListener('click',()=>{
  state.dir = state.dir==='SG'?'ID':'SG';
  state.pinned=true; state.showPast=false;
  $('detect').textContent='Set manually';
  save(); syncDirection();
});

/* ===================================================================
   LOCATION DETECTION
   =================================================================== */
const SG_C={lat:1.3521,lng:103.8198}, ID_C={lat:1.0800,lng:104.0300};
function haversine(a,b){
  const R=6371,r=Math.PI/180;
  const dLa=(b.lat-a.lat)*r,dLo=(b.lng-a.lng)*r;
  const x=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function applyDetected(d,label){
  $('detect').textContent=label;
  if(state.pinned || state.dir===d) return;
  state.dir=d; save(); syncDirection();
}
function detectByTZ(){
  let tz=''; try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
  if(/Jakarta|Pontianak/i.test(tz)) return applyDetected('ID','Batam · from your timezone');
  if(/Singapore/i.test(tz))         return applyDetected('SG','Singapore · from your timezone');
  applyDetected('SG','Singapore · default');
}
function detectByGeo(){
  if(!navigator.geolocation) return detectByTZ();
  let settled=false;
  const fb=setTimeout(()=>{if(!settled){settled=true;detectByTZ();}},7000);
  navigator.geolocation.getCurrentPosition(pos=>{
    if(settled)return; settled=true; clearTimeout(fb);
    const p={lat:pos.coords.latitude,lng:pos.coords.longitude};
    const a=haversine(p,SG_C), b=haversine(p,ID_C);
    if(Math.min(a,b)>100)  applyDetected('SG','Not nearby · showing Singapore');
    else if(b<a)           applyDetected('ID','Batam · from your location');
    else                   applyDetected('SG','Singapore · from your location');
  },()=>{ if(settled)return; settled=true; clearTimeout(fb); detectByTZ(); },
  {enableHighAccuracy:false,timeout:6000,maximumAge:300000});
}
$('redetect').addEventListener('click',()=>{
  state.pinned=false; save(); $('detect').textContent='Detecting…'; detectByGeo();
});

/* ===================================================================
   DATE STRIP
   =================================================================== */
let DATES=[];
function buildDates(){
  const n=nowZ();
  if(!state.date) state.date=n.ymd;
  DATES=[]; for(let i=0;i<14;i++) DATES.push(shiftYmd(n.ymd,i));
  if(state.date>DATES[13].ymd) DATES.push(shiftYmd(state.date,0));
  if(!DATES.some(d=>d.ymd===state.date)) state.date=n.ymd;

  const box=$('dates'); box.innerHTML='';
  DATES.forEach((d,i)=>{
    const b=document.createElement('button');
    b.type='button'; b.role='tab'; b.className='dchip'+((d.dow===0||d.dow===6)?' wknd':'');
    b.setAttribute('aria-selected',String(d.ymd===state.date));
    const label = i===0?'Today' : i===1?'Tomorrow' : DAY_S[d.dow];
    /* once the strip crosses into a new month, day numbers alone are ambiguous */
    const mo = (i>=2 && d.m!==DATES[0].m) ? `<span class="mo">${d.mon}</span>` : '';
    b.innerHTML=`<span class="dw">${label}</span><span class="dd num">${i<2?DAY_S[d.dow]:d.dom}${mo}</span>`;
    b.setAttribute('aria-label',`${DAY_L[d.dow]} ${d.dom} ${d.mon}`);
    b.addEventListener('click',()=>{
      state.date=d.ymd; state.showPast=false;
      state.browseToday=d.ymd===nowZ().ymd;
      [...box.children].forEach(c=>c.setAttribute('aria-selected','false'));
      b.setAttribute('aria-selected','true');
      b.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
      renderAll();
    });
    box.appendChild(b);
  });
}
const selected=()=>DATES.find(d=>d.ymd===state.date)||DATES[0];
const isToday=()=>state.date===nowZ().ymd;

/* ===================================================================
   RENDER · hero
   =================================================================== */
let heroTrip=null;
function renderHero(rows,idx,n,today){
  const sel=selected(), body=$('heroBody');
  heroTrip=null;
  $('heroTrip').hidden=true;
  $('hero').hidden=false;
  $('hero').classList.remove('none');

  if(!rows.length){
    $('heroK').textContent='No sailings';
    $('heroWhen').textContent='';
    $('hero').classList.add('none');
    body.innerHTML='Nothing matches your filters on this day.';
    return null;
  }
  const tzTag = state.dir==='SG'?'SGT':'WIB';

  if(today && idx===-1){
    $('heroK').textContent='Check-in closed for today';
    $('heroWhen').textContent='Today';
    $('hero').classList.add('none');
    const first=sailings(shiftYmd(n.ymd,1).dow)[0];
    body.innerHTML = first
      ? `First sailing tomorrow is <b>${first.time}</b> · ${BRANDS[first.brand].name} ${first.from} → ${first.to}. Check-in closes <b>${hhmm(toMin(first.time)-LEAD)}</b> ${tzTag}.`
      : 'No sailings with check-in open today. Try another day.';
    return null;
  }

  const e=rows[idx], b=BRANDS[e.brand], dep=toMin(e.time), arr=arrivalMin(e), d=durOf(e);
  $('hero').hidden=isPlanned({...e,date:sel.ymd});
  heroTrip=e;
  $('heroTrip').hidden=false;
  $('heroTrip').setAttribute('aria-label',`View sailing details: ${b.name} ${e.time}, ${e.from} to ${e.to}`);
  $('heroK').textContent = today?'Next available sailing':'First departure';
  $('heroWhen').textContent = today
    ? `Today · ${tzTag}`
    : `${DAY_L[sel.dow]} ${sel.dom} ${sel.mon} · ${tzTag}`;

  const leave=dep-LEAD, closeIn=today?leave-n.min:null;
  let cd='';
  if(today){
    const m=dep-n.min;
    const cls = closeIn<=10?'cd soon':'cd';
    cd = `<span class="${cls} num">in ${span(m)}</span>`;
  }
  let checkin='';
  if(today){
    checkin=`<div class="leaveby">Check-in closes <b class="num">${hhmm(leave)}</b> — <b>in ${span(closeIn)}</b> from now (${LEAD} min before departure).</div>`;
  }
  body.innerHTML=`
    <div class="big"><span class="dep num">${e.time}</span>${cd}</div>
    <div class="line">${e.from} <span style="color:var(--muted)">→</span> ${e.to}</div>
    <div class="sub">
      <span class="op" style="background:${b.color}"><i class="d"></i>${b.name}</span>
      ${d?`<span>~${d} min · arrives ~${hhmm(arr)} ${state.dir==='SG'?'WIB':'SGT'}</span>`:''}
      <span class="hero-cta" aria-hidden="true">View details ›</span>
    </div>
    ${checkin}`;
  return idx;
}
$('heroTrip').addEventListener('click',()=>openDetail(heroTrip));

/* ===================================================================
   RENDER · board
   =================================================================== */
let VIEW=[];
/* Arrival is in the departure port's counterpart zone, so a 60-min crossing
   can print the same clock time as departure — the caption above the board
   spells the hour offset out. */
function rowHTML(e,i,closed,n){
  const b=BRANDS[e.brand], d=durOf(e), arr=arrivalMin(e);
  const planned=isPlanned({...e,date:state.date});
  const past=closed && toMin(e.time)<=n.min;
  return `<li><button class="row${past?' past':''}" type="button" data-i="${i}">
    <span class="tcol">
      <span class="dep num">${e.time}</span>
      ${d?`<span class="arr num"><span class="arr-label">arr</span> <span>~${hhmm(arr)}</span></span>`:''}
    </span>
    <span class="rcol">
      <span class="r1">
        <span class="op" style="background:${b.color}"><i class="d"></i>${b.name}</span>
        ${d?`<span class="dur">~${d}m</span>`:''}
        ${e.interline?'<span class="flag">⇄ shared</span>':''}
        ${closed?`<span class="flag days">${past?'Departed':'Check-in closed'}</span>`:''}
        ${e.days.length<7?`<span class="flag days">${e.days.map(x=>DAY_S[x]).join('/')} only</span>`:''}
      </span>
      <span class="r2">${e.from}<i>→</i><b>${e.to}</b></span>
    </span>
    <span class="go">${planned?'<span class="planned-marker" role="img" aria-label="Planned trip" title="Planned trip">✓</span>':'<span aria-hidden="true">›</span>'}</span>
  </button></li>`;
}
function emptyHTML(){
  const off=[];
  const nOps=Object.keys(BRANDS).length-state.brands.size;
  const nPorts=(SG_PORTS.length-state.sg.size)+(portsInGroup().length-state.id.size);
  if(nOps) off.push(`${nOps} operator${nOps>1?'s':''}`);
  if(nPorts) off.push(`${nPorts} terminal${nPorts>1?'s':''}`);
  return `<li><div class="empty"><b>No sailings match</b>
    ${off.length
      ? `You have ${off.join(' and ')} switched off. Turn some back on, or try another day.`
      : `Nothing runs on this route today. Try another day.`}
    ${off.length?'<br><button type="button" id="clearNow">Reset filters</button>':''}</div></li>`;
}
function renderBoard(rows,heroIdx,firstOpen,n,today){
  const board=$('board');
  VIEW=rows;
  if(!rows.length){
    board.innerHTML=emptyHTML();
    $('clearNow')?.addEventListener('click',resetFilters);
    return;
  }
  const pastCount = today ? (firstOpen===-1?rows.length:firstOpen) : 0;
  /* the hero already shows rows[heroIdx] — the board picks up after it */
  const start = heroIdx===null ? pastCount : heroIdx+1;

  const sep=(label,cls,extra)=>`<li><div class="sep${cls?' '+cls:''}"${cls==='now'?' id="nowMark"':''}>`
    +`<span>${label}</span><i class="rule"></i>${extra||''}</div></li>`;

  let html='';
  if(pastCount){
    html += state.showPast
      ? sep('Check-in closed') + rows.slice(0,pastCount).map((e,i)=>rowHTML(e,i,true,n)).join('')
      : `<li><button class="earlier" type="button" id="showPast">↑ Show ${pastCount} sailing${pastCount>1?'s':''} with check-in closed</button></li>`;
  }
  if(pastCount && state.showPast){
    html+=sep(`Now · ${hhmm(n.min)}`,'now','<button class="sephide" type="button" id="hidePast">Hide closed</button>');
  }
  if(start<rows.length){
    const shownPast = pastCount && state.showPast;
    if(!shownPast) html+=sep(today?'Later today':'Rest of the day');
    for(let i=start;i<rows.length;i++) html+=rowHTML(rows[i],i,false,n);
  }else if(heroIdx!==null && !$('hero').hidden){
    html+=`<li><div class="empty small">That's the last sailing of the day.</div></li>`;
  }
  board.innerHTML=html;
  $('showPast')?.addEventListener('click',()=>{state.showPast=true;renderAll();
    requestAnimationFrame(()=>$('nowMark')?.scrollIntoView({block:'center',behavior:'smooth'}));});
  $('hidePast')?.addEventListener('click',()=>{
    /* keep the board from jumping: anchor on the collapse control itself */
    const before=$('hidePast').getBoundingClientRect().top;
    state.showPast=false; renderAll();
    requestAnimationFrame(()=>{
      const el=$('showPast'); if(!el) return;
      scrollBy({top:el.getBoundingClientRect().top-before,behavior:'instant'});
    });
  });
}
$('board').addEventListener('click',ev=>{
  const btn=ev.target.closest('.row'); if(!btn) return;
  openDetail(VIEW[+btn.dataset.i]);
});

function renderAll(){
  const n=nowZ();
  /* Keep today's plans visible until departure, even outside board filters.
     An explicit Today selection lets people review the closed schedule. */
  if(state.date===n.ymd && !state.browseToday
      && firstOpenCheckin(sailings(n.dow),n)===-1
      && !plans.some(t=>t.date===n.ymd && depUTC(t).getTime()>Date.now())){
    state.date=shiftYmd(n.ymd,1).ymd;
    state.showPast=false;
    buildDates();
  }
  const sel=selected(); if(!sel) return;
  const rows=sailings(sel.dow);
  const today=state.date===n.ymd;
  const firstOpen=today?firstOpenCheckin(rows,n):0;
  const dayLabel=today?'Today':state.date===DATES[1]?.ymd?'Tomorrow':DAY_L[sel.dow];
  $('resultsDate').textContent=`${dayLabel} · ${sel.dom} ${sel.mon}`;
  const depTz=state.dir==='SG'?'SGT':'WIB';
  const arrTz=state.dir==='SG'?'WIB':'SGT';
  $('cap').innerHTML=`Departures in <b>${depTz}</b> · arrivals in <b>${arrTz}</b>`;

  /* count what's actually on the board: while past sailings are collapsed,
     quoting the whole day's total contradicts the list underneath it */
  const upcoming = today ? (firstOpen===-1?0:rows.length-firstOpen) : rows.length;
  const shown = (today && !state.showPast) ? upcoming : rows.length;
  $('sailCount').textContent=shown;
  $('countWord').textContent = (today && !state.showPast) ? 'check-in open' : 'sailings';
  $('sheetCount').textContent=shown;

  const heroIdx=renderHero(rows,firstOpen,n,today);
  renderBoard(rows,heroIdx,firstOpen,n,today);
  syncFilterBar();
  renderDayPlans();
  if(openSheet===$('dsheet')) renderDetail();
}

/* ===================================================================
   FILTER SHEET
   =================================================================== */
function chip(value,label,on,color){
  return `<button class="chip" type="button" aria-pressed="${on}" data-v="${value}">
    ${color?`<i class="d" style="background:${color}"></i>`:''}
    <span>${label}</span><span class="tick">✓</span></button>`;
}
function buildChips(){
  $('opChips').innerHTML=Object.entries(BRANDS)
    .map(([k,b])=>chip(k,b.name,state.brands.has(k),b.color)).join('');
  $('sgChips').innerHTML=SG_PORTS.map(p=>chip(p,p,state.sg.has(p))).join('');
  $('idChips').innerHTML=portsInGroup().map(p=>chip(p,p,state.id.has(p))).join('');
}
/* Groups are addressed by state KEY, never by a captured Set — `selectAll`
   and `resetFilters` replace the Set object, and a captured reference would
   then be mutating an orphan. */
const GROUPS={
  brands:{box:'opChips',all:()=>Object.keys(BRANDS)},
  sg:    {box:'sgChips',all:()=>SG_PORTS},
  id:    {box:'idChips',all:portsInGroup},
};
function toggleIn(key,value){
  const set=state[key];
  set.has(value)?set.delete(value):set.add(value);
  if(!set.size) GROUPS[key].all().forEach(v=>set.add(v));  /* never leave a group empty */
}
function selectAll(key){ state[key]=new Set(GROUPS[key].all()); }

Object.entries(GROUPS).forEach(([key,g])=>{
  $(g.box).addEventListener('click',ev=>{
    const c=ev.target.closest('.chip'); if(!c) return;
    toggleIn(key,c.dataset.v);
    buildChips(); save(); renderAll();
  });
});
$('allOps').addEventListener('click',()=>{selectAll('brands');buildChips();save();renderAll();});
$('allSG').addEventListener('click',()=>{selectAll('sg');buildChips();save();renderAll();});
$('allID').addEventListener('click',()=>{selectAll('id');buildChips();save();renderAll();});
$('otherPorts').addEventListener('click',()=>{
  state.portGroup=state.portGroup==='main'?'other':'main';
  state.id=new Set(portsInGroup());
  state.showPast=false;
  buildChips(); save(); renderAll();
});
function resetFilters(){
  state.portGroup='main';
  ['brands','sg','id'].forEach(selectAll);
  buildChips(); save(); renderAll();
}
$('resetAll').addEventListener('click',resetFilters);
$('fClear').addEventListener('click',resetFilters);

function syncFilterBar(){
  // Other ports are an explicit departure from the main-port default.
  $('otherPorts').textContent=state.portGroup==='main'?'Browse other ports':'Back to main ports';
  $('fLabel').textContent=state.portGroup==='main'?'Filters':'Filters · Other ports';
  const off=(state.portGroup==='other'?1:0)+(Object.keys(BRANDS).length-state.brands.size)
          +(SG_PORTS.length-state.sg.size)+(portsInGroup().length-state.id.size);
  $('fBadge').hidden=!off;
  $('fBadge').textContent=off;
  $('fBtn').classList.toggle('on',!!off);
  $('fClear').hidden=!off;
  $('legend').innerHTML=Object.values(BRANDS)
    .map(b=>`<span><i style="background:${b.color}"></i>${b.name}</span>`).join('');
}

/* ===================================================================
   SHEET PLUMBING
   =================================================================== */
let openSheet=null, lastFocus=null, closingSheet=null, hideTimer;
function show(el,focusSel){
  clearTimeout(hideTimer);
  if(closingSheet){closingSheet.hidden=true;closingSheet=null;}
  if(openSheet && openSheet!==el){openSheet.hidden=true;openSheet.classList.remove('show');}
  if(!openSheet) lastFocus=document.activeElement;
  openSheet=el;
  $('scrim').hidden=false; el.hidden=false;
  requestAnimationFrame(()=>{if(openSheet===el){$('scrim').classList.add('show');el.classList.add('show');}});
  document.body.style.overflow='hidden';
  document.querySelectorAll('.top,.sticky,main,.fab').forEach(node=>node.inert=true);
  (el.querySelector(focusSel)||el.querySelector('[data-close]'))?.focus({preventScroll:true});
}
function hide(){
  if(!openSheet) return;
  const el=openSheet; openSheet=null;
  el.classList.remove('show'); $('scrim').classList.remove('show');
  document.body.style.overflow='';
  document.querySelectorAll('.top,.sticky,main,.fab').forEach(node=>node.inert=false);
  closingSheet=el;
  hideTimer=setTimeout(()=>{el.hidden=true;closingSheet=null;if(!openSheet)$('scrim').hidden=true;},240);
  const fallback=$('heroTrip').hidden?$('route'):$('heroTrip');
  const canRestore=lastFocus?.isConnected && !(lastFocus===$('stickyPlanBtn') && $('stickyPlan').hidden);
  (canRestore?lastFocus:fallback).focus({preventScroll:true});
}
$('scrim').addEventListener('click',hide);
document.addEventListener('click',ev=>{ if(ev.target.closest('[data-close]')) hide(); });
document.addEventListener('keydown',ev=>{
  if(!openSheet)return;
  if(ev.key==='Escape'){hide();return;}
  if(ev.key!=='Tab')return;
  const buttons=[...openSheet.querySelectorAll('button:not([disabled]),a[href],summary,input,select,textarea')]
    .filter(node=>!node.closest('[hidden]'));
  const first=buttons[0], last=buttons[buttons.length-1];
  if(ev.shiftKey && document.activeElement===first){ev.preventDefault();last?.focus();}
  else if(!ev.shiftKey && document.activeElement===last){ev.preventDefault();first?.focus();}
});
$('fBtn').addEventListener('click',()=>{
  $('sheetBody').scrollTop=0;
  show($('sheet'),'#opChips .chip');
});

/* ===================================================================
   PLANNED TRIPS · dated independently of board filters
   =================================================================== */
const PLANS_KEY='sgbatam.plans.v1';
let plans=[];
let current=null;
const tripKey=t=>[t.date,t.dir,t.brand,t.from,t.to,t.time].join('|');
const planSlot=t=>[t.date,t.dir].join('|');
const dateLabel=date=>{
  const d=shiftYmd(date,0);
  return `${DAY_L[d.dow]}, ${d.dom} ${d.mon} ${d.y}`;
};
function depUTC(e){
  const [y,m,d]=(e.date||state.date).split('-').map(Number), [hh,mm]=e.time.split(':').map(Number);
  return new Date(Date.UTC(y,m-1,d,hh-OFFSET[e.dir],mm));
}
function validPlan(t){
  if(!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))return false;
  if(!['SG','ID'].includes(t.dir) || !Object.hasOwn(BRANDS,t.brand))return false;
  if(!(t.dir==='SG'?SG_PORTS:ID_PORTS).includes(t.from) || !(t.dir==='SG'?ID_PORTS:SG_PORTS).includes(t.to))return false;
  try{return shiftYmd(t.date,0).ymd===t.date;}catch(err){return false;}
}
function loadPlans(){
  try{
    const saved=JSON.parse(localStorage.getItem(PLANS_KEY)||'[]');
    if(!Array.isArray(saved))return;
    // Older saves could contain multiple choices: keep the last choice per day/direction.
    const slots=new Map();
    saved.filter(validPlan).forEach(t=>slots.set(planSlot(t),{date:t.date,dir:t.dir,brand:t.brand,from:t.from,to:t.to,time:t.time}));
    plans=[...slots.values()];
    if(plans.length!==saved.length)savePlans();
  }catch(err){plans=[];}
}
function savePlans(){
  try{localStorage.setItem(PLANS_KEY,JSON.stringify(plans));return true;}catch(err){return false;}
}
const isPlanned=t=>plans.some(p=>tripKey(p)===tripKey(t));
function addPlan(t){
  if(!t || isPlanned(t))return;
  const replacing=plans.some(p=>planSlot(p)===planSlot(t));
  plans=plans.filter(p=>planSlot(p)!==planSlot(t));
  plans.push({date:t.date,dir:t.dir,brand:t.brand,from:t.from,to:t.to,time:t.time});
  const saved=savePlans();
  renderAll();
  toast(saved?(replacing?'Your planned trip has been changed':'Trip added to your plans'):'Added for this visit; browser storage is unavailable');
}
function removePlan(t){
  plans=plans.filter(p=>tripKey(p)!==tripKey(t));
  const saved=savePlans();
  renderAll();
  toast(saved?'Trip removed from your plans':'Removed for this visit; browser storage is unavailable');
}
const ferryIcon='<svg class="trip-ship" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17 2 10l10-3 10 3-2 7M5 9V4h14v5M9 4V2h6v2M12 7v10M2 21c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2"/></svg>';
function tripRouteHTML(t){
  const arr=arrivalMin(t), duration=durOf(t);
  const terminal=name=>name.replace('HarbourFront','Harbour<wbr>Front');
  const dayOffset=arr===null?0:Math.floor(arr/1440);
  return `<div class="trip-route">
    <div class="trip-end"><div class="trip-caption">Departure</div><div class="trip-time num">${t.time}</div>
      <div class="trip-terminal">${terminal(t.from)}</div><div class="trip-zone">${t.dir==='SG'?'SGT':'WIB'}</div></div>
    <div class="trip-crossing"><div class="trip-track">${ferryIcon}</div><div class="trip-duration">${duration?`~${duration} min`:'Duration unavailable'}</div></div>
    <div class="trip-end"><div class="trip-caption">Arrival</div><div class="trip-time num">${arr===null?'—':'~'+hhmm(arr)}${dayOffset?`<span class="trip-day">+${dayOffset}d</span>`:''}</div>
      <div class="trip-terminal">${terminal(t.to)}</div><div class="trip-zone">${t.dir==='SG'?'WIB':'SGT'}</div></div>
  </div>`;
}
function checkinHTML(t){
  const sameDay=t.date===zoned(TZ[t.dir]).ymd;
  const cutoff=depUTC(t).getTime()-LEAD*60000, diff=cutoff-Date.now();
  const closed=sameDay && diff<=0;
  const relative=!sameDay?'':diff>0?`${span(Math.ceil(diff/60000))} left`
    :diff>-60000?'just closed':`${span(Math.floor(-diff/60000))} ago`;
  return `<span>${closed?'Check-in closed':'Check-in closes'}</span><span class="trip-checkin-value"><strong class="num">${hhmm(toMin(t.time)-LEAD)} ${t.dir==='SG'?'SGT':'WIB'}</strong>${relative?`<span class="trip-remaining">· ${relative}</span>`:''}</span>`;
}
function tripFooterHTML(t){
  const brand=BRANDS[t.brand];
  return `<div class="trip-meta"><span class="op" style="background:${brand.color}"><i class="d"></i>${brand.name}</span><div class="trip-checkin">${checkinHTML(t)}</div></div>`;
}
let stickyPlanTrip=null;
function renderStickyPlan(day){
  const now=Date.now();
  stickyPlanTrip=day.find(t=>depUTC(t).getTime()>now)||day.at(-1)||null;
  if(stickyPlanTrip){
    const t=stickyPlanTrip, departure=depUTC(t).getTime();
    const zone=t.dir==='SG'?'SGT':'WIB';
    const departed=departure<=now, closed=!departed && departure-LEAD*60000<=now;
    const localToday=zoned(TZ[t.dir]).ymd;
    const when=departed?'Departed':t.date===localToday?`in ${span(Math.ceil((departure-now)/60000))}`
      :t.date===shiftYmd(localToday,1).ymd?'Tomorrow':`${shiftYmd(t.date,0).dom} ${shiftYmd(t.date,0).mon}`;
    $('stickyPlanTime').textContent=t.time;
    $('stickyPlanZone').textContent=zone;
    $('stickyPlanCountdown').textContent=when;
    $('stickyPlanCountdown').classList.toggle('departed',departed);
    $('stickyPlanLabel').textContent=closed?'Planned · Check-in closed':`Planned · ${BRANDS[t.brand].name}`;
    $('stickyPlanLabel').classList.toggle('closed',closed);
    $('stickyPlanRoute').textContent=`${t.from} → ${t.to}`;
    $('stickyPlanBtn').setAttribute('aria-label',`View planned trip: ${BRANDS[t.brand].name}, ${t.time} ${zone}, ${t.from} to ${t.to}, ${when}${closed?', check-in closed':''}`);
  }
  syncStickyPlanVisibility();
}
function syncStickyPlanVisibility(){
  const bounds=sticky.getBoundingClientRect();
  const stuck=bounds.top<=0;
  sticky.classList.toggle('stuck',stuck);
  // Use the controls' bottom, excluding the overlay, so scrolling back has
  // the same threshold and even a partly visible planned card hides the bar.
  $('stickyPlan').hidden=!stickyPlanTrip || !stuck || $('dayPlans').hidden
    || $('dayPlans').getBoundingClientRect().bottom>bounds.bottom;
}
$('stickyPlanBtn').addEventListener('click',()=>{if(stickyPlanTrip)openDetail(stickyPlanTrip);});
function renderDayPlans(){
  const day=plans.filter(t=>t.date===state.date).sort((a,b)=>depUTC(a)-depUTC(b)||tripKey(a).localeCompare(tripKey(b)));
  $('dayPlans').hidden=!day.length;
  $('dayPlans').innerHTML=day.map(t=>{
    const departed=depUTC(t).getTime()<=Date.now();
    return `<article class="day-plan-card"><div class="day-plan-head"><h2>Planned trip${departed?' · Departed':''}</h2><span aria-hidden="true">View details ›</span></div>
      ${tripRouteHTML(t)}${tripFooterHTML(t)}
      <button class="hero-open" type="button" data-day-plan="${encodeURIComponent(tripKey(t))}" aria-haspopup="dialog" aria-controls="dsheet" aria-label="View planned trip: ${BRANDS[t.brand].name} ${t.time} ${t.dir==='SG'?'SGT':'WIB'}, ${t.from} to ${t.to}"></button></article>`;
  }).join('');
  renderStickyPlan(day);
}
$('dayPlans').addEventListener('click',ev=>{
  const button=ev.target.closest('[data-day-plan]');if(!button)return;
  const trip=plans.find(t=>encodeURIComponent(tripKey(t))===button.dataset.dayPlan);
  if(trip)openDetail(trip);
});
function renderDetail(){
  if(!current)return;
  const e=current, saved=isPlanned(e);
  $('dTitle').textContent=dateLabel(e.date);
  const schedule=D.find(row=>row.dir===e.dir&&row.brand===e.brand&&row.from===e.from&&row.to===e.to&&row.time===e.time);
  const notes=[];
  if(schedule?.days.length<7)notes.push(`Operates ${schedule.days.map(d=>DAY_S[d]).join(', ')}.`);
  if(schedule?.interline)notes.push('Shared sailing — Sindo and Batam Fast sell the same boat.');
  $('dBody').innerHTML=tripRouteHTML(e)+tripFooterHTML(e)+(notes.length?`<p class="trip-note">${notes.join(' ')}</p>`:'');
  $('planTripBtn').textContent=saved?'Remove from my plans':'I’m taking this ferry';
  $('planTripBtn').classList.toggle('is-planned',saved);
  $('planTripBtn').setAttribute('aria-pressed',String(saved));
}
function openDetail(e,date=e?.date||state.date){
  if(!e) return;
  current={...e,date};
  renderDetail();
  $('dBody').scrollTop=0;
  show($('dsheet'),'#planTripBtn');
}
$('planTripBtn').addEventListener('click',()=>{if(current){isPlanned(current)?removePlan(current):addPlan(current);}});

/* Share and calendar use the dated sailing, even when the board changes. */
const icsStamp=dt=>dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function calendarText(e){
  const b=BRANDS[e.brand], start=depUTC(e), end=new Date(start.getTime()+(durOf(e)||60)*60000);
  const zone=e.dir==='SG'?'SGT':'WIB';
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//sg-batam-ferry//EN','BEGIN:VEVENT',
    `UID:${start.getTime()}-${e.brand}-${e.from.replace(/\s/g,'')}-${e.to.replace(/\s/g,'')}@sg-batam`,
    `DTSTAMP:${icsStamp(new Date())}`,`DTSTART:${icsStamp(start)}`,`DTEND:${icsStamp(end)}`,
    `SUMMARY:Ferry ${e.from} → ${e.to} (${b.name})`,
    `LOCATION:${e.from} Ferry Terminal`,
    `DESCRIPTION:${b.name} ferry departing ${e.time} ${zone}. Check-in closes ${hhmm(toMin(e.time)-LEAD)} ${zone} (${LEAD} min before). Arrival time approximate.`,
    'BEGIN:VALARM',`TRIGGER:-PT${LEAD}M`,'ACTION:DISPLAY','DESCRIPTION:Ferry check-in closing','END:VALARM',
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
}
$('icsBtn').addEventListener('click',()=>{
  const e=current;if(!e)return;
  const url=URL.createObjectURL(new Blob([calendarText(e)],{type:'text/calendar;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url; a.download=`ferry-${e.date}-${e.time.replace(':','')}-${e.brand}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('Calendar file downloaded');
});
function shareText(e){
  const zone=e.dir==='SG'?'SGT':'WIB';
  return `${BRANDS[e.brand].name} ferry ${e.time} ${zone} — ${e.from} → ${e.to}, ${dateLabel(e.date)}. Check-in closes ${hhmm(toMin(e.time)-LEAD)} ${zone}.`;
}
$('shareBtn').addEventListener('click',async()=>{
  const e=current; if(!e) return;
  const text=shareText(e);
  try{
    if(navigator.share){ await navigator.share({title:'Ferry sailing',text}); return; }
    await navigator.clipboard.writeText(text); toast('Copied to clipboard');
  }catch(err){if(err.name!=='AbortError')toast('Could not share. Try adding it to your calendar.');}
});

let toastT;
function toast(msg){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ===================================================================
   CLOCK · sticky shadow · jump-to-now
   =================================================================== */
let lastBoardMinute=null, lastBoardDate=null, lastBoardDirection=null;
function tick(){
  const n=nowZ();
  $('clock').textContent=`${String(n.hh).padStart(2,'0')}:${String(n.mm).padStart(2,'0')}:${String(n.ss).padStart(2,'0')} ${state.dir==='SG'?'SGT':'WIB'}`;
  if(lastBoardDirection===state.dir && lastBoardDate && n.ymd!==lastBoardDate){
    state.date=null; state.showPast=false; state.browseToday=false; buildDates();
  }
  const minute=`${state.dir}:${n.ymd}:${n.min}`;
  if(minute!==lastBoardMinute){ lastBoardMinute=minute; renderAll(); }
  lastBoardDate=n.ymd;
  lastBoardDirection=state.dir;
}
const sticky=$('sticky'), fab=$('fab');
addEventListener('scroll',()=>{
  syncStickyPlanVisibility();
  const hero=$('hero').getBoundingClientRect();
  fab.classList.toggle('show',isToday()&&hero.bottom<-40);
},{passive:true});
addEventListener('resize',syncStickyPlanVisibility);
fab.addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));

/* ===================================================================
   INIT
   =================================================================== */
load();loadPlans();
buildChips();
syncDirection();                 /* builds dates + first render */
tick();
if(!state.pinned) detectByGeo(); else $('detect').textContent='Set manually';

setInterval(tick,1000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden){tick();renderAll();} });
