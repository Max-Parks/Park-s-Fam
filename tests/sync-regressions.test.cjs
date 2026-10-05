const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
async function setup(){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 let source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 source=source.replace(/import\('https:\/\/www\.gstatic\.com\/firebasejs\/[^']+\/firebase-(\w+)\.js'\)/g,"sdk('$1')");
 const elements=new Map(),rooms={},remote=new Map(),listeners=new Map(),timers=new Map(),writes=[];
 let active='smallroom2',authCb,seq=0,now=1000;
 const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',className:''});return elements.get(id)};
 const room=id=>rooms[id]??={geometry:{w:2700,h:3590},items:[],savedAt:0,dirty:false,localRevision:0,baseVersion:null};
 const A={getRoom:()=>active,getRoomIds:()=>['smallroom2','smallroom1'],getRoomName:x=>x,
  geom:()=>room(active).geometry,items:()=>room(active).items,storageItem:clone,normalizeItem:clone,cloudGeometry:(_,x)=>clone(x),
  getLocalRoomData:id=>clone(room(id)),getLocalSavedAt:id=>room(id).savedAt,
  applyCloudRoomData:(id,z)=>{rooms[id]={...room(id),geometry:z.geometry??room(id).geometry,items:clone(z.items??[]),savedAt:z.clientSavedAt??0,dirty:false,baseVersion:version(z)}},
  markCloudSaved:(id,rev,base)=>{const r=room(id);r.baseVersion=base;if(r.localRevision===rev)r.dirty=false},
  backupLocalRoom:()=>{},markRoomDirty:id=>{const r=room(id);r.dirty=true;r.localRevision++;r.savedAt=++now},
 };
 function version(z){return z?String(z.revision??z.clientSavedAt??0):null}
 const snap=id=>({exists:()=>remote.has(id),data:()=>clone(remote.get(id)),metadata:{fromCache:false,hasPendingWrites:false}});
 const f={getFirestore:()=>({}),doc:(_,...p)=>p.at(-1),serverTimestamp:()=>({seconds:now}),
  setDoc:async(id,data)=>{remote.set(id,clone(data));writes.push({id,data:clone(data)})},
  getDoc:async id=>snap(id),getDocFromServer:async id=>snap(id),
  onSnapshot:(id,...args)=>{const callback=args.find(x=>typeof x==='function');listeners.set(id,callback);return ()=>listeners.delete(id)},
  runTransaction:async(_,fn)=>fn({get:async id=>snap(id),set:(id,z)=>{remote.set(id,clone(z));writes.push({id,data:clone(z)})}})};
 const auth={getAuth:()=>({}),onAuthStateChanged:(_,cb)=>{authCb=cb},signOut:async()=>authCb(null),GoogleAuthProvider:class{setCustomParameters(){}},signInWithPopup:async()=>{}};
 const context={console,Promise,Map,Set,Date,TTOBOK_CLIENT_ID:'client-test',TTOBOK_APP:A,TTOBOK_FIREBASE_CONFIG:{},
  document:{getElementById:el},localStorage:{setItem(){},getItem:()=>null},alert:()=>{},confirm:()=>true,
  setTimeout:fn=>{timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id),addEventListener(){},
  sdk:async n=>n==='app'?{initializeApp:()=>({})}:n==='auth'?auth:f};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);
 const settle=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate)};
 await settle();
 return {context,A,rooms,room,remote,listeners,writes,el,settle,setActive:id=>active=id,
  login:async()=>{await authCb({uid:'u',email:'komorebi0802@gmail.com'});await settle()},
  emit:async id=>{listeners.get(id)?.(snap(id));await settle()},
  timers:async()=>{const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());await settle()}};
}
test('a queued edit saves its original room after room switch',async()=>{
 const h=await setup();await h.login();Object.assign(h.room('smallroom2'),{items:[{n:'bed',w:100,d:100}],dirty:true,localRevision:1,savedAt:10});
 h.context.scheduleCloudSave();h.setActive('smallroom1');h.context.restartCloudRoom();await h.timers();
 assert.ok(h.writes.some(w=>w.id==='smallroom2'&&w.data.items[0]?.n==='bed'));
 assert.equal(h.writes.some(w=>w.id==='smallroom1'),false);
});
test('an authoritative empty cloud room stays empty and is not resurrected',async()=>{
 const h=await setup();Object.assign(h.room('smallroom2'),{items:[{n:'old bed'}],savedAt:10});
 h.remote.set('smallroom2',{items:[],clientSavedAt:20,revision:2});await h.login();await h.emit('smallroom2');
 assert.deepEqual(h.room('smallroom2').items,[]);assert.equal(h.writes.length,0);
});
test('an unedited device with a fast clock cannot overwrite newer cloud data',async()=>{
 const h=await setup();Object.assign(h.room('smallroom2'),{items:[{n:'stale'}],savedAt:999999999});
 h.remote.set('smallroom2',{items:[{n:'current'}],clientSavedAt:20,revision:2});await h.login();await h.emit('smallroom2');
 assert.equal(h.room('smallroom2').items[0].n,'current');assert.equal(h.writes.length,0);
});
test('logout detaches the active room listener',async()=>{
 const h=await setup();await h.login();assert.equal(h.listeners.size,1);await h.el('login').onclick();
 assert.equal(h.listeners.size,0);
});
test('conflicting device edit stays local instead of overwriting cloud',async()=>{
 const h=await setup();await h.login();Object.assign(h.room('smallroom2'),{items:[{n:'local'}],dirty:true,localRevision:1,baseVersion:'1',savedAt:100});
 h.remote.set('smallroom2',{items:[{n:'remote'}],revision:2,clientSavedAt:50});
 await h.context.flushCloudSave().catch(()=>{});
 assert.equal(h.remote.get('smallroom2').items[0].n,'remote');assert.equal(h.room('smallroom2').dirty,true);
});
