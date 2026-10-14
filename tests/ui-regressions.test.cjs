const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp} = require('./helpers/app-harness.cjs');
const key = 'ttobok_v3_smallroom2_cur';
const desk = {n:'아주 긴 이름의 아기방 수납장',w:600,d:400,x:1000,y:1600,r:0};

test('whole-house interiors contain short markers instead of overlapping names and notes', () => {
 const app=createApp({storage:{[key]:{items:[desk],savedAt:123}}});
 app.run("switchRoom('house')");app.flushFrames();
 for(const id of ['suiteLayer','fixedLayer','edgeLayer']){
  assert.doesNotMatch(app.node(id).textContent,/[가-힣]/,`${id} should move descriptions outside the plan`);
 }
 assert.match(app.node('houseLegendList').textContent,/작은방 2/);
 assert.match(app.node('houseLegendList').textContent,/아주 긴 이름의 아기방 수납장/);
 assert.match(app.node('houseLegendList').textContent,/600 × 400/);
 assert.deepEqual(JSON.parse(app.localStorage.getItem(key)).items,[desk]);
});

test('rotation controls report selection, rotate saved dimensions and reset when switching rooms', () => {
 const app=createApp({storage:{[key]:{items:[desk],savedAt:123}}});
 assert.equal(app.node('rot').disabled,true,'rotation is disabled until furniture is selected');
 app.run("select(room.querySelector('.furn'))");
 assert.equal(app.node('rot').disabled,false);
 app.node('rot').onclick();
 assert.equal(JSON.parse(app.localStorage.getItem(key)).items[0].r,90);
 assert.match(app.node('selectionName').textContent,/아주 긴 이름/);
 app.node('rot').onclick();
 assert.equal(JSON.parse(app.localStorage.getItem(key)).items[0].r,0);
 app.run("switchRoom('house')");app.flushFrames();
 assert.equal(app.node('rot').disabled,true);
 assert.match(app.node('selectionName').textContent,/각 방/);
});
