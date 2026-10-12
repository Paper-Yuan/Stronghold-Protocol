// Run: node test/render/prep-skins.browser.mjs (requires installed assets and Edge on Windows).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const root=path.resolve(import.meta.dirname,'../..'),pub=path.join(root,'public');
const mime={'.js':'application/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png'};
const srv=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(pub,'.'+name);
 if(!file.startsWith(pub+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',pipe:true,protocolTimeout:30000,headless:true,args:['--no-proxy-server','--disable-extensions','--renderer-process-limit=1']});
 const page=await browser.newPage();await page.setViewport({width:900,height:600});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${srv.address().port}/dev/render-demo.html?scene=prep&board=2d&panel=0`,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__demo?.ready||window.__demo?.error,{timeout:30000});
 assert.equal(await page.evaluate(()=>window.__demo.error||null),null);
 const result=await page.evaluate(async()=>{
  const {data}=await import('/js/data.js');
  const catalog=await(await fetch('/data/assets.json')).json();
  const rec=data.list('chess').find(c=>!c.isGolden&&!c.isDiy&&Object.keys(catalog.chars[c.charId]?.skins||{}).length>=2);
  if(!rec)throw Error('no operator with two installed skins');
  const skins=Object.keys(catalog.chars[rec.charId].skins),v=window.__demo.view;window.__demo.pause?.();
  const read=x=>({skin:x.info.skin,skel:x.entry?.skel,ready:x.spineReady,scaleY:x.actor?.spine.scale.y});
  const wait=async fn=>{const end=performance.now()+20000;while(!fn()){if(performance.now()>end)throw Error('model load timed out');await new Promise(r=>setTimeout(r,50));}};
  const state={hand:[{uid:101,kind:'chess',id:rec.chessId,skin:skins[0]}],temp:[{uid:102,kind:'chess',id:rec.chessId,skin:skins[0]}],board:[{uid:103,kind:'chess',id:rec.chessId,skin:skins[0],row:9,col:5,dir:'RIGHT'}],nextEnemies:[]};
  v.setPrep(state,{editable:false});await wait(()=>[101,102,103].every(id=>v.debug.views.get('p:'+id)?.spineReady));
  const prep=[101,102,103].map(id=>read(v.debug.views.get('p:'+id)));
  state.hand[0].skin=skins[1];v.setPrep(state,{editable:false});await wait(()=>v.debug.views.get('p:101')?.spineReady&&v.debug.views.get('p:101').info.skin===skins[1]);
  const switched=read(v.debug.views.get('p:101'));
  state.hand[0].skin=skins[0];v.setPrep(state,{editable:false});await wait(()=>v.debug.views.get('p:101')?.spineReady&&v.debug.views.get('p:101').info.skin===skins[0]);
  const restored=read(v.debug.views.get('p:101'));
  v.enterBattle({fieldId:'skin-test',rect:{r0:0,r1:12,c0:0,c1:12},units:[{id:103,uid:103,kind:'op',side:'ally',defId:rec.chessId,spine:rec.assets?.spine||rec.charId,skin:skins[0],x:5,y:9,maxHp:1000,dir:'RIGHT'}]});
  v.pushSnapshot({fieldId:'skin-test',gt:0,units:[[103,5,9,1000,1000,0,20,0,0]]});
  v.pushSnapshot({fieldId:'skin-test',gt:.2,units:[[103,5,9,1000,1000,0,20,0,0]]});
  await wait(()=>v.debug.views.get(103)?.spineReady);const combat=read(v.debug.views.get(103));
  return {operator:rec.charId,skin:skins[0],prep,switched,restored,combat};
 });
 assert(result.prep.every(x=>x.skin===result.skin&&x.ready&&Number.isFinite(x.scaleY)));
 assert.notEqual(result.switched.skel,result.prep[0].skel);
 assert.equal(result.restored.skel,result.prep[0].skel);
 assert.equal(result.combat.skin,result.skin);assert.equal(result.combat.skel,result.prep[2].skel);
 assert.equal(errors.length,0,JSON.stringify(errors));
 fs.writeFileSync(path.join(root,'验证-皮肤准备与战斗.json'),JSON.stringify({...result,errors},null,2));
 console.log(JSON.stringify(result));
}finally{await browser?.close();srv.closeAllConnections();await new Promise(r=>srv.close(r));}
