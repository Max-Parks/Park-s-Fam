const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.cjs');
test('edited bathroom door dimensions survive normalization and labels',()=>{
 const app=createApp();
 const g=app.run("normalizeGeom('ensuite',{...ROOM_DEFAULTS.ensuite,dw:700,dp:160,doorNominalW:700})");
 assert.equal(g.dw,700);assert.equal(g.dp,160);assert.equal(g.doorNominalW,700);
 const c=app.run("normalizeGeom('commonbath',{...ROOM_DEFAULTS.commonbath,dw:750,doorNominalW:750})");assert.equal(c.doorNominalW,750);
});
test('accepted notches and slants are drawn at their saved dimensions',()=>{
 const app=createApp();
 const laundry=JSON.parse(JSON.stringify(app.run("laundryPoly({w:1600,h:1200,notchW:1550,notchD:1150})")));
 assert.ok(laundry.some(p=>p[0]===1550&&p[1]===50));
 const bath=JSON.parse(JSON.stringify(app.run("ensuitePoly({w:1680,h:2300,slantW:1600,slantD:2200})")));
 assert.deepEqual(bath[0],[1600,0]);assert.deepEqual(bath.at(-1),[0,2200]);
});
test('old shape version does not erase measured room dimensions',()=>{
 const app=createApp();
 for(const id of ['smallroom1','living','laundry','commonbath']){
  app.context.auditRoom=id;
  assert.equal(app.run("normalizeGeom(auditRoom,{...ROOM_DEFAULTS[auditRoom],w:3210,shapeVersion:'legacy'}).w"),3210);
 }
});
test('moving bedroom openings moves the real collision walls too',()=>{
 const app=createApp();app.run("rid='master';GEOMS.master={...ROOM_DEFAULTS.master,passX:2010,passW:600,entryX:500,entryW:800,balOpenX:500,balOpenW:1000}");
 const walls=JSON.parse(JSON.stringify(app.run('suiteWalls()')));
 assert.ok(walls.some(w=>w.y>5100&&w.x===1500&&w.w===2100));
 assert.equal(walls.some(w=>w.y<1300&&w.x<1300&&w.x+w.w>500),false);
});
