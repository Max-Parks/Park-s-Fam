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
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 try{
  for(const viewport of [{width:1440,height:1000},{width:1024,height:768},{width:390,height:844},{width:360,height:740}]){
   const context=await browser.newContext({viewport,hasTouch:viewport.width<600,isMobile:viewport.width<600,serviceWorkers:'block'});
   const page=await context.newPage(),errors=[],mobile=viewport.width<600;page.setDefaultTimeout(15000);
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.route('https://**/*',route=>route.abort()); // No production Firebase or user data.
   await page.goto(base);await page.waitForFunction(()=>!!window.TTOBOK_APP);
   await page.locator('#nn').fill('테스트 책상');await page.locator('#nw').fill('600');await page.locator('#nd').fill('400');
   await page.locator('#addCustom').click();assert.equal(await page.locator('.furn').count(),1);
   const before=await page.locator('.furn').evaluate(e=>({x:+e.dataset.x,y:+e.dataset.y}));
   const reachable=async selector=>{
    const info=await page.locator(selector).evaluate(e=>{
     const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
     return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,hit:!!hit&&(hit===e||e.contains(hit))};
    });
    assert.ok(info.left>=0&&info.right<=info.width&&info.top>=0&&info.bottom<=info.height&&info.hit,`${viewport.width}px ${selector} must be visible and tappable without scrolling: ${JSON.stringify(info)}`);
   };
   const tapRotate=async()=>{
    await reachable('#rot');const b=await page.locator('#rot').boundingBox();
    await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
   };
   if(mobile){
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'90');
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'0');
    await page.screenshot({path:path.join(root,'test-results',`mobile-normal-${viewport.width}.png`)});
    await page.locator('#mobileView').click();await page.locator('#mvRight').click();
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
    await page.locator('#z400').click();await reachable('#rot');
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'0');
    await tapRotate();assert.equal(await page.locator('.furn').getAttribute('data-r'),'90');
    await page.locator('#fit').click();
   }
   await page.screenshot({path:path.join(root,'test-results',`planner-${viewport.width}.png`),fullPage:false});
   if(mobile)await page.locator('#mobileView').click();
   await page.locator('#roomSel').selectOption('house');
   await page.waitForFunction(()=>document.querySelectorAll('.houseMarker').length===14);
   assert.equal(await page.locator('#houseLegend').isVisible(),true);
   assert.equal(await page.locator('#houseLegend').evaluate(e=>!document.querySelector('#room').contains(e)),true);
   assert.match(await page.locator('#houseLegend').innerText(),/테스트 책상/);
   for(const selector of ['#suiteLayer','#fixedLayer','#edgeLayer'])assert.doesNotMatch(await page.locator(selector).innerText(),/[가-힣]/,'whole-house descriptions must be outside the plan');
   await page.locator('#fontSizeSel').selectOption('xlarge');
   await page.locator('#fit').click();
   await page.locator('.plannerMain').screenshot({path:path.join(root,'test-results',`whole-house-${viewport.width}.png`)});
   assert.equal(await page.locator('#rot').isEnabled(),false);
   if(mobile){
    await page.locator('#mobileView').click();
    assert.equal(await page.locator('#houseLegend').isVisible(),true);
    await page.locator('#mobileView').click();
   }
   await page.locator('#roomSel').selectOption('living');await page.locator('#roomSel').selectOption('smallroom2');assert.equal(await page.locator('.furn').count(),1);
   if(mobile)await page.locator('#mobileView').click();
   await page.locator('.furn').click();await page.locator('#del').click();assert.equal(await page.locator('.furn').count(),0);
   if(mobile)await page.locator('#mobileView').click();
   for(const id of ['smallroom1','master','living','laundry','commonbath','ensuite','entry','house','smallroom2'])await page.locator('#roomSel').selectOption(id);
   await page.reload();await page.waitForFunction(()=>!!window.TTOBOK_APP);assert.equal(await page.locator('.furn').count(),0);
   if(!mobile){
    // Chromium can stall a full-page screenshot of a standalone SVG document.
    // Decode the unchanged SVG in an HTML image before capturing its full size.
    await page.setContent(`<html><body style="margin:0"><img src="${base}/docs/babyroom-v363-reference.svg" width="1120" height="1450" alt="아기방 기본 치수 검토도"></body></html>`);
    await page.locator('img').evaluate(image=>image.decode());
    await page.screenshot({path:path.join(root,'test-results','babyroom-reference.png'),fullPage:true});
   }
   assert.deepEqual(errors,[],`${viewport.width}px JavaScript errors`);await context.close();console.log(`Browser passed: ${viewport.width}x${viewport.height}`);
  }
 }finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
