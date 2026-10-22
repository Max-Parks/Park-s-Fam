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

test('keyboard users can select a saved furniture item and rotate it', () => {
 const app=createApp({storage:{[key]:{items:[desk],savedAt:123}}});
 const item=app.node('room').querySelector('.furn');
 assert.equal(item.getAttribute('tabindex'),'0');
 assert.equal(item.getAttribute('role'),'button');
 item.onkeydown({key:'Enter',preventDefault(){}});
 assert.equal(app.node('rot').disabled,false);
 app.node('rot').onclick();
 assert.equal(JSON.parse(app.localStorage.getItem(key)).items[0].r,90);
 assert.equal(item.getAttribute('aria-pressed'),'true');
});

test('leaving mobile width exits diagram focus mode without touching saved furniture', () => {
 const app=createApp({storage:{[key]:{items:[desk],savedAt:123}}});
 app.window.innerWidth=390;app.window.innerHeight=844;
 app.node('mobileView').onclick();
 assert.equal(app.document.body.classList.contains('mobile-focus'),true);
 app.window.innerWidth=1200;app.window.innerHeight=900;
 app.dispatchWindow('resize',{});
 assert.equal(app.document.body.classList.contains('mobile-focus'),false);
 assert.deepEqual(JSON.parse(app.localStorage.getItem(key)).items,[desk]);
});

test('Escape closes mobile diagram focus mode', () => {
 const app=createApp();app.window.innerWidth=390;app.window.innerHeight=844;
 app.node('mobileView').onclick();
 app.document.body.dispatch('keydown',{key:'Escape'});
 assert.equal(app.document.body.classList.contains('mobile-focus'),false);
});

test('Escape during pending browser fullscreen cancels a late entry without changing the saved layout', async () => {
 const app=createApp({storage:{[key]:{items:[desk],savedAt:123}}});
 let completeEntry,exitCalls=0;
 app.document.documentElement={requestFullscreen:()=>new Promise(resolve=>{
  completeEntry=()=>{
   app.document.fullscreenElement=app.document.documentElement;
   app.document.body.dispatch('fullscreenchange',{});
   resolve();
  };
 })};
 app.document.exitFullscreen=()=>{
  exitCalls++;
  app.document.fullscreenElement=null;
  app.document.body.dispatch('fullscreenchange',{});
  return Promise.resolve();
 };
 app.node('mobileView').onclick();
 app.document.body.dispatch('keydown',{key:'Escape'});
 assert.equal(app.document.body.classList.contains('mobile-focus'),false);
 completeEntry();await Promise.resolve();
 assert.equal(app.document.body.classList.contains('mobile-focus'),false,'late browser entry must not reopen canceled focus');
 assert.equal(app.document.fullscreenElement,null,'late browser fullscreen must be exited');
 assert.equal(exitCalls,1);
 assert.deepEqual(JSON.parse(app.localStorage.getItem(key)).items,[desk]);
});
