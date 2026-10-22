const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 try{
  // CSS viewport approximations for Galaxy Z Flip5, Tab S8 (SM-X700), and
  // Tab S9 FE 5G (SM-X516N), including display scaling / split windows.
  // Physical display pixels do not establish CSS viewport size. These Chromium
  // responsive/touch checks do not replace verification on the actual devices.
  const viewports=[
   {width:1440,height:1000},{width:1024,height:768},{width:390,height:844},{width:360,height:740},{width:320,height:568},{width:740,height:360},{width:844,height:390},
   {width:360,height:880,touch:true},{width:880,height:360,touch:true},{width:412,height:1006,touch:true},{width:1006,height:412,touch:true},
   {width:800,height:1280,touch:true},{width:1280,height:800,touch:true},{width:768,height:1229,touch:true},{width:1229,height:768,touch:true},
   {width:640,height:1024,touch:true},{width:1024,height:640,touch:true}
  ];
  for(const scenario of viewports){
   const viewport={width:scenario.width,height:scenario.height},size=`${viewport.width}x${viewport.height}`;
   const mobile=viewport.width<=760||(viewport.width<=1100&&viewport.height<=500),hasTouch=scenario.touch??mobile;
   const context=await browser.newContext({viewport,hasTouch,isMobile:mobile,deviceScaleFactor:1,serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);
   page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',d=>d.accept());
   await page.route('https://**/*',route=>route.abort()); // No production Firebase or user data.
   await page.goto(base);await page.waitForFunction(()=>!!window.TTOBOK_APP);
   // Keep the real browser API, but observe when its asynchronous entry settles.
   // The separate deferred-entry regression covers Escape before that point.
   await page.evaluate(()=>{
    const request=document.documentElement.requestFullscreen;
    window.testFullscreenPending=false;
    if(request)document.documentElement.requestFullscreen=function(...args){
     window.testFullscreenPending=true;
     try{return request.apply(this,args).finally(()=>{window.testFullscreenPending=false})}
     catch(error){window.testFullscreenPending=false;throw error}
    };
   });
   assert.equal(await page.locator('body > header').count(),0,`${size} must remove the persistent top header`);
   const panel=async open=>{
    const toggle=page.locator('#mobilePanel');
    if(await toggle.isVisible()&&(await toggle.getAttribute('aria-expanded')==='true')!==open)await toggle.click();
   };
   const chooseRoom=async id=>{await panel(true);await page.locator('#roomSel').selectOption(id);await panel(false)};
   const viewOptions=async open=>{
    const options=page.locator('#viewOptions');
    if(await options.evaluate(e=>e.open)!==open)await options.locator('summary').click();
   };
   const focus=async on=>{
    if(await page.locator('body').evaluate(e=>e.classList.contains('mobile-focus'))!==on)await page.locator('#mobileView').click();
    await page.waitForFunction(on=>!window.testFullscreenPending&&document.body.classList.contains('mobile-focus')===on&&(on||!document.fullscreenElement),on);
   };
   const layoutSnapshot=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>/^ttobok_v3_.+_cur$/.test(key)).sort().map(key=>[key,localStorage.getItem(key)])));
   const noEditRows=async()=>{
    assert.equal(await page.locator('.editControls').isVisible(),false,`${size} must hide editing tools without an editable selection`);
    assert.equal(await page.locator('#mobileMoveControls').isVisible(),false,`${size} must hide movement tools without an editable selection`);
    assert.ok((await page.locator('.toolbar').boundingBox()).height<=76,`${size} viewing tools must fit in a single compact row`);
   };
   const reachable=async selector=>{
    const info=await page.locator(selector).evaluate(e=>{
     const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
     return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,hit:!!hit&&(hit===e||e.contains(hit))};
    });
    assert.ok(info.left>=-1&&info.right<=info.width+1&&info.top>=-1&&info.bottom<=info.height+1&&info.hit,`${size} ${selector} must be visible and tappable without scrolling: ${JSON.stringify(info)}`);
   };
   const usablePlan=async()=>{
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const layout=await page.evaluate(()=>{
     const stage=document.querySelector('.stage'),r=stage.getBoundingClientRect();
     const left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),x=(left+right)/2;
     let run=0,visibleHeight=0;
     for(let y=Math.ceil(top);y<bottom;y+=2){const hit=document.elementFromPoint(x,y);run=hit&&stage.contains(hit)?run+2:0;visibleHeight=Math.max(visibleHeight,run)}
     return {visibleHeight,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth};
    });
    assert.ok(layout.documentWidth<=layout.viewportWidth+1,`${size} must not scroll the document horizontally: ${JSON.stringify(layout)}`);
    assert.ok(layout.visibleHeight>=100,`${size} must leave at least 100px of usable plan height: ${JSON.stringify(layout)}`);
   };
   if(await page.locator('#mobilePanel').isVisible()){
    assert.equal(await page.locator('#mobilePanel').getAttribute('aria-expanded'),'false','mobile controls should initially leave room for the plan');
    await reachable('#mobilePanel');
   }
   await usablePlan();
   await noEditRows();
   for(const selector of ['#zoomOut','#zoomIn','#fit','#mobileView','#viewOptions > summary'])await reachable(selector);
   assert.match(await page.locator('#zoomOut').getAttribute('aria-label'),/축소/);
   assert.match(await page.locator('#zoomIn').getAttribute('aria-label'),/확대/);
   assert.equal(await page.locator('#viewOptions > summary').getAttribute('aria-label'),'보기 설정');
   assert.equal(await page.locator('#viewOptions').evaluate(e=>e.open),false,'extra view settings must initially be collapsed');
   await panel(true);
   assert.equal(await page.locator('aside #appSettings #summary').count(),1,'app summary must be in the account panel');
   await page.locator('#appSettings > summary').click();
   for(const selector of ['#login','#syncPull','#installApp']){
    assert.equal(await page.locator(`#appSettings ${selector}`).count(),1,`${selector} must remain in account settings`);
    await page.locator(selector).scrollIntoViewIfNeeded();await reachable(selector);
   }
   await page.locator('#appSettings > summary').click();await panel(false);
   const names=await page.locator('#rw,#rh,#nn,#nw,#nd,#roomSel,#targetRoom').evaluateAll(elements=>elements.map(e=>{
    const labelled=(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ');
    return {id:e.id,name:(labelled||e.getAttribute('aria-label')||Array.from(e.labels||[],label=>label.textContent).join(' ')||e.getAttribute('title')||e.getAttribute('placeholder')||'').trim()};
   }));
   assert.equal(names.length,7);for(const control of names)assert.ok(control.name,`${size} #${control.id} needs an accessible name`);
   if(mobile){
    for(const catalog of ['#furnitureCatalog','#applianceCatalog']){
     await panel(true);await page.locator(`${catalog} button`).first().click();
     assert.equal(await page.locator('.furn.sel').count(),1,`${size} catalog addition must select the new item`);
     if(await page.locator('#mobilePanel').isVisible())assert.equal(await page.locator('#mobilePanel').getAttribute('aria-expanded'),'false',`${size} ${catalog} addition must close the panel`);
     assert.equal(await page.evaluate(()=>document.activeElement?.matches('.furn.sel')),true,`${size} catalog addition must focus the selected item`);
     await usablePlan();await reachable('#rot');await reachable('#del');
     await page.locator('#del').click();assert.equal(await page.locator('.furn').count(),0);await noEditRows();
    }
   }
   await panel(true);
   await page.locator('#nn').fill('테스트 책상');await page.locator('#nw').fill('600');await page.locator('#nd').fill('400');
   await page.locator('#addCustom').scrollIntoViewIfNeeded();
   const portraitPanel=await page.locator('#mobilePanel').isVisible(),catalogScroll=await page.locator('aside').evaluate(e=>e.scrollTop);
   await page.locator('#addCustom').click();assert.equal(await page.locator('.furn').count(),1);
   if(portraitPanel)assert.equal(await page.locator('#mobilePanel').getAttribute('aria-expanded'),'false','adding furniture must return to the plan');
   else assert.ok(Math.abs(await page.locator('aside').evaluate(e=>e.scrollTop)-catalogScroll)<=1,`${size} adding furniture must preserve the sidebar scroll position`);
   await reachable('#rot');await usablePlan();
   const before=await page.locator('.furn').evaluate(e=>({x:+e.dataset.x,y:+e.dataset.y}));
   const tapRotate=async()=>{
    await reachable('#rot');const b=await page.locator('#rot').boundingBox();
    await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
   };
   if(hasTouch&&!mobile){
    // A tablet can use the wide layout while still requiring touch selection.
    await chooseRoom('living');await chooseRoom('smallroom2');
    await page.locator('.furn').scrollIntoViewIfNeeded();await reachable('.furn');
    const box=await page.locator('.furn').boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
    assert.equal(await page.locator('.furn.sel').count(),1,`${size} touch must select furniture`);
    if(await page.locator('#mobileMoveControls').isVisible()){
     const x=Number(await page.locator('.furn').getAttribute('data-x')),step=Number(await page.locator('#moveStep').inputValue());
     await reachable('#mvRight');const button=await page.locator('#mvRight').boundingBox();await page.touchscreen.tap(button.x+button.width/2,button.y+button.height/2);
     assert.equal(Number(await page.locator('.furn').getAttribute('data-x')),x+step,`${size} tablet touch nudge must use the selected step`);
    }
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'90');
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'0');
   }
   if(mobile){
    await usablePlan();for(const selector of ['#rot','#dup','#del','#mobileView'])await reachable(selector);
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'90');
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'0');
    await page.screenshot({path:path.join(root,'test-results',`mobile-normal-${size}.png`)});
    await focus(true);await reachable('#rot');await usablePlan();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.body.classList.contains('mobile-focus')&&!document.fullscreenElement);
    await reachable('#mobileView');await usablePlan();
    // When browser fullscreen is unavailable, resizing out of the compact layout
    // must still restore the normal desktop panel and scrolling.
    await page.evaluate(()=>{window.testRequestFullscreen=document.documentElement.requestFullscreen;document.documentElement.requestFullscreen=undefined});
    await focus(true);await page.setViewportSize({width:1440,height:1000});
    await page.waitForFunction(()=>!document.body.classList.contains('mobile-focus'));
    assert.equal(await page.locator('body > header').count(),0);assert.equal(await page.locator('aside').isVisible(),true);
    assert.match(await page.locator('.stage').evaluate(e=>getComputedStyle(e).overflowY),/auto|scroll/,'desktop plan must remain scrollable after leaving focus mode');
    await page.locator('#roomSel').selectOption('living');await page.locator('#roomSel').selectOption('smallroom2');
    await page.setViewportSize(viewport);await page.locator('.furn').click();await usablePlan();
    await page.evaluate(()=>{document.documentElement.requestFullscreen=window.testRequestFullscreen;delete window.testRequestFullscreen});
    await focus(true);await page.locator('#mvRight').click();
   }
   else{
    await page.locator('.furn').scrollIntoViewIfNeeded();const box=await page.locator('.furn').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+20,{steps:5});await page.mouse.up();
   }
   assert.ok(await page.locator('.furn').evaluate((e,b)=>+e.dataset.x>b.x,before));
   if(mobile)await tapRotate();else await page.locator('#rot').click();assert.equal(await page.locator('.furn').getAttribute('data-r'),'90');
   const state=await page.evaluate(()=>localStorage.getItem('ttobok_v3_smallroom2_cur'));
   await page.locator('#zoomIn').click();await page.evaluate(()=>new Promise(requestAnimationFrame));
   assert.equal(await page.evaluate(()=>localStorage.getItem('ttobok_v3_smallroom2_cur')),state,'zoom must not change persisted layout');
   if(mobile){
    await viewOptions(true);await page.locator('#z400').click();await viewOptions(false);await reachable('#rot');await usablePlan();
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'0');
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'90');
    await page.locator('#fit').click();
   }
   await page.screenshot({path:path.join(root,'test-results',`planner-${size}.png`),fullPage:false});
   if(mobile)await focus(false);
   const beforeHouse=await layoutSnapshot();
   await chooseRoom('house');
   await page.waitForFunction(()=>document.querySelectorAll('.houseMarker').length===14);
   assert.equal(await page.locator('#houseLegend').isVisible(),true);
   assert.equal(await page.locator('#houseLegend').evaluate(e=>!document.querySelector('#room').contains(e)),true);
   assert.match(await page.locator('#houseLegend').innerText(),/테스트 책상/);
   for(const selector of ['#suiteLayer','#fixedLayer','#edgeLayer'])assert.doesNotMatch(await page.locator(selector).innerText(),/[가-힣]/,'whole-house descriptions must be outside the plan');
   await noEditRows();
   await viewOptions(true);
   assert.equal(await page.locator('#clear').isVisible(),false,'whole-house view must not expose the room-clear action');
   await page.locator('#fontSizeSel').selectOption('xlarge');await viewOptions(false);
   await page.locator('#fit').click();
   await usablePlan();
   if(viewport.width<=1280){
    assert.equal(await page.locator('#measures').isVisible(),false,'compact whole-house view must not reserve outer dimension margins');
    assert.equal(await page.locator('#houseSize').isVisible(),true);
    assert.match(await page.locator('#houseSize').innerText(),/14,?220.*10,?930.*mm/);
    const dimensions=await page.evaluate(()=>({plan:document.querySelector('#room').getBoundingClientRect().width,stage:document.querySelector('.stage').clientWidth}));
    assert.ok(dimensions.plan>=dimensions.stage*.85,`${size} fitted whole-house plan must use at least 85% of stage width: ${JSON.stringify(dimensions)}`);
   }
   await page.locator('.plannerMain').screenshot({path:path.join(root,'test-results',`whole-house-${size}.png`)});
   assert.equal(await page.locator('#rot').isEnabled(),false);
   await focus(true);await noEditRows();
   assert.equal(await page.locator('#houseLegend').isVisible(),true);
   await viewOptions(true);await reachable('#fontSizeSel');await viewOptions(false);
   await focus(false);
   assert.deepEqual(await layoutSnapshot(),beforeHouse,'whole-house viewing, fit and font size must not mutate saved room layouts');
   await chooseRoom('living');await chooseRoom('smallroom2');assert.equal(await page.locator('.furn').count(),1);
   if(mobile)await focus(true);
   await page.locator('.furn').click();await page.locator('#del').click();assert.equal(await page.locator('.furn').count(),0);await noEditRows();
   if(mobile)await focus(false);
   for(const id of ['smallroom1','master','living','laundry','commonbath','ensuite','entry','house','smallroom2'])await chooseRoom(id);
   await page.reload();await page.waitForFunction(()=>!!window.TTOBOK_APP);assert.equal(await page.locator('.furn').count(),0);
   await usablePlan();
   assert.deepEqual(errors,[],`${viewport.width}px JavaScript errors`);await context.close();console.log(`Browser passed: ${viewport.width}x${viewport.height}`);
  }
  // Keep reference capture separate from the app: replacing the app document
  // can fire its pending resize callbacks after its elements have been removed.
  // Chromium can also stall a standalone SVG full-page capture, so use an image.
  const reference=await browser.newPage({viewport:{width:1120,height:1450},deviceScaleFactor:1});
  await reference.setContent(`<html><body style="margin:0"><img src="${base}/docs/babyroom-v363-reference.svg" width="1120" height="1450" alt="아기방 기본 치수 검토도"></body></html>`);
  await reference.locator('img').evaluate(image=>image.decode());
  await reference.screenshot({path:path.join(root,'test-results','babyroom-reference.png'),fullPage:true});await reference.close();
 }finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
