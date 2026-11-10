const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const markup = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

function worker(scope = 'https://example.test/sg_to_other/') {
  const handlers = new Map();
  const stores = new Map();
  const fetched = [];
  let claimed = false;
  let failInstall = false;
  const context = vm.createContext({
    URL, Request,
    self: {
      registration: { scope },
      clients: { claim: async () => { claimed = true; } },
      addEventListener: (name, fn) => handlers.set(name, fn),
    },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async key => stores.delete(key),
      open: async key => {
        if (!stores.has(key)) stores.set(key, new Map());
        const store = stores.get(key);
        return {
          addAll: async requests => {
            if (failInstall) throw new Error('download failed');
            for (const request of requests) {
              assert.equal(request.cache, 'reload');
              store.set(request.url, { url: request.url, saved: true });
            }
          },
          match: async request => store.get(typeof request === 'string' ? request : request.url),
        };
      },
    },
    fetch: async request => { fetched.push(request.url); return { network: true }; },
  });
  vm.runInContext(read('sw.js'), context);
  return {
    stores, fetched,
    get claimed() { return claimed; },
    fail() { failInstall = true; },
    value: code => vm.runInContext(code, context),
    lifecycle(name) {
      let pending;
      handlers.get(name)({ waitUntil: promise => { pending = promise; } });
      return pending;
    },
    fetch(url, mode = 'cors', method = 'GET') {
      let pending;
      handlers.get('fetch')({
        request: { url, mode, method },
        respondWith: promise => { pending = promise; },
      });
      return pending;
    },
  };
}

test('manifest launches within both root and GitHub Pages scopes; PNGs have their declared sizes', () => {
  assert.equal(manifest.display, 'standalone');
  for (const base of ['https://example.test/', 'https://example.test/sg_to_other/']) {
    for (const key of ['start_url', 'scope']) assert.equal(new URL(manifest[key], base).href, base);
  }
  // Omit id so it defaults to the resolved start_url. A relative id resolves
  // against the start URL's origin, which would collapse repository apps to /.
  assert.equal(manifest.id, undefined);
  for (const icon of [...manifest.icons, { src: 'icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const data = readFileSync(resolve(root, icon.src));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`, icon.sizes);
  }
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
});

test('precache contains every local page dependency with the exact asset version', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  const assets = Array.from(sw.value('ASSETS'));
  const dependencies = [...markup.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  for (const dependency of dependencies) {
    assert.ok(assets.includes(new URL(dependency, 'https://example.test/sg_to_other/').href), dependency);
  }
  for (const asset of assets) readFileSync(resolve(root, new URL(asset).pathname.replace('/sg_to_other/', '')));
});

test('offline navigation handles root, index and queries under either deployment scope', async () => {
  for (const scope of ['https://example.test/', 'https://example.test/sg_to_other/']) {
    const sw = worker(scope);
    await sw.lifecycle('install');
    for (const path of ['', '?source=homescreen', 'index.html', 'index.html?trip=123']) {
      const result = await sw.fetch(scope + path, 'navigate');
      assert.equal(result.saved, true);
      assert.equal(result.url, scope + 'index.html');
    }
    for (const asset of Array.from(sw.value('ASSETS'))) assert.equal((await sw.fetch(asset)).saved, true);
    assert.deepEqual(sw.fetched, []);
    assert.equal(sw.fetch(scope + 'missing.html', 'navigate'), undefined);
    assert.equal(sw.fetch('https://example.test/another-app/', 'navigate'), undefined);
    assert.equal(sw.fetch('https://external.test/image.png'), undefined);
    assert.equal(sw.fetch(scope + 'app.js?v=28', 'cors', 'POST'), undefined);
  }
});

test('activation removes only old caches belonging to this app and scope', async () => {
  const sw = worker();
  const prefix = sw.value('CACHE_PREFIX');
  const current = sw.value('CACHE_NAME');
  const otherApp = 'ferry-departures:https://example.test/other/:v1';
  for (const key of [prefix + 'old', current, otherApp, 'unrelated']) sw.stores.set(key, new Map());
  await sw.lifecycle('activate');
  assert.equal(sw.claimed, true);
  assert.deepEqual([...sw.stores.keys()], [current, otherApp, 'unrelated']);
});

test('failed precache rejects installation and leaves the existing release intact', async () => {
  const sw = worker();
  const old = sw.value('CACHE_PREFIX') + 'old';
  sw.stores.set(old, new Map([['board', 'working release']]));
  sw.fail();
  await assert.rejects(sw.lifecycle('install'), /download failed/);
  assert.equal(sw.stores.get(old).get('board'), 'working release');
  assert.equal(sw.claimed, false);
});

function installUI({ installed = false, secure = true, online = true, serviceWorker = true } = {}) {
  const handlers = new Map();
  const nodes = new Map(['installHelp', 'installBtn', 'installStatus', 'offlineNote'].map(id => [id, {
    hidden: id === 'installBtn' || id === 'offlineNote', textContent: '',
    addEventListener(name, fn) { this[name] = fn; },
  }]));
  const registrations = [];
  const media = { matches: installed, addEventListener: (name, fn) => handlers.set('media:' + name, fn) };
  const navigator = { onLine: online };
  if (serviceWorker) navigator.serviceWorker = { register: async (...args) => {
    registrations.push(args); return { update: async () => {} };
  } };
  vm.runInNewContext(read('pwa.js'), {
    navigator, console,
    document: { getElementById: id => nodes.get(id), addEventListener() {} },
    window: { isSecureContext: secure, matchMedia: () => media, addEventListener: (name, fn) => handlers.set(name, fn) },
  });
  return { nodes, handlers, navigator, registrations };
}

test('install is offered only with a native prompt, consumed once, and hidden after installation', async () => {
  const ui = installUI();
  const button = ui.nodes.get('installBtn');
  assert.equal(button.hidden, true);
  let prevented = false;
  let prompted = 0;
  ui.handlers.get('beforeinstallprompt')({
    preventDefault() { prevented = true; },
    prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome: 'dismissed' }),
  });
  assert.equal(prevented, true);
  assert.equal(button.hidden, false);
  await button.click();
  await button.click();
  assert.equal(prompted, 1);
  assert.match(ui.nodes.get('installStatus').textContent, /install later/);
  ui.handlers.get('appinstalled')();
  assert.equal(ui.nodes.get('installHelp').hidden, true);
});

test('offline notice follows connectivity and installed windows hide install help', () => {
  const ui = installUI({ online: false, installed: true });
  assert.equal(ui.nodes.get('installHelp').hidden, true);
  assert.equal(ui.nodes.get('offlineNote').hidden, false);
  ui.navigator.onLine = true;
  ui.handlers.get('online')();
  assert.equal(ui.nodes.get('offlineNote').hidden, true);
});

test('service worker registration is relative, bypasses HTTP cache, and skips insecure or unsupported contexts', async () => {
  const ui = installUI();
  await ui.handlers.get('load')();
  assert.equal(ui.registrations[0][0], './sw.js');
  assert.equal(ui.registrations[0][1].updateViaCache, 'none');
  assert.equal(installUI({ secure: false }).handlers.has('load'), false);
  assert.equal(installUI({ serviceWorker: false }).handlers.has('load'), false);
});
