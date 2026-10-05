const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp, FixtureElement} = require('./helpers/app-harness.cjs');

const key = (room = 'smallroom2') => `ttobok_v3_${room}_cur`;
const item = (name = 'Desk', extra = {}) => ({n: name, w: 100, d: 100, x: 1000, y: 1500, r: 0, ...extra});
const readItems = (app, room) => JSON.parse(app.localStorage.getItem(key(room)) || '{"items":[]}').items;
const furniture = (app) => app.node('room').querySelectorAll('.furn');

test('redrawing or refreshing layout does not save a room or schedule cloud writes', () => {
  const app = createApp({storage: {[key()]: {items: [item()], savedAt: 123}}});
  app.flushFrames();
  app.resetActivity();
  app.run('updateAll(false)');
  app.run('drawGeom()');
  app.flushFrames();
  app.dispatchWindow('resize');
  assert.equal(app.localStorage.writes.filter(({key: name}) => /_cur$/.test(name)).length, 0);
  assert.equal(app.cloudSchedules, 0);
});

test('boot preserves duplicate catalog placements so a repair cannot delete a saved layout', () => {
  const app = createApp({storage: {
    [key()]: {items: [item('소파'), item('소파', {x: 1200})], savedAt: 123},
    [key('living')]: {items: [item('소파', {x: 2000})], savedAt: 456},
  }});
  assert.equal(readItems(app).length, 2);
  assert.equal(readItems(app, 'living').length, 1);
  assert.equal(furniture(app).length, 2);
});

test('malformed collection is rejected before replacing the visible layout', () => {
  const app = createApp({storage: {[key()]: {items: [item('Keep me')], savedAt: 123}}});
  assert.doesNotThrow(() => app.run('renderItems({items:"not an array"})'));
  assert.equal(furniture(app).length, 1);
  assert.equal(furniture(app)[0].dataset.n, 'Keep me');
  assert.equal(app.run('suppressSave'), false);
});

test('invalid entries cannot crash rendering or disable subsequent saving', () => {
  const app = createApp();
  app.context.incoming = [item('Valid'), null, item('Invalid', {w: -20})];
  assert.doesNotThrow(() => app.run('renderItems(incoming)'));
  assert.deepEqual(furniture(app).map((node) => node.dataset.n), ['Valid']);
  assert.equal(app.run('suppressSave'), false);
});

test('custom names remain text in selection details and whole-house overlays', () => {
  const name = '<img src=x onerror="audit()">';
  const app = createApp({storage: {[key()]: {items: [item(name)], savedAt: 123}}});
  app.context.chosen = furniture(app)[0];
  app.run('select(chosen)');
  assert.ok(!/<img\b/i.test(app.node('status').innerHTML), 'selection details must not insert the name as HTML');
  assert.match(app.node('status').innerHTML, /&lt;img\b/, 'selection details must still display the supplied name');
  const layer = new FixtureElement();
  app.context.auditLayer = layer;
  app.run('renderHouseSavedItems(auditLayer, 1)');
  assert.ok(!/<img\b/i.test(layer.innerHTML), 'whole-house labels must not insert the name as HTML');
  assert.match(layer.innerHTML, /&lt;img\b/, 'whole-house labels must still display the supplied name');
});

test('the custom furniture form rejects negative sizes', () => {
  const app = createApp();
  app.node('nn').value = 'Invalid table';
  app.node('nw').value = '-100';
  app.node('nd').value = '200';
  app.node('addCustom').dispatch('click');
  assert.equal(furniture(app).length, 0);
  assert.ok(app.alerts.length > 0);
});

for (const event of ['pointercancel', 'lostpointercapture']) {
  test(`${event} ends dragging and later pointer moves cannot move furniture`, () => {
    const app = createApp({storage: {[key()]: {items: [item()], savedAt: 123}}});
    const node = furniture(app)[0];
    const initial = {x: node.dataset.x, y: node.dataset.y};
    node.dispatch('pointerdown', {pointerId: 7, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1, clientX: 100, clientY: 100});
    node.dispatch('pointermove', {pointerId: 7, buttons: 1, clientX: 110, clientY: 110});
    assert.notDeepEqual({x: node.dataset.x, y: node.dataset.y}, initial, 'a drag must start before cancellation is tested');
    node.dispatch(event, {pointerId: 7});
    const position = {x: node.dataset.x, y: node.dataset.y};
    node.dispatch('pointermove', {pointerId: 7, buttons: 0, clientX: 400, clientY: 400});
    assert.deepEqual({x: node.dataset.x, y: node.dataset.y}, position);
  });
}

test('moving furniture keeps its appliance type and never deletes a later selection', async () => {
  const app = createApp({storage: {[key()]: {items: [item('Appliance', {type: 'appliance'}), item('Other furniture')], savedAt: 123}}});
  const [source, other] = furniture(app);
  let finish;
  let appended;
  app.window.cloudAppendItem = (_target, value) => {
    appended = value;
    return new Promise((resolve) => { finish = resolve; });
  };
  app.node('targetRoom').value = 'living';
  app.context.source = source;
  app.context.other = other;
  app.run('select(source)');
  const moving = app.run('transferSelected("move")');
  app.run('select(other)');
  finish?.(true);
  await moving;
  assert.equal(source.isConnected, false);
  assert.equal(other.isConnected, true);
  assert.equal(readItems(app, 'living')[0].type, 'appliance');
  if (appended) assert.equal(appended.type, 'appliance');
});

test('a malformed target room cannot inherit furniture from the room being left', () => {
  const app = createApp({storage: {
    [key()]: {items: [item('Source-room table')], savedAt: 123},
    [key('living')]: {items: {broken: true}, savedAt: 456},
  }});
  const targetBefore = app.localStorage.getItem(key('living'));
  app.run('switchRoom("living")');
  if (app.run('rid') === 'living') {
    assert.equal(furniture(app).some((node) => node.dataset.n === 'Source-room table'), false);
  } else {
    assert.equal(app.run('rid'), 'smallroom2', 'refusing the invalid room is also safe');
  }
  assert.equal(app.localStorage.getItem(key('living')), targetBefore);
});

test('a failed local save must not report or cloud-save stale data as the current layout', async () => {
  const app = createApp({storage: {[key()]: {items: [item()], savedAt: 123}}});
  furniture(app)[0].dataset.x = 1600;
  const write = app.localStorage.setItem;
  app.localStorage.setItem = (name, value) => {
    if (name === key()) throw Object.assign(new Error('Full'), {name: 'QuotaExceededError'});
    write(name, value);
  };
  let flushes = 0;
  app.window.flushCloudSave = async () => { flushes += 1; return true; };
  const saved = await app.run('saveCurrentNow(true)');
  assert.equal(saved, false);
  assert.equal(flushes, 0, 'cloud saving reads local storage, which still contains the previous layout');
  assert.equal(readItems(app)[0].x, 1000);
});

test('a move rolls back if its source-room storage write fails', async () => {
  const app = createApp({storage: {
    [key()]: {items: [item('Move me')], savedAt: 123},
    [key('living')]: {items: [item('Existing target item')], savedAt: 456},
  }});
  const source = furniture(app)[0];
  app.context.source = source;
  app.run('select(source)');
  app.node('targetRoom').value = 'living';
  const write = app.localStorage.setItem;
  app.localStorage.setItem = (name, value) => {
    if (name === key()) throw Object.assign(new Error('Full'), {name: 'QuotaExceededError'});
    write(name, value);
  };
  let flushes = 0;
  app.window.flushCloudRooms = async () => { flushes += 1; return true; };
  await app.run('transferSelected("move")');
  assert.deepEqual(furniture(app).map((node) => node.dataset.n), ['Move me']);
  assert.deepEqual(readItems(app, 'living').map((entry) => entry.n), ['Existing target item']);
  assert.deepEqual(readItems(app).map((entry) => entry.n), ['Move me']);
  assert.equal(flushes, 0);
});

function deferredCloudRead(app, remote) {
  let release;
  const firstRead = new Promise((resolve) => { release = resolve; });
  let first = true;
  const snapshot = (id) => ({exists: () => Object.hasOwn(remote, id), data: () => remote[id]});
  app.loadSync({
    doc: (_, ...parts) => parts.at(-1),
    getDocFromServer: async (id) => {
      if (first) { first = false; await firstRead; }
      return snapshot(id);
    },
    onSnapshot: () => () => {},
  });
  return release;
}

test('pulling rooms preserves edits made to a later room while an earlier room is loading', async () => {
  const app = createApp({storage: {
    ttobok_current_room_v362: 'living',
    [key('living')]: {items: [item('Table')], savedAt: 123},
  }});
  const release = deferredCloudRead(app, {living: {roomId: 'living', items: [item('Table')], revision: 1, clientSavedAt: 123}});
  const pulling = app.window.pullAllRooms();
  furniture(app)[0].dataset.x = 1700;
  app.run('updateAll()');
  release();
  await pulling;
  assert.equal(readItems(app, 'living')[0].x, 1700, 'pull confirmation predates this user edit');
  assert.equal(app.window.TTOBOK_APP.getLocalRoomData('living').dirty, true);
});

test('a concurrent edit skipped by a pull still schedules its pending cloud save', async () => {
  const app = createApp({storage: {[key()]: {items: [item()], savedAt: 123}}});
  const release = deferredCloudRead(app, {smallroom2: {roomId: 'smallroom2', items: [item()], revision: 1, clientSavedAt: 123}});
  const pulling = app.window.pullAllRooms();
  furniture(app)[0].dataset.x = 1700;
  app.run('updateAll()');
  release();
  await pulling;
  assert.equal(readItems(app)[0].x, 1700);
  assert.equal(app.window.TTOBOK_APP.getLocalRoomData('smallroom2').dirty, true);
  assert.ok(app.pendingTimers > 0, 'autosaving paused during a pull must resume afterward');
});

test('a queued save cannot publish the discarded local layout during a cloud pull', async () => {
  const remote = {smallroom2: {roomId: 'smallroom2', items: [item('Table')], revision: 1, clientSavedAt: 100, updatedClientId: 'other'}};
  const app = createApp({storage: {[key()]: {
    items: [item('Table', {x: 1700})], savedAt: 200, dirty: true, localRevision: 1,
    baseVersion: JSON.stringify([1, 100, 'other']),
  }}});
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const snap = (value) => ({exists: () => value !== undefined, data: () => value});
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let first = true;
  const writes = [];
  app.loadSync({
    doc: (_, ...parts) => parts.at(-1), serverTimestamp: () => ({seconds: 1}),
    getDocFromServer: async (id) => {
      const data = remote[id] === undefined ? undefined : clone(remote[id]);
      if (first) { first = false; await waiting; }
      return snap(data);
    },
    runTransaction: async (_, action) => {
      const pending = [];
      const result = await action({get: async (id) => snap(remote[id]), set: (id, value) => pending.push({id, value})});
      for (const {id, value} of pending) { remote[id] = clone(value); writes.push(id); }
      return result;
    },
    onSnapshot: () => () => {},
  });
  const pulling = app.window.pullAllRooms();
  const saving = app.window.flushCloudRooms(['smallroom2']);
  for (let turn = 0; turn < 15; turn += 1) await Promise.resolve();
  const writesDuringPull = writes.length;
  release();
  await Promise.all([pulling, saving]);
  assert.equal(writesDuringPull, 0);
  assert.equal(readItems(app)[0].x, 1000);
  assert.equal(remote.smallroom2.items[0].x, 1000);
});

test('missing legacy migration marker cannot rewrite a modern master layout or measured geometry', () => {
  const baseline = createApp();
  const geometry = JSON.parse(JSON.stringify(baseline.window.TTOBOK_APP.getGeomForRoom('master')));
  geometry.w = 4000;
  const current = {items: [item('Current master table', {y: 2000})], geometry, savedAt: 500, localRevision: 7, dirty: true};
  const app = createApp({storage: {
    ttobok_master_v318_migrated: '',
    ttobok_geometry_v37: {master: geometry},
    [key('master')]: current,
    ttobok_v3_masterSuite_cur: {items: [item('Older suite table', {y: 300})], savedAt: 100},
  }});
  assert.deepEqual(JSON.parse(app.localStorage.getItem(key('master'))), current);
  assert.deepEqual(JSON.parse(app.localStorage.getItem('ttobok_geometry_v37')).master, geometry);
});

test('malformed legacy master entries cannot block startup or overwrite their saved source', () => {
  const current = {items: [null], savedAt: 500};
  let app;
  assert.doesNotThrow(() => {
    app = createApp({storage: {
      ttobok_master_v318_migrated: '',
      [key('master')]: current,
    }});
  });
  assert.deepEqual(JSON.parse(app.localStorage.getItem(key('master'))), current);
});

test('a live room update received during a long pull is applied when the pull finishes', async () => {
  const app = createApp({storage: {[key()]: {items: [item('Table')], savedAt: 100}}});
  let remote = {roomId: 'smallroom2', items: [item('Table')], revision: 1, clientSavedAt: 100};
  const snapshot = (data) => ({exists: () => data !== undefined, data: () => data, metadata: {fromCache: false, hasPendingWrites: false}});
  let listener;
  let release;
  let signalStarted;
  const waiting = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { signalStarted = resolve; });
  app.loadSync({
    doc: (_, ...parts) => parts.at(-1),
    getDocFromServer: async (id) => {
      if (id === 'smallroom1') { signalStarted(); await waiting; }
      return snapshot(id === 'smallroom2' ? remote : undefined);
    },
    onSnapshot: (_id, ...args) => {
      const callback = args.find((arg) => typeof arg === 'function');
      listener = callback;
      queueMicrotask(() => { if (listener === callback) callback(snapshot(remote)); });
      return () => { if (listener === callback) listener = null; };
    },
  });
  app.run('listen()');
  await Promise.resolve();
  const pulling = app.window.pullAllRooms();
  await started;
  remote = {...remote, items: [item('Table', {x: 1900})], revision: 2, clientSavedAt: 200};
  listener(snapshot(remote));
  release();
  await pulling;
  await Promise.resolve();
  assert.equal(readItems(app)[0].x, 1900);
});
