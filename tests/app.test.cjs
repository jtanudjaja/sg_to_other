const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const markup = readFileSync(resolve(root, 'index.html'), 'utf8');
const source = ['data.js', 'app.js'].map(file => readFileSync(resolve(root, file), 'utf8')).join('\n');

// Run the real app with a controlled clock and a small DOM adapter. No dependencies.
function boardAt(instant, dir = 'SG', saved = {}) {
  const clock = { now: new Date(instant).getTime() };
  const intervals = [];
  const nodes = new Map();
  const dynamicNodes = new Map();
  const listeners = new Map();
  const storage = new Map(Object.entries({ 'sgbatam.v2': JSON.stringify({ dir, pinned: true }), ...saved }));
  function element() {
    let html = '';
    const attributes = new Map();
    return {
      textContent: '', children: [], dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      parentNode: { insertBefore() {} },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value; this.children = [];
        if (this === nodes.get('board')) dynamicNodes.clear();
      },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      querySelector(selector) { return selector.startsWith('#') ? nodes.get(selector.slice(1)) : null; },
      querySelectorAll() { return []; },
      focus() { document.activeElement = this; },
      addEventListener(type, callback) { this[type] = callback; },
      appendChild(child) { this.children.push(child); },
      scrollIntoView() {},
      getBoundingClientRect() { return { top: 0, bottom: 0 }; },
    };
  }
  for (const [, id] of markup.matchAll(/id="([^"]+)"/g)) nodes.set(id, Object.assign(element(), { id }));
  const document = {
    hidden: false, activeElement: null, body: { style: {} },
    querySelectorAll() { return []; },
    getElementById(id) {
      if (nodes.has(id)) return nodes.get(id);
      if (nodes.get('board').innerHTML.includes(`id="${id}"`)) {
        if (!dynamicNodes.has(id)) dynamicNodes.set(id, element());
        return dynamicNodes.get(id);
      }
      return null;
    },
    createElement: element,
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  class BoardDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const context = vm.createContext({
    Date: BoardDate, Intl, document,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    setInterval: (callback, ms) => intervals.push({ callback, ms }),
    setTimeout() {}, clearTimeout() {}, addEventListener() {},
    requestAnimationFrame: callback => callback(), scrollBy() {}, scrollTo() {},
  });
  vm.runInContext(source, context);
  return {
    nodes,
    storage,
    run: code => vm.runInContext(code, context),
    advance(instant) {
      clock.now = new Date(instant).getTime();
      intervals.find(interval => interval.ms === 1000).callback();
    },
    resume(instant) {
      clock.now = new Date(instant).getTime();
      listeners.get('visibilitychange')();
    },
    heroTime: () => nodes.get('hero').hidden ? undefined : nodes.get('heroBody').innerHTML.match(/class="dep num">([^<]+)/)?.[1],
    count: () => Number(nodes.get('sailCount').textContent),
    html: () => nodes.get('board').innerHTML,
  };
}

function fixture(board) {
  board.run(`
    D.splice(0, D.length,
      ...E('SG','majestic','HarbourFront','Batam Centre',['11:30','12:00','12:20','12:40']),
      ...E('ID','majestic','Batam Centre','HarbourFront',['11:30','12:00','12:20','12:40']));
    state.date=nowZ().ymd; state.browseToday=false;
    renderAll();
  `);
}

for (const [dir, offset, tag] of [['SG', '+08:00', 'SGT'], ['ID', '+07:00', 'WIB']]) {
  test(`${tag}: hero, count and board skip closed check-ins at the exact cutoff`, () => {
    const board = boardAt(`2026-11-10T11:44:59${offset}`, dir);
    fixture(board);
    assert.equal(board.heroTime(), '12:20');
    assert.equal(board.count(), 2);
    assert.equal(board.nodes.get('sheetCount').textContent, 2);
    assert.equal(board.nodes.get('countWord').textContent, 'check-in open');
    assert.match(board.nodes.get('heroWhen').textContent, new RegExp(tag));
    assert.match(board.html(), /Show 2 sailings with check-in closed/);
    assert.deepEqual([...board.html().matchAll(/data-i="(\d+)"/g)].map(match => +match[1]), [3]);

    board.advance(`2026-11-10T11:45:00${offset}`);
    assert.equal(board.heroTime(), '12:40');
    assert.equal(board.count(), 1);
    assert.match(board.html(), /Show 3 sailings with check-in closed/);
    assert.doesNotMatch(board.html(), /data-i=/);
    assert.match(board.html(), /last sailing of the day/);

    board.run('state.showPast=true; renderAll();');
    assert.equal(board.count(), 4);
    assert.deepEqual([...board.html().matchAll(/data-i="(\d+)"/g)].map(match => +match[1]), [0, 1, 2]);
    assert.equal((board.html().match(/class="flag days">Check-in closed/g) || []).length, 2);
    assert.equal((board.html().match(/class="flag days">Departed/g) || []).length, 1);
    // Only the departed 11:30 is struck through; 12:00 and 12:20 have yet to sail.
    assert.equal((board.html().match(/class="row past"/g) || []).length, 1);
    assert.match(board.html(), /id="hidePast"/);
    board.run("$('hidePast').click();");
    assert.equal(board.count(), 1);
    assert.match(board.html(), /id="showPast"/);
  });
}

for (const [dir, offset, tag] of [['SG', '+08:00', 'SGT'], ['ID', '+07:00', 'WIB']]) {
  test(`${tag}: closed sailing changes to departed at its departure time`, () => {
    const board = boardAt(`2026-11-10T21:19:59${offset}`, dir);
    board.run(`
      D.splice(0, D.length,
        ...E('${dir}','majestic','${dir === 'SG' ? 'HarbourFront' : 'Batam Centre'}','${dir === 'SG' ? 'Batam Centre' : 'HarbourFront'}',['21:20','21:35']));
      $('dates').children[0].click();
      state.showPast=true; renderAll();
    `);
    const row = index => board.html().match(new RegExp(`<li><button class="row[^\"]*" type="button" data-i="${index}">[\\s\\S]*?</button></li>`))[0];
    assert.match(row(0), />Check-in closed</);
    assert.doesNotMatch(row(0), />Departed</);

    board.advance(`2026-11-10T21:20:00${offset}`);
    assert.match(row(0), /class="row past"/);
    assert.match(row(0), />Departed</);
    assert.doesNotMatch(row(0), />Check-in closed</);
    assert.match(row(1), />Check-in closed</);

    board.advance(`2026-11-10T21:34:00${offset}`);
    assert.match(row(0), />Departed</);
    assert.match(row(1), />Check-in closed</);
  });
}

for (const [dir, offset, tag] of [['SG', '+08:00', 'SGT'], ['ID', '+07:00', 'WIB']]) {
  test(`${tag}: the final cutoff automatically selects tomorrow, with Today still browsable`, () => {
    const board = boardAt(`2026-11-10T12:04:59${offset}`, dir);
    fixture(board);
    assert.equal(board.run('state.date'), '2026-11-10');
    board.advance(`2026-11-10T12:05:00${offset}`);
    assert.equal(board.run('state.date'), '2026-11-11');
    assert.equal(board.nodes.get('dates').children[0].getAttribute('aria-selected'), 'false');
    assert.equal(board.nodes.get('dates').children[1].getAttribute('aria-selected'), 'true');
    assert.equal(board.heroTime(), '11:30');
    assert.equal(board.count(), 4);
    assert.match(board.nodes.get('resultsDate').textContent, /^Tomorrow/);
    assert.equal(board.nodes.get('heroK').textContent, 'First departure');
    board.run("$('dates').children[0].click();");
    assert.equal(board.run('state.date'), '2026-11-10');
    assert.equal(board.nodes.get('heroK').textContent, 'Check-in closed for today');
    board.run("$('showPast').click();");
    assert.equal(board.count(), 4);
    assert.match(board.html(), /id="hidePast"/);
    board.advance(`2026-11-10T12:41:00${offset}`);
    assert.equal(board.run('state.date'), '2026-11-10');
  });

  test(`${tag}: a saved plan holds Today until departure, including on reload`, () => {
    const plan = {date:'2026-11-10',dir,brand:'majestic',
      from:dir==='SG'?'HarbourFront':'Batam Centre',to:dir==='SG'?'Batam Centre':'HarbourFront',time:'12:40'};
    const saved = {'sgbatam.plans.v1':JSON.stringify([plan])};
    const board = boardAt(`2026-11-10T12:05:00${offset}`, dir, saved);
    fixture(board);
    assert.equal(board.run('state.date'), '2026-11-10');
    assert.equal(board.nodes.get('dayPlans').hidden, false);
    assert.match(board.nodes.get('dayPlans').innerHTML, /12:40/);
    board.advance(`2026-11-10T12:39:59${offset}`);
    assert.equal(board.run('state.date'), '2026-11-10');
    board.advance(`2026-11-10T12:40:00${offset}`);
    assert.equal(board.run('state.date'), '2026-11-11');
    assert.equal(board.nodes.get('dayPlans').hidden, true);
    assert.deepEqual(JSON.parse(board.storage.get('sgbatam.plans.v1')), [plan]);
    const reload = boardAt(`2026-11-10T23:00:00${offset}`, dir, saved);
    assert.equal(reload.run('state.date'), '2026-11-11');
  });
}

test('a pending plan in the other direction holds Today outside all active filters', () => {
  const plan = {date:'2026-11-10',dir:'ID',brand:'sindo',from:'Sekupang',to:'HarbourFront',time:'12:00'};
  const board = boardAt('2026-11-10T12:05:00+08:00','SG',{'sgbatam.plans.v1':JSON.stringify([plan])});
  fixture(board);
  board.run("state.brands=new Set(['majestic']);renderAll();");
  assert.equal(board.run('state.date'), '2026-11-10');
  assert.match(board.nodes.get('dayPlans').innerHTML, /Sekupang/);
  board.resume('2026-11-10T13:00:00+08:00');
  assert.equal(board.run('state.date'), '2026-11-11');
});

test('removing the last pending plan advances Today when check-in is closed', () => {
  const board = boardAt('2026-11-10T12:04:00+08:00');
  fixture(board);
  board.run("openDetail(D.find(e=>e.dir==='SG'&&e.time==='12:40'));addPlan(current);");
  board.advance('2026-11-10T12:05:00+08:00');
  assert.equal(board.run('state.date'), '2026-11-10');
  board.run("$('planTripBtn').click();");
  assert.equal(board.run('state.date'), '2026-11-11');
  assert.equal(board.run('current.date'), '2026-11-10');
});

test('future dates show the full day without applying today\'s cutoff', () => {
  const board = boardAt('2026-11-10T22:00:00+08:00');
  fixture(board);
  board.run('state.date=DATES[1].ymd; renderAll();');
  assert.equal(board.heroTime(), '11:30');
  assert.equal(board.nodes.get('heroK').textContent, 'First departure');
  assert.equal(board.count(), 4);
  assert.match(board.html(), /Rest of the day/);
  assert.doesNotMatch(board.html(), /Check-in closed|id="showPast"/);
});

test('filters apply to the available sailing and the next-day suggestion', () => {
  const board = boardAt('2026-11-10T11:45:00+08:00');
  fixture(board);
  board.run(`
    D.push(...E('SG','sindo','HarbourFront','Batam Centre',['12:30']));
    state.brands=new Set(['majestic']); renderAll();
  `);
  assert.equal(board.heroTime(), '12:40');
  assert.equal(board.count(), 1);
  board.advance('2026-11-10T12:05:00+08:00');
  assert.match(board.nodes.get('heroBody').innerHTML, /Majestic/);
  assert.doesNotMatch(board.nodes.get('heroBody').innerHTML, /Sindo/);
  board.run("state.brands=new Set(['horizon']); renderAll();");
  assert.equal(board.nodes.get('heroK').textContent, 'No sailings');
  assert.equal(board.count(), 0);
  assert.match(board.html(), /No sailings match/);
});

test('no next-day service shows an empty tomorrow instead of closed sailings', () => {
  const board = boardAt('2026-11-10T12:05:00+08:00');
  fixture(board);
  board.run('D.forEach(e=>e.days=[2]); renderAll();');
  assert.equal(board.run('state.date'), '2026-11-11');
  assert.equal(board.nodes.get('heroK').textContent, 'No sailings');
  assert.match(board.html(), /Try another day/);
  assert.doesNotMatch(board.nodes.get('heroBody').innerHTML, /tomorrow/);
});

test('returning to the page refreshes eligibility and local midnight resets the day', () => {
  const board = boardAt('2026-11-10T11:44:00+08:00');
  fixture(board);
  board.resume('2026-11-10T11:45:00+08:00');
  assert.equal(board.heroTime(), '12:40');
  board.advance('2026-11-11T00:00:00+08:00');
  assert.equal(board.run('state.date'), '2026-11-11');
  assert.equal(board.heroTime(), '11:30');
  assert.equal(board.count(), 4);
});

test('the same instant uses the departure port\'s local cutoff in each direction', () => {
  const sg = boardAt('2026-11-10T04:00:00Z', 'SG');
  const id = boardAt('2026-11-10T04:00:00Z', 'ID');
  fixture(sg);
  fixture(id);
  assert.equal(sg.heroTime(), '12:40');
  assert.equal(id.heroTime(), '12:00');
  assert.equal(sg.count(), 1);
  assert.equal(id.count(), 3);
});

const outbound = `D.find(e=>e.dir==='SG'&&e.brand==='sindo'&&e.from==='HarbourFront'&&e.to==='Batam Centre'&&e.time==='09:00')`;

test('the plan button saves once, persists on reload, and removes the same plan', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  board.run(`openDetail(${outbound}); $('planTripBtn').click(); addPlan(current);`);
  assert.equal(board.run('plans.length'), 1);
  assert.equal(board.nodes.get('planTripBtn').textContent, 'Remove from my plans');
  assert.equal(board.run('plans.length'), 1);
  assert.equal(JSON.parse(board.storage.get('sgbatam.plans.v1')).length, 1);
  const reloaded = boardAt('2026-11-10T06:50:00+08:00', 'SG', Object.fromEntries(board.storage));
  assert.equal(reloaded.run('plans.length'), 1);
  reloaded.run(`openDetail(${outbound}); $('planTripBtn').click();`);
  assert.equal(reloaded.run('plans.length'), 0);
  assert.equal(reloaded.nodes.get('planTripBtn').textContent, 'I’m taking this ferry');
  assert.deepEqual(JSON.parse(reloaded.storage.get('sgbatam.plans.v1')), []);
});

test('saved sailing dates, direction, share text and calendar survive board changes', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  board.run(`openDetail(${outbound}); addPlan(current); state.dir='ID';state.date='2026-11-11';state.brands=new Set(['horizon']);openDetail(plans[0]);`);
  assert.equal(board.nodes.get('dTitle').textContent, 'Tuesday, 10 Nov 2026');
  assert.match(board.nodes.get('dBody').innerHTML, /~09:30/);
  assert.match(board.run('shareText(current)'), /09:00 SGT.*HarbourFront → Batam Centre.*10 Nov 2026/);
  const calendar = board.run('calendarText(current)');
  assert.match(calendar, /DTSTART:20261110T010000Z/);
  assert.match(calendar, /DTEND:20261110T023000Z/);
  assert.match(calendar, /TRIGGER:-PT35M/);
  assert.match(calendar, /08:25 SGT/);
});

test('same-day countdown updates in the open details and closes at the exact cutoff', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  board.run(`openDetail(${outbound});`);
  assert.match(board.nodes.get('dBody').innerHTML, /1h 35m left/);
  board.advance('2026-11-10T08:10:00+08:00');
  assert.match(board.nodes.get('dBody').innerHTML, /15 min left/);
  board.advance('2026-11-10T08:25:00+08:00');
  assert.match(board.nodes.get('dBody').innerHTML, /Check-in closed/);
  assert.match(board.nodes.get('dBody').innerHTML, /just closed/);
  board.run(`openDetail(${outbound},'2026-11-11');`);
  assert.doesNotMatch(board.nodes.get('dBody').innerHTML, /left|ago|just closed/);
});

test('countdowns check the sailing date in its own port timezone across midnight', () => {
  const board = boardAt('2026-11-11T00:30:00+08:00');
  assert.match(board.run(`checkinHTML({...${outbound},date:'2026-11-11'})`), /left/);
  assert.doesNotMatch(board.run(`checkinHTML({...D.find(e=>e.dir==='ID'),date:'2026-11-11'})`), /left|ago|just closed/);
});

test('planned cards ignore board filters and identify a departed sailing on its date', () => {
  const board = boardAt('2026-11-10T10:00:00+08:00');
  board.run(`openDetail(${outbound},'2026-11-10');addPlan(current);openDetail(${outbound},'2026-11-11');addPlan(current);state.dir='ID';state.brands=new Set(['horizon']);renderAll();`);
  assert.equal(board.run('plans.length'), 2);
  assert.match(board.nodes.get('dayPlans').innerHTML, /Planned trip · Departed/);
  assert.match(board.nodes.get('dayPlans').innerHTML, /09:00/);
});

test('corrupt storage, invalid dates and injected fields cannot create saved trip markup', () => {
  const valid = { date:'2026-11-11', dir:'SG', brand:'sindo', from:'HarbourFront', to:'Batam Centre', time:'09:00' };
  const saved = [valid, valid, {...valid,date:'2026-02-30'}, {...valid,brand:'<script>'}, {...valid,from:'<img src=x>'}, {...valid,dir:'ID'}];
  const board = boardAt('2026-11-10T06:50:00+08:00','SG',{'sgbatam.plans.v1':JSON.stringify(saved)});
  assert.equal(board.run('plans.length'), 1);
  const broken = boardAt('2026-11-10T06:50:00+08:00','SG',{'sgbatam.plans.v1':'{broken'});
  assert.equal(broken.run('plans.length'), 0);
});

test('calendar export uses WIB independently of the current SG board', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  const calendar = board.run(`calendarText({...D.find(e=>e.dir==='ID'&&e.brand==='sindo'&&e.from==='Batam Centre'&&e.to==='HarbourFront'&&e.time==='18:20'),date:'2026-11-11'})`);
  assert.match(calendar, /DTSTART:20261111T112000Z/);
  assert.match(calendar, /DTEND:20261111T125000Z/);
  assert.match(calendar, /17:45 WIB/);
});

test('the selected day shows its planned hero cards above available sailings, across filters and directions', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  board.run(`openDetail(${outbound});addPlan(current);state.dir='ID';state.brands=new Set(['horizon']);renderAll();`);
  assert.equal(board.nodes.get('dayPlans').hidden, false);
  assert.match(board.nodes.get('dayPlans').innerHTML, /Planned trip/);
  assert.match(board.nodes.get('dayPlans').innerHTML, /Sindo/);
  assert.match(board.nodes.get('dayPlans').innerHTML, /09:00/);
  assert(markup.indexOf('id="dayPlans"') < markup.indexOf('id="hero"'));
  board.run("state.date='2026-11-11';renderAll();");
  assert.equal(board.nodes.get('dayPlans').hidden, true);
  board.run("state.date='2026-11-10';renderAll();$('planTripBtn').click();");
  assert.equal(board.nodes.get('dayPlans').hidden, true);
});

test('switching direction across local midnight does not reset a selected return date', () => {
  const board = boardAt('2026-11-11T00:30:00+08:00');
  board.run("state.dir='ID';state.date='2026-11-12';");
  board.advance('2026-11-11T00:30:01+08:00');
  assert.equal(board.run('state.dir'), 'ID');
  assert.equal(board.run('state.date'), '2026-11-12');
});

test('planning the hero shows only its planned card; removing restores the normal hero', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  assert.equal(board.heroTime(), '07:40');
  board.run('openDetail(heroTrip);addPlan(current);');
  assert.equal(board.heroTime(), undefined);
  assert.equal(board.nodes.get('hero').hidden, true);
  assert.match(board.nodes.get('dayPlans').innerHTML, /07:40/);
  assert.doesNotMatch(board.html(), /07:40/);
  board.run("$('planTripBtn').click();");
  assert.equal(board.heroTime(), '07:40');
  assert.equal(board.nodes.get('heroK').textContent, 'Next available sailing');
});

test('a planned sailing elsewhere stays in the list with a right-side marker and leaves the hero unchanged', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  board.run(`openDetail(${outbound});addPlan(current);`);
  assert.equal(board.heroTime(), '07:40');
  assert.equal(board.nodes.get('hero').hidden, false);
  assert.match(board.html(), /09:00/);
  assert.match(board.html(), /class="planned-marker" role="img" aria-label="Planned trip"/);
  assert.equal((board.html().match(/class="planned-marker"/g) || []).length, 1);
  assert.equal(board.run('VIEW.some(e=>isPlanned({...e,date:state.date}))'), true);
  board.run("$('planTripBtn').click();");
  assert.doesNotMatch(board.html(), /class="planned-marker"/);
});

test('a new choice replaces that day and direction while preserving the return and other days', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  board.run(`
    openDetail(D.find(e=>e.dir==='SG'&&e.time==='07:40'),'2026-11-11');addPlan(current);
    openDetail(D.find(e=>e.dir==='ID'&&e.time==='18:20'),'2026-11-11');addPlan(current);
    openDetail(${outbound},'2026-11-11');addPlan(current);
  `);
  assert.equal(board.run('plans.length'), 2);
  assert.equal(board.run("plans.find(t=>t.dir==='SG').time"), '09:00');
  assert.equal(board.run("plans.find(t=>t.dir==='ID').time"), '18:20');
  assert.match(board.nodes.get('toast').textContent, /has been changed/);
  board.run(`openDetail(${outbound},'2026-11-12');addPlan(current);`);
  assert.equal(board.run('plans.length'), 3);
  const reload = boardAt('2026-11-10T06:50:00+08:00','SG',Object.fromEntries(board.storage));
  assert.equal(reload.run('plans.length'), 3);
});

test('older saves with duplicate directions migrate to the last choice per date/direction', () => {
  const sg = {date:'2026-11-11',dir:'SG',brand:'batamfast',from:'HarbourFront',to:'Batam Centre',time:'07:40'};
  const replacement = {...sg,brand:'sindo',time:'08:00'};
  const back = {date:'2026-11-11',dir:'ID',brand:'sindo',from:'Batam Centre',to:'HarbourFront',time:'18:20'};
  const board = boardAt('2026-11-10T06:50:00+08:00','SG',{'sgbatam.plans.v1':JSON.stringify([sg,back,replacement])});
  assert.equal(board.run('plans.length'), 2);
  assert.equal(board.run("plans.find(t=>t.dir==='SG').time"), '08:00');
  assert.equal(JSON.parse(board.storage.get('sgbatam.plans.v1')).length, 2);
});

test('a planned-only route hides the duplicate hero without a misleading empty state', () => {
  const board = boardAt('2026-11-10T06:50:00+08:00');
  board.run(`D.splice(0,D.length,...E('SG','sindo','HarbourFront','Batam Centre',['09:00']));renderAll();openDetail(heroTrip);addPlan(current);`);
  assert.equal(board.heroTime(), undefined);
  assert.equal(board.nodes.get('hero').hidden, true);
  assert.equal(board.html(), '');
  assert.equal(board.count(), 1);
});

test('the sticky summary appears only after every planned card is fully behind the stuck filters', () => {
  const board = boardAt('2026-11-10T11:40:00+08:00');
  fixture(board);
  const controls = { top: 20, bottom: 132 };
  const cards = { top: 148, bottom: 400 };
  board.nodes.get('sticky').getBoundingClientRect = () => controls;
  board.nodes.get('dayPlans').getBoundingClientRect = () => cards;
  board.run("openDetail(D.find(e=>e.dir==='SG'&&e.time==='12:20'));addPlan(current);");
  const bar = board.nodes.get('stickyPlan');
  assert.equal(bar.hidden, true);
  controls.top = 0; controls.bottom = 112;
  board.run('syncStickyPlanVisibility();');
  assert.equal(bar.hidden, true, 'sticking the filters alone does not reveal the bar');
  cards.bottom = 113;
  board.run('syncStickyPlanVisibility();');
  assert.equal(bar.hidden, true, 'even a partly visible planned card keeps the bar hidden');
  cards.bottom = 112;
  board.run('syncStickyPlanVisibility();');
  assert.equal(bar.hidden, false);
  board.run('syncStickyPlanVisibility();');
  assert.equal(bar.hidden, false, 'rechecking does not toggle the bar');
  cards.bottom = 113;
  board.run('syncStickyPlanVisibility();');
  assert.equal(bar.hidden, true, 'scrolling back to the card hides the bar immediately');
  cards.bottom = 0; controls.top = 1;
  board.run('syncStickyPlanVisibility();');
  assert.equal(bar.hidden, true, 'the bar also requires stuck filters');
});

test('the sticky summary tracks check-in and departure, opens its saved trip and hides on removal or date change', () => {
  const board = boardAt('2026-11-10T11:40:00+08:00');
  fixture(board);
  board.nodes.get('sticky').getBoundingClientRect = () => ({ top: 0, bottom: 112 });
  board.nodes.get('dayPlans').getBoundingClientRect = () => ({ top: -200, bottom: 0 });
  board.run("state.browseToday=true;openDetail(D.find(e=>e.dir==='SG'&&e.time==='12:20'));addPlan(current);");
  assert.equal(board.nodes.get('stickyPlan').hidden, false);
  assert.equal(board.nodes.get('stickyPlanTime').textContent, '12:20');
  assert.equal(board.nodes.get('stickyPlanZone').textContent, 'SGT');
  assert.equal(board.nodes.get('stickyPlanCountdown').textContent, 'in 40 min');
  board.advance('2026-11-10T11:45:00+08:00');
  assert.equal(board.nodes.get('stickyPlanLabel').textContent, 'Planned · Check-in closed');
  board.advance('2026-11-10T12:20:00+08:00');
  assert.equal(board.nodes.get('stickyPlanCountdown').textContent, 'Departed');
  board.run("state.dir='ID';state.brands=new Set(['horizon']);renderAll();$('stickyPlanBtn').click();");
  assert.equal(board.run('current.dir'), 'SG');
  assert.equal(board.run('current.date'), '2026-11-10');
  assert.equal(board.run('current.time'), '12:20');
  board.run("state.date='2026-11-11';renderAll();");
  assert.equal(board.nodes.get('stickyPlan').hidden, true);
  board.run("state.date='2026-11-10';renderAll();$('planTripBtn').click();");
  assert.equal(board.nodes.get('stickyPlan').hidden, true);
});

test('multiple plans use the next actual departure and its own timezone even outside board filters', () => {
  const board = boardAt('2026-11-10T11:40:00+08:00');
  fixture(board);
  board.nodes.get('sticky').getBoundingClientRect = () => ({ top: 0, bottom: 112 });
  board.nodes.get('dayPlans').getBoundingClientRect = () => ({ top: -500, bottom: 0 });
  board.run(`
    state.browseToday=true;
    openDetail(D.find(e=>e.dir==='SG'&&e.time==='12:20'));addPlan(current);
    openDetail(D.find(e=>e.dir==='ID'&&e.time==='12:00'));addPlan(current);
    state.brands=new Set(['horizon']);renderAll();
  `);
  assert.equal(board.nodes.get('stickyPlanTime').textContent, '12:20');
  assert.equal(board.nodes.get('stickyPlanZone').textContent, 'SGT');
  board.advance('2026-11-10T12:20:00+08:00');
  assert.equal(board.nodes.get('stickyPlanTime').textContent, '12:00');
  assert.equal(board.nodes.get('stickyPlanZone').textContent, 'WIB');
  assert.equal(board.nodes.get('stickyPlanCountdown').textContent, 'in 40 min');
  assert.equal(board.nodes.get('stickyPlanRoute').textContent, 'Batam Centre → HarbourFront');
  board.run("$('stickyPlanBtn').click();");
  assert.equal(board.run('current.dir'), 'ID');
  board.run("openDetail(current,'2026-11-11');addPlan(current);state.date='2026-11-11';renderAll();");
  assert.equal(board.nodes.get('stickyPlanCountdown').textContent, 'Tomorrow');
});

test('removing a plan from the sticky summary returns focus to a visible control', () => {
  const board = boardAt('2026-11-10T11:40:00+08:00');
  fixture(board);
  board.nodes.get('sticky').getBoundingClientRect = () => ({ top: 0, bottom: 112 });
  board.nodes.get('dayPlans').getBoundingClientRect = () => ({ top: -200, bottom: 0 });
  board.nodes.get('stickyPlanBtn').isConnected = true;
  board.run(`
    openDetail(D.find(e=>e.dir==='SG'&&e.time==='12:20'));addPlan(current);hide();
    $('stickyPlanBtn').focus();$('stickyPlanBtn').click();
    $('planTripBtn').click();hide();
  `);
  assert.equal(board.nodes.get('stickyPlan').hidden, true);
  assert.equal(board.run("document.activeElement===$('heroTrip')"), true);
});
