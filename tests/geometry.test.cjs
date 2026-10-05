const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../geometry-core.js');

const box = [[0,0],[1000,0],[1000,1000],[0,1000]];
const notch = [[0,0],[1000,0],[1000,1000],[600,1000],[600,600],[400,600],[400,1000],[0,1000]];
const baby = {w:2700,h:3590,dp:0,dw:930,doorLeafW:800,doorHingeOffset:65,doorSide:'top',doorHinge:'left'};
const almost = (a,b) => assert(Math.abs(a-b)<1e-6, `${a} != ${b}`);

test('concave notch crossing is rejected although corners and center are inside', () => {
  const a={x:100,y:100,w:800,h:800};
  const oldSamples=[[100,100],[900,100],[900,900],[100,900],[500,500]];
  assert(oldSamples.every(([x,y])=>G.pointInPolygon(x,y,notch)));
  assert.equal(G.rectangleInsidePolygon(a,notch),false);
});

test('thin notches are detected without a sample grid', () => {
  const p=[[0,0],[1000,0],[1000,1000],[712.01,1000],[712.01,600],[712,600],[712,1000],[0,1000]];
  assert.equal(G.rectangleInsidePolygon({x:100,y:100,w:800,h:800},p),false);
});

test('boundary contact is allowed; a rectangle filling an exterior notch is not', () => {
  assert.equal(G.rectangleInsidePolygon({x:0,y:0,w:1000,h:1000},box),true);
  assert.equal(G.rectangleInsidePolygon({x:400,y:600,w:200,h:400},notch),false);
  assert.equal(G.rectangleInsidePolygon({x:0,y:0,w:1000,h:600},notch),true);
});

test('diagonal boundaries reject crossing and accept exact contact', () => {
  const triangle=[[0,0],[1000,0],[0,1000]];
  assert.equal(G.rectangleInsidePolygon({x:100,y:100,w:400,h:400},triangle),true);
  assert.equal(G.rectangleInsidePolygon({x:100,y:100,w:401,h:400},triangle),false);
});

test('positive finite furniture dimensions and simple polygons are required', () => {
  for(const w of [0,-1,NaN,Infinity]) assert.equal(G.rectangleInsidePolygon({x:100,y:100,w,h:100},box),false);
  for(const x of [NaN,Infinity]) assert.equal(G.rectangleInsidePolygon({x,y:100,w:100,h:100},box),false);
  for(const p of [[],[[0,0],[1,1],[2,2]],[[0,0],[1000,1000],[0,1000],[1000,0]],[[0,0],[1000,0],[500,0],[0,1000]]]) {
    assert.equal(G.validatePolygon(p),false);
    assert.equal(G.rectangleInsidePolygon({x:100,y:100,w:100,h:100},p),false);
  }
  assert.equal(G.validatePolygon([...box,box[0]]),true);
  assert.equal(G.validatePolygon([...box].reverse()),true);
});

test('zero-depth or zero-width generated recesses remain valid', () => {
  const p=[[0,0],[2260,0],[2260,0],[2700,0],[2700,3590],[2150,3590],[2150,3590],[0,3590]];
  assert.equal(G.validatePolygon(p),true);
  assert.equal(G.rectangleInsidePolygon({x:0,y:0,w:2700,h:3590},p),true);
  assert.deepEqual(G.wallClearances({x:100,y:100,w:200,h:200},{poly:p}),{left:100,right:2400,top:100,bottom:3290});
});

test('baby-room furniture outside the real door sweep is clear', () => {
  const a={x:640,y:600,w:300,h:300};
  // The previous square [65,865] x [0,800] intersects this rectangle.
  assert(a.x<865&&a.x+a.w>65&&a.y<800&&a.y+a.h>0);
  assert(Math.hypot(a.x-65,a.y)>800);
  assert.equal(G.doorHit(a,baby),false);
  assert.equal(G.doorHit({x:300,y:300,w:100,h:100},baby),true);
});

test('door descriptors use actual leaf width, frame offset, and every wall/hinge', () => {
  const cases=[
    ['top','left',165,0,1,1],['top','right',965,0,-1,1],
    ['bottom','left',165,3000,1,-1],['bottom','right',965,3000,-1,-1],
    ['left','top',0,165,1,1],['left','bottom',0,965,1,-1],
    ['right','top',2000,165,-1,1],['right','bottom',2000,965,-1,-1],
  ];
  for(const [side,hinge,cx,cy,sx,sy] of cases){
    const s=G.doorSector({w:2000,h:3000,dp:100,dw:930,doorLeafW:800,doorHingeOffset:65,doorSide:side,doorHinge:hinge});
    assert.deepEqual([s.cx,s.cy,s.r,s.sx,s.sy],[cx,cy,800,sx,sy]);
    almost(Math.hypot(s.closed.x-cx,s.closed.y-cy),800);
    almost(Math.hypot(s.open.x-cx,s.open.y-cy),800);
    almost((s.closed.x-cx)*(s.open.x-cx)+(s.closed.y-cy)*(s.open.y-cy),0);
    assert.equal(G.rectangleIntersectsSector({x:cx+(sx===1?100:-200),y:cy+(sy===1?100:-200),w:100,h:100},s),true);
    assert.equal(G.rectangleIntersectsSector({x:cx+(sx===1?-200:100),y:cy+(sy===1?-200:100),w:100,h:100},s),false);
  }
});

test('sector contact alone is clear, actual overlap collides, malformed sectors are safe', () => {
  const s={cx:0,cy:0,r:5,sx:1,sy:1};
  assert.equal(G.rectangleIntersectsSector({x:3,y:4,w:1,h:1},s),false);
  assert.equal(G.rectangleIntersectsSector({x:2.9,y:4,w:1,h:1},s),true);
  assert.equal(G.rectangleIntersectsSector({x:-10,y:0,w:10,h:10},s),false);
  assert.equal(G.rectangleIntersectsSector({x:0,y:0,w:1,h:1},null),false);
  assert.equal(G.doorSector({...baby,dw:0}),null);
  assert.equal(G.doorSector({...baby,doorLeafW:NaN}),null);
});

test('rectangle wall clearances retain exact mm values', () => {
  assert.deepEqual(G.wallClearances({x:100,y:200,w:300,h:400},{poly:box}),{left:100,right:600,top:200,bottom:400});
  assert.deepEqual(G.wallClearances({x:0,y:0,w:1000,h:1000},{poly:box}),{left:0,right:0,top:0,bottom:0});
  assert.equal(G.wallClearances({x:900,y:100,w:200,h:100},{poly:box}),null);
});

test('clearance spans the whole item edge and detects a notch missed by a midpoint ray', () => {
  const p=[[0,0],[2700,0],[2700,3505],[2150,3505],[2150,3590],[0,3590]];
  assert.equal(G.wallClearances({x:2000,y:3200,w:200,h:300},{poly:p}).bottom,5);
  assert.equal(G.wallClearances({x:2000,y:3200,w:100,h:300},{poly:p}).bottom,90);
});

test('touching a notch edge does not block movement along that edge', () => {
  const a={x:100,y:100,w:800,h:500};
  assert.deepEqual(G.wallClearances(a,{poly:notch}),{left:100,right:100,top:100,bottom:0});
});

test('slanted wall clearances use the nearest wall point across the side', () => {
  const p=[[630,0],[1680,0],[1680,2300],[0,2300],[0,860]];
  const c=G.wallClearances({x:400,y:700,w:100,h:100},{poly:p});
  almost(c.left,400-630*(1-700/860));
  almost(c.top,700-860*(1-400/630));
  assert.equal(c.right,1180);
  assert.equal(c.bottom,1500);
});

test('browser global works without Node or a DOM', () => {
  const browser=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../geometry-core.js'),'utf8'),browser);
  assert.equal(typeof browser.TTOBOK_GEOMETRY.rectangleInsidePolygon,'function');
});
