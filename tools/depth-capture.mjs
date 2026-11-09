// Capture the installed route at identical states; reuse an existing CDP page only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const out = process.argv[2]
assert.ok(out, 'Usage: node tools/depth-capture.mjs <output-directory>')
const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('/plugins/dsh-boot-grid-zmd/'))
assert.ok(page, 'Open the installed boot route in the existing CDP browser first')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data), p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
})
await new Promise((r, j) => { ws.addEventListener('open', r, {once:true}); ws.addEventListener('error', j, {once:true}) })
const call = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, {resolve, reject}); ws.send(JSON.stringify({id, method, params}))
})
const pause = ms => new Promise(r => setTimeout(r, ms))
const evalv = async expression => {
  const r = await call('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true})
  assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description)
  return r.result.value
}
fs.mkdirSync(out, {recursive:true})
try {
  await call('Page.enable')
  await call('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false})
  for (const phase of ['access','order','close','boot']) {
    await call('Page.navigate', {url:`http://127.0.0.1:50130/plugins/dsh-boot-grid-zmd/?jump=${phase}`})
    await pause(1600)
    await evalv(`(async()=>{
      const b=window.__BOOT__, s=b.S;
      document.getElementById('clock').textContent='12:00:00';
      for(const a of document.getAnimations()) { a.pause(); a.currentTime=2000; }
      if(s.phase==='close') b.paintBreaker(.55,false);
      if(s.phase==='boot') {
        s.booting=false; s.reveal=.78; s.energize=.78; s.progress=93;
        document.getElementById('pct').textContent='93'; document.getElementById('bootPct').textContent='93';
        document.getElementById('bootFill').style.width='93%'; document.getElementById('fill').style.height='93%';
      }
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return {phase:s.phase,progress:s.progress,reveal:s.reveal,brk:s.brk};
    })()`)
    const shot=await call('Page.captureScreenshot',{format:'png',fromSurface:true})
    fs.writeFileSync(`${out}/${phase}.png`,Buffer.from(shot.data,'base64'))
    console.log('Captured',phase)
  }
} finally { ws.close() }
