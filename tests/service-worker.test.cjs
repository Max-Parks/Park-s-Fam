const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker() {
  const handlers = {}, deleted = [], fetched = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), {
    self: {location: {origin: 'https://example.com'}, addEventListener: (n, f) => {handlers[n] = f;}, skipWaiting: async () => {}, clients: {claim: async () => {}}},
    caches: {keys: async () => ['ttobok-v362-app-1', 'ttobok-v363-app-1', 'another-app-cache'], delete: async k => deleted.push(k), open: async () => ({put: async () => {}})},
    fetch: async url => {fetched.push(url); return {ok: true};}, URL,
  });
  return {handlers, deleted, fetched};
}

test('updating the planner only removes previous planner caches', async () => {
  const w = worker(); let done;
  w.handlers.activate({waitUntil: p => {done = p;}}); await done;
  assert.deepEqual(w.deleted, ['ttobok-v362-app-1']);
});

test('offline app shell includes the geometry engine used during startup', async () => {
  const w = worker(); let done;
  w.handlers.install({waitUntil: p => {done = p;}}); await done;
  assert.ok(w.fetched.includes('./geometry-core.js'));
});
