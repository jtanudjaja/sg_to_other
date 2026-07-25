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
  const sgSide=state.dir==='SG'?e.from:e.to, idSide=state.dir==='SG'?e.to:e.from;
  return DUR[sgSide+'|'+idSide]||null;
}
/* arrival, expressed in the ARRIVAL port's local time */
function arrivalMin(e){
  const d=durOf(e); if(d===null) return null;
  const shift=state.dir==='SG'?-60:60;          /* SG(UTC+8) → WIB(UTC+7) and back */
  return toMin(e.time)+d+shift;
}

/* ===================================================================
   STATE
   =================================================================== */
const KEY='sgbatam.v2';
const state={
  dir:'SG', pinned:false,
  date:null,                                     /* 'YYYY-MM-DD' in departure tz */
  brands:new Set(Object.keys(BRANDS)),
  sg:new Set(SG_PORTS),
  id:new Set(ID_PORTS),
  showPast:false,
};
function save(){
  try{localStorage.setItem(KEY,JSON.stringify({
    dir:state.dir,pinned:state.pinned,brands:[...state.brands],sg:[...state.sg],id:[...state.id]
  }));}catch(e){}
}
function load(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY)||'null'); if(!s) return;
    if(s.dir==='SG'||s.dir==='ID') state.dir=s.dir;
    state.pinned=!!s.pinned;
    if(Array.isArray(s.brands)&&s.brands.length) state.brands=new Set(s.brands.filter(b=>BRANDS[b]));
    if(Array.isArray(s.sg)&&s.sg.length) state.sg=new Set(s.sg.filter(p=>SG_PORTS.includes(p)));
    if(Array.isArray(s.id)&&s.id.length) state.id=new Set(s.id.filter(p=>ID_PORTS.includes(p)));
    if(!state.brands.size) state.brands=new Set(Object.keys(BRANDS));
    if(!state.sg.size) state.sg=new Set(SG_PORTS);
    if(!state.id.size) state.id=new Set(ID_PORTS);
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
const activeFilterCount=()=>
  (state.brands.size<4?1:0)+(state.sg.size<SG_PORTS.length?1:0)+(state.id.size<ID_PORTS.length?1:0);

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
function renderHero(rows){
  const n=nowZ(), today=isToday(), sel=selected(), body=$('heroBody');
  $('hero').classList.remove('none');

  if(!rows.length){
    $('heroK').textContent='No sailings';
    $('heroWhen').textContent='';
    $('hero').classList.add('none');
    body.innerHTML='Nothing matches your filters on this day.';
    return null;
  }
  const idx = today ? rows.findIndex(e=>toMin(e.time)>=n.min) : 0;
  const tzTag = state.dir==='SG'?'SGT':'WIB';

  if(today && idx===-1){
    $('heroK').textContent='Last boat has gone';
    $('heroWhen').textContent='Today';
    $('hero').classList.add('none');
    const first=sailings(shiftYmd(n.ymd,1).dow)[0];
    body.innerHTML = first
      ? `First sailing tomorrow is <b>${first.time}</b> · ${BRANDS[first.brand].name} ${first.from} → ${first.to}.`
      : 'No further sailings today.';
    return null;
  }

  const e=rows[idx], b=BRANDS[e.brand], dep=toMin(e.time), arr=arrivalMin(e), d=durOf(e);
  $('heroK').textContent = today?'Next departure':'First departure';
  $('heroWhen').textContent = today
    ? `Today · ${tzTag}`
    : `${DAY_L[sel.dow]} ${sel.dom} ${sel.mon} · ${tzTag}`;

  let cd='';
  if(today){
    const m=dep-n.min;
    const cls = m<=LEAD?'cd soon':'cd';
    cd = `<span class="${cls} num">${m<1?'departing now':'in '+span(m)}</span>`;
  }
  const leave = today ? dep-LEAD : null;
  const closeIn = today ? leave-n.min : null;
  let checkin='';
  if(today && closeIn>0){
    checkin=`<div class="leaveby">Check-in closes <b class="num">${hhmm(leave)}</b> — <b>in ${span(closeIn)}</b> from now (${LEAD} min before departure).</div>`;
  }else if(today){
    /* check-in already shut on this one — point at the first boat still catchable */
    const catchable=rows.find(r=>toMin(r.time)-LEAD>n.min);
    checkin=`<div class="leaveby shut">Check-in closed <b class="num">${hhmm(leave)}</b>, <b>${span(-closeIn)} ago</b>.`
      +(catchable
        ? ` Next one you can still make: <b class="num">${catchable.time}</b> (${BRANDS[catchable.brand].name}), check-in until <b class="num">${hhmm(toMin(catchable.time)-LEAD)}</b>.`
        : ` No later sailing today still has check-in open.`)+`</div>`;
  }
  body.innerHTML=`
    <div class="big"><span class="dep num">${e.time}</span>${cd}</div>
    <div class="line">${e.from} <span style="color:var(--muted)">→</span> ${e.to}</div>
    <div class="sub">
      <span class="op" style="background:${b.color}"><i class="d"></i>${b.name}</span>
      ${d?`<span>~${d} min · arrives ${hhmm(arr)} ${state.dir==='SG'?'WIB':'SGT'}</span>`:''}
    </div>
    ${checkin}`;
  return idx;
}

/* ===================================================================
   RENDER · board
   =================================================================== */
let VIEW=[];
/* Arrival is in the departure port's counterpart zone, so a 60-min crossing
   can print the same clock time as departure — the caption above the board
   spells the hour offset out. */
function rowHTML(e,i,past){
  const b=BRANDS[e.brand], d=durOf(e), arr=arrivalMin(e);
  return `<li><button class="row${past?' past':''}" type="button" data-i="${i}">
    <span class="tcol">
      <span class="dep num">${e.time}</span>
      ${d?`<span class="arr num">arr ${hhmm(arr)}</span>`:''}
    </span>
    <span class="rcol">
      <span class="r1">
        <span class="op" style="background:${b.color}"><i class="d"></i>${b.name}</span>
        ${d?`<span class="dur">~${d}m</span>`:''}
        ${e.interline?'<span class="flag">⇄ shared</span>':''}
        ${e.days.length<7?`<span class="flag days">${e.days.map(x=>DAY_S[x]).join('/')} only</span>`:''}
      </span>
      <span class="r2">${e.from}<i>→</i><b>${e.to}</b></span>
    </span>
    <span class="go" aria-hidden="true">›</span>
  </button></li>`;
}
function emptyHTML(){
  const off=[];
  const nOps=Object.keys(BRANDS).length-state.brands.size;
  const nPorts=(SG_PORTS.length-state.sg.size)+(ID_PORTS.length-state.id.size);
  if(nOps) off.push(`${nOps} operator${nOps>1?'s':''}`);
  if(nPorts) off.push(`${nPorts} terminal${nPorts>1?'s':''}`);
  return `<li><div class="empty"><b>No sailings match</b>
    ${off.length
      ? `You have ${off.join(' and ')} switched off. Turn some back on, or try another day.`
      : `Nothing runs on this route today. Try another day.`}
    ${off.length?'<br><button type="button" id="clearNow">Reset filters</button>':''}</div></li>`;
}
function renderBoard(rows,heroIdx){
  const board=$('board'), n=nowZ(), today=isToday();
  VIEW=rows;
  if(!rows.length){
    board.innerHTML=emptyHTML();
    $('clearNow')?.addEventListener('click',resetFilters);
    return;
  }
  const firstFuture = today ? rows.findIndex(e=>toMin(e.time)>=n.min) : 0;
  const pastCount = today ? (firstFuture===-1?rows.length:firstFuture) : 0;
  /* the hero already shows rows[heroIdx] — the board picks up after it */
  const start = heroIdx===null ? pastCount : heroIdx+1;

  const sep=(label,cls,extra)=>`<li><div class="sep${cls?' '+cls:''}"${cls==='now'?' id="nowMark"':''}>`
    +`<span>${label}</span><i class="rule"></i>${extra||''}</div></li>`;

  let html='';
  if(pastCount){
    html += state.showPast
      ? sep('Earlier today') + rows.slice(0,pastCount).map((e,i)=>rowHTML(e,i,true)).join('')
      : `<li><button class="earlier" type="button" id="showPast">↑ Show ${pastCount} earlier sailing${pastCount>1?'s':''}</button></li>`;
  }
  if(start<rows.length){
    const shownPast = pastCount && state.showPast;
    html += shownPast
      ? sep(`Now · ${hhmm(n.min)}`,'now','<button class="sephide" type="button" id="hidePast">Hide earlier</button>')
      : sep(today?'Later today':'Rest of the day');
    for(let i=start;i<rows.length;i++) html+=rowHTML(rows[i],i,false);
  }else if(heroIdx!==null){
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
  const sel=selected(); if(!sel) return;
  const rows=sailings(sel.dow);
  const n=nowZ(), today=isToday();
  const depTz=state.dir==='SG'?'SGT':'WIB';
  const arrTz=state.dir==='SG'?'WIB':'SGT';
  $('cap').innerHTML=`Departures in <b>${depTz}</b>, arrivals in <b>${arrTz}</b>`
    +` — the two ports are an hour apart, so a 60-min crossing lands on the same clock time.`;

  /* count what's actually on the board: while past sailings are collapsed,
     quoting the whole day's total contradicts the list underneath it */
  const upcoming = today ? rows.filter(e=>toMin(e.time)>=n.min).length : rows.length;
  const shown = (today && !state.showPast) ? upcoming : rows.length;
  $('sailCount').textContent=shown;
  $('countWord').textContent = (today && !state.showPast) ? 'still to go' : 'sailings';
  $('sheetCount').textContent=shown;

  const heroIdx=renderHero(rows);
  renderBoard(rows,heroIdx);
  syncFilterBar();
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
  $('idChips').innerHTML=ID_PORTS.map(p=>chip(p,p,state.id.has(p))).join('');
}
/* Groups are addressed by state KEY, never by a captured Set — `selectAll`
   and `resetFilters` replace the Set object, and a captured reference would
   then be mutating an orphan. */
const GROUPS={
  brands:{box:'opChips',all:()=>Object.keys(BRANDS)},
  sg:    {box:'sgChips',all:()=>SG_PORTS},
  id:    {box:'idChips',all:()=>ID_PORTS},
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
function resetFilters(){
  ['brands','sg','id'].forEach(selectAll);
  buildChips(); save(); renderAll();
}
$('resetAll').addEventListener('click',resetFilters);
$('fClear').addEventListener('click',resetFilters);

function syncFilterBar(){
  /* badge counts how many things are switched OFF — 0 means "showing everything" */
  const off=(Object.keys(BRANDS).length-state.brands.size)
          +(SG_PORTS.length-state.sg.size)+(ID_PORTS.length-state.id.size);
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
let openSheet=null, lastFocus=null;
function show(el,focusSel){
  lastFocus=document.activeElement; openSheet=el;
  $('scrim').hidden=false; el.hidden=false;
  requestAnimationFrame(()=>{$('scrim').classList.add('show');el.classList.add('show');});
  document.body.style.overflow='hidden';
  (el.querySelector(focusSel)||el.querySelector('[data-close]'))?.focus({preventScroll:true});
}
function hide(){
  if(!openSheet) return;
  const el=openSheet; openSheet=null;
  el.classList.remove('show'); $('scrim').classList.remove('show');
  document.body.style.overflow='';
  setTimeout(()=>{el.hidden=true;$('scrim').hidden=true;},240);
  lastFocus?.focus({preventScroll:true});
}
$('scrim').addEventListener('click',hide);
document.addEventListener('click',ev=>{ if(ev.target.closest('[data-close]')) hide(); });
document.addEventListener('keydown',ev=>{ if(ev.key==='Escape'&&openSheet) hide(); });
$('fBtn').addEventListener('click',()=>{
  $('sheetBody').scrollTop=0;
  show($('sheet'),'#opChips .chip');
});

/* ===================================================================
   SAILING DETAIL · share + calendar
   =================================================================== */
let current=null;
function openDetail(e){
  if(!e) return;
  current=e;
  const b=BRANDS[e.brand], sel=selected(), d=durOf(e), arr=arrivalMin(e);
  const depTz=state.dir==='SG'?'SGT (UTC+8)':'WIB (UTC+7)';
  const arrTz=state.dir==='SG'?'WIB (UTC+7)':'SGT (UTC+8)';
  /* relative times only make sense on today's board */
  const n=nowZ(), live=isToday(), close=toMin(e.time)-LEAD;
  const rel=(m)=>{
    if(!live) return '';
    const diff=m-n.min;
    return `<span class="rel${diff<=0?' shut':''}">${diff>0?`in ${span(diff)}`:`${span(-diff)} ago`}</span>`;
  };
  $('dTitle').textContent=`${b.name} · ${e.time}`;
  $('dBody').innerHTML=`
    <div class="big num">${e.time}</div>
    <div style="margin-top:4px;font-size:14px;color:var(--muted)">
      ${DAY_L[sel.dow]} ${sel.dom} ${sel.mon} · ${depTz}</div>
    <dl class="dl">
      <div><dt>Operator</dt><dd>${b.name}</dd></div>
      <div><dt>Check-in closes</dt><dd class="mono">${hhmm(close)} ${rel(close)}</dd></div>
      <div><dt>Departs</dt><dd class="mono">${e.from} ${e.time} ${rel(toMin(e.time))}</dd></div>
      ${d?`<div><dt>Arrives (approx)</dt><dd class="mono">${e.to} ${hhmm(arr)} ${arrTz}</dd></div>
          <div><dt>Crossing</dt><dd class="mono">~${d} min</dd></div>`
         :`<div><dt>Arrives</dt><dd>${e.to}</dd></div>`}
      <div><dt>Operates</dt><dd>${e.days.length===7?'Daily':e.days.map(x=>DAY_S[x]).join(', ')}</dd></div>
      ${e.interline?'<div><dt>Note</dt><dd>Interlined — Sindo and Batam Fast sell this same sailing</dd></div>':''}
    </dl>`;
  show($('dsheet'),'#icsBtn');
}
function depUTC(e){
  const sel=selected(), [hh,mm]=e.time.split(':').map(Number);
  return new Date(Date.UTC(sel.y,sel.m-1,sel.dom,hh-OFFSET[state.dir],mm));
}
const icsStamp=dt=>dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
$('icsBtn').addEventListener('click',()=>{
  const e=current; if(!e) return;
  const b=BRANDS[e.brand], start=depUTC(e), end=new Date(start.getTime()+(durOf(e)||60)*60000);
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//sg-batam-ferry//EN','BEGIN:VEVENT',
    `UID:${start.getTime()}-${e.brand}-${e.from.replace(/\s/g,'')}@sg-batam`,
    `DTSTAMP:${icsStamp(new Date())}`,`DTSTART:${icsStamp(start)}`,`DTEND:${icsStamp(end)}`,
    `SUMMARY:Ferry ${e.from} → ${e.to} (${b.name})`,
    `LOCATION:${e.from} Ferry Terminal`,
    `DESCRIPTION:${b.name} ferry departing ${e.time}. Check-in closes ${hhmm(toMin(e.time)-LEAD)} (${LEAD} min before). Arrival time approximate.`,
    'BEGIN:VALARM',`TRIGGER:-PT${LEAD}M`,'ACTION:DISPLAY','DESCRIPTION:Ferry check-in closing','END:VALARM',
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([ics],{type:'text/calendar;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url; a.download=`ferry-${e.time.replace(':','')}-${e.brand}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('Calendar file downloaded');
});
$('shareBtn').addEventListener('click',async()=>{
  const e=current; if(!e) return;
  const sel=selected();
  const text=`${BRANDS[e.brand].name} ferry ${e.time} — ${e.from} → ${e.to}, ${DAY_L[sel.dow]} ${sel.dom} ${sel.mon}`;
  try{
    if(navigator.share){ await navigator.share({title:'Ferry sailing',text}); return; }
    await navigator.clipboard.writeText(text); toast('Copied to clipboard');
  }catch(err){ /* user cancelled */ }
});

let toastT;
function toast(msg){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ===================================================================
   CLOCK · sticky shadow · jump-to-now
   =================================================================== */
function tick(){
  const n=nowZ();
  $('clock').textContent=`${String(n.hh).padStart(2,'0')}:${String(n.mm).padStart(2,'0')}:${String(n.ss).padStart(2,'0')} ${state.dir==='SG'?'SGT':'WIB'}`;
}
const sticky=$('sticky'), fab=$('fab');
addEventListener('scroll',()=>{
  sticky.classList.toggle('stuck',sticky.getBoundingClientRect().top<=0);
  const hero=$('hero').getBoundingClientRect();
  fab.classList.toggle('show',isToday()&&hero.bottom<-40);
},{passive:true});
fab.addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));

/* ===================================================================
   INIT
   =================================================================== */
load();
buildChips();
syncDirection();                 /* builds dates + first render */
tick();
if(!state.pinned) detectByGeo(); else $('detect').textContent='Set manually';

setInterval(tick,1000);
setInterval(renderAll,30000);
let lastYmd=nowZ().ymd;
setInterval(()=>{
  const y=nowZ().ymd;
  if(y!==lastYmd){ lastYmd=y; state.date=null; state.showPast=false; buildDates(); renderAll(); }
},60000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden){tick();renderAll();} });
