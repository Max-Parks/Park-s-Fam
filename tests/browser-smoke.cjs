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
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
   const context=await browser.newContext({viewport,hasTouch:viewport.width<600,isMobile:viewport.width<600,serviceWorkers:'block'});
   const page=await context.newPage(),errors=[],mobile=viewport.width<600;page.setDefaultTimeout(15000);
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.route('https://**/*',route=>route.abort()); // No production Firebase or user data.
   await page.goto(base);await page.waitForFunction(()=>!!window.TTOBOK_APP);
   await page.locator('#nn').fill('테스트 책상');await page.locator('#nw').fill('600');await page.locator('#nd').fill('400');
   await page.locator('#addCustom').click();assert.equal(await page.locator('.furn').count(),1);
   const before=await page.locator('.furn').evaluate(e=>({x:+e.dataset.x,y:+e.dataset.y}));
   if(mobile){await page.locator('#mobileView').click();await page.locator('#mvRight').click()}
   else{
    await page.locator('.furn').scrollIntoViewIfNeeded();const box=await page.locator('.furn').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+20,{steps:5});await page.mouse.up();
   }
   assert.ok(await page.locator('.furn').evaluate((e,b)=>+e.dataset.x>b.x,before));
   await page.locator('#rot').click();assert.equal(await page.locator('.furn').getAttribute('data-r'),'90');
   const state=await page.evaluate(()=>localStorage.getItem('ttobok_v3_smallroom2_cur'));
   await page.locator('#zoomIn').click();await page.evaluate(()=>new Promise(requestAnimationFrame));
   assert.equal(await page.evaluate(()=>localStorage.getItem('ttobok_v3_smallroom2_cur')),state,'zoom must not change persisted layout');
   await page.screenshot({path:path.join(root,'test-results',`planner-${viewport.width}.png`),fullPage:true});
   if(mobile)await page.locator('#mobileView').click();
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
