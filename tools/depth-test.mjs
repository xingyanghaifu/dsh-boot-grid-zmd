// Regression on the already installed route, using an existing CDP browser only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const origin = process.env.DSH_WEB_URL || 'http://127.0.0.1:58602'
const url = origin + '/plugins/dsh-boot-grid-zmd/'
const out = new URL('../docs/depth/regression/', import.meta.url)
fs.mkdirSync(out, {recursive:true})
const pages = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = pages.find(p => p.type === 'page' && p.url.startsWith(url)) || pages.find(p => p.type === 'page')
assert.ok(page, 'Existing CDP page required')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id=0
const pending=new Map(), errors=[], failedRequests=[], results=[]
ws.addEventListener('message', e=>{
  const m=JSON.parse(e.data)
  if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  if(m.method==='Network.responseReceived' && m.params.response.status>=400) failedRequests.push({url:m.params.response.url,status:m.params.response.status})
  const p=pending.get(m.id); if(!p)return
  pending.delete(m.id); m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)
})
await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const ev=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
  assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description)
  return r.result.value
}
const record=(name,data)=>{results.push({name,data});console.log('PASS',name,JSON.stringify(data))}
const nav=async(q='')=>{await call('Page.navigate',{url:url+q});await wait(850);assert.ok(await ev('!!window.__BOOT__'))}
const until=async(expression,ms=4000)=>{
  const start=Date.now();while(Date.now()-start<ms){if(await ev(expression))return;await wait(80)}
  throw new Error('Timed out: '+expression)
}
const rect=sel=>ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`)
const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:1})
const click=async sel=>{const r=await rect(sel);await mouse('mousePressed',r.x,r.y,1);await mouse('mouseReleased',r.x,r.y)}
const key=async(key,code,vk,text)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,text:text??''});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk})}
const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(new URL(name+'.png',out),Buffer.from(s.data,'base64'))}
const drag=async p=>{
  const k=await rect('#brkKnob'),t=await rect('#brkTrack');await mouse('mousePressed',k.x,k.y,1)
  for(let i=1;i<=8;i++){await mouse('mouseMoved',k.x+(t.x-t.w/2+t.w*p-k.x)*i/8,k.y,1);await wait(20)}
  await mouse('mouseReleased',t.x-t.w/2+t.w*p,k.y)
}
try {
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable')
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  // Pointer path: interrupted hold, full hold, readback, spring return, full breaker close.
  await nav();let r=await rect('#holdBtn')
  await mouse('mousePressed',r.x,r.y,1);await wait(240);await mouse('mouseReleased',r.x,r.y)
  assert.equal(await ev('__BOOT__.S.phase'),'access');assert.equal(await ev('__BOOT__.S.hold'),0)
  await shot('hold-interrupted');record('short hold restores access',true)
  await mouse('mousePressed',r.x,r.y,1);await wait(1300);await mouse('mouseReleased',r.x,r.y)
  await until('__BOOT__.S.phase==="order" && __BOOT__.S.orderTyped')
  assert.equal(await ev('document.getElementById("execBtn").disabled'),true)
  await click('#repeatBtn');await until('__BOOT__.S.repeated');await click('#execBtn')
  await until('__BOOT__.S.phase==="close"');await drag(.48);await wait(380)
  assert.equal(await ev('__BOOT__.S.brk'),0);await shot('breaker-return');record('readback gating and breaker return',true)
  await drag(1);await until('__BOOT__.S.phase==="boot"')
  await shot('boot-live');await until('__BOOT__.S.done',10000);record('pointer flow completes four stages',true)
  // Reduced-motion keyboard path and stable idle canvas.
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await nav()
  const stable=await ev(`(async()=>{const cv=document.getElementById('map'),a=cv.toDataURL();await new Promise(r=>setTimeout(r,220));return a===cv.toDataURL()})()`)
  assert.equal(stable,true);assert.equal(await ev('getComputedStyle(document.querySelector(".scan")).display'),'none')
  await ev('document.getElementById("holdBtn").focus()')
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,text:' '});await wait(1300)
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32})
  await until('__BOOT__.S.orderTyped');await key('Enter','Enter',13,'\r');await until('__BOOT__.S.repeated');await key('Enter','Enter',13,'\r')
  await until('__BOOT__.S.phase==="close"');await ev('document.getElementById("brkKnob").focus()')
  await key('End','End',35);await key('Enter','Enter',13,'\r');await until('__BOOT__.S.done',10000)
  assert.equal(await ev('getComputedStyle(document.getElementById("sweep")).transform'),'matrix(0, 0, 0, 1, 0, 0)')
  record('reduced motion keyboard flow and stable map',true)
  await call('Emulation.setEmulatedMedia',{features:[]})
  // Explicit mode toggle + real input takeover.
  await nav('?auto=1');await wait(400)
  assert.equal(await ev('__BOOT__.S.auto'),true)
  await click('#modeBtn');await wait(250)
  assert.equal(await ev('__BOOT__.S.auto'),false)
  assert.match(await ev('document.cookie'),/dsh_boot_grid_zmd_mode=manual/)
  await click('#modeBtn');await wait(300)
  assert.equal(await ev('__BOOT__.S.auto'),true)
  assert.match(await ev('document.cookie'),/dsh_boot_grid_zmd_mode=auto/)
  record('mode toggle persists both directions',true)
  await nav('?auto=1');await wait(550);await mouse('mousePressed',900,300,1);await mouse('mouseReleased',900,300);await wait(1600)
  assert.equal(await ev('__BOOT__.S.auto'),false);assert.equal(await ev('__BOOT__.S.phase'),'access');record('automatic demo manual takeover',true)
  // Five existing sizes x four states: test actionable targets, hint and text overflow.
  for(const [w,h] of [[1920,1080],[1440,900],[1366,768],[1280,720],[1024,768]]){
    await call('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false})
    for(const phase of ['access','order','close','boot']){
      await nav('?jump='+phase)
      const layout=await ev(`(()=>{
        const dock=document.getElementById('dock').getBoundingClientRect(),panel=document.querySelector('.p-${phase}');
        const bad=[];
        for(const e of panel.querySelectorAll('button')) { const r=e.getBoundingClientRect();if(r.left<dock.left||r.right>dock.right||r.top<dock.top||r.bottom>dock.bottom)bad.push(e.id); }
        for(const id of ['orderText','orderEcho','dockHint']) { const e=document.getElementById(id);if(e.clientWidth && e.scrollWidth>e.clientWidth+1)bad.push(id+':clipped'); }
        return {bad,screen:[innerWidth,innerHeight],dock:[dock.right,dock.bottom]};
      })()`)
      assert.deepEqual(layout.bad,[],`${w}x${h} ${phase} ${layout.bad}`)
      if(phase==='access'||phase==='close')await shot(`${w}x${h}-${phase}`)
    }
    record(`${w}x${h} all phase bounds and text`,true)
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await nav()
  const n=await ev(`(()=>{const n=__BOOT__.nodes.find(n=>n.name==='昌吉'),r=document.getElementById('map').getBoundingClientRect();return {x:r.left+n.x,y:r.top+n.y-n.lift}})()`)
  await mouse('mouseMoved',n.x,n.y);await wait(150)
  assert.equal(await ev('__BOOT__.nodes[__BOOT__.S.hoverNode]?.name'),'昌吉');await shot('node-hover');record('raised node hit test',true)
  // Existing installed page acts as host; inject unchanged real screen.js.
  const screen=fs.readFileSync(new URL('../assets/screen.js',import.meta.url),'utf8')
  await nav();await ev(`document.cookie='dsh_boot_grid_zmd_mode=manual; path=/; max-age=3600'`);await ev(screen)
  await until('!!document.querySelector("[data-dsh-boot-grid-zmd] iframe")')
  assert.match(await ev('document.querySelector("[data-dsh-boot-grid-zmd] iframe").getAttribute("src")'),/auto=0/)
  record('overlay defaults to saved manual mode',true)
  await key('Escape','Escape',27);await until('!document.querySelector("[data-dsh-boot-grid-zmd]")');record('overlay Escape removes iframe',true)
  await nav();await ev(`document.cookie='dsh_boot_grid_zmd_mode=auto; path=/; max-age=3600'`);await ev(screen)
  await until('!document.querySelector("[data-dsh-boot-grid-zmd]")',25000);record('auto four phases and iframe handoff',true)
  // Per-frame idle sample, no screenshot capture during the interval.
  await nav('?jump=boot')
  const perf=await ev(`(async()=>{const a=[];let prev=performance.now();await new Promise(resolve=>{function f(t){a.push(t-prev);prev=t;if(a.length<90)requestAnimationFrame(f);else resolve()}requestAnimationFrame(f)});a.shift();a.sort((x,y)=>x-y);return {samples:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],over50ms:a.filter(x=>x>50).length}})()`)
  record('local frame interval sample',perf)
  assert.deepEqual(errors,[],'runtime exceptions')
  const nonFavicon=failedRequests.filter(r=>!r.url.endsWith('/favicon.ico'))
  assert.deepEqual(nonFavicon,[],'unexpected asset failures')
  record('runtime and asset errors',{exceptions:errors,failedRequests})
} finally {
  fs.writeFileSync(new URL('results.json',out),JSON.stringify({results,errors,failedRequests},null,2))
  await call('Emulation.setEmulatedMedia',{features:[]})
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  await call('Page.navigate',{url})
  ws.close()
}
