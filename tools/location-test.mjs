// Location lookup + real geolocation path on the installed route.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const origin = process.env.DSH_WEB_URL || 'http://127.0.0.1:58602'
const url = origin + '/plugins/dsh-boot-grid-zmd/'
const out = new URL('../docs/depth/location/', import.meta.url)
fs.mkdirSync(out, { recursive: true })
const pages = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = pages.find(p => p.type === 'page' && p.url.startsWith(url)) || pages.find(p => p.type === 'page')
assert.ok(page, 'existing CDP page required')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map(), errors = [], failures = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failures.push({ url: m.params.response.url, status: m.params.response.status })
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
})
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description)
  return r.result.value
}
const nav = async (q = '') => { await call('Page.navigate', { url: url + q }); await wait(850); assert.ok(await ev('!!window.__BOOT__')) }
const click = async (sel) => {
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 })
}
const clearGeo = () => ev(`document.cookie='dsh_boot_grid_zmd_geo=; path=/; max-age=0'`)
const state = async () => JSON.parse(await ev(`JSON.stringify({
  geo:__BOOT__.S.geo, geoState:__BOOT__.S.geoState, phase:__BOOT__.S.phase,
  name:__BOOT__.S.region?.name||null, inSG:__BOOT__.S.region?.inSG??null,
  partial:__BOOT__.S.region?.partial??null,
  region:document.getElementById('regionName').textContent,
  tag:document.getElementById('mapRegion').textContent,
  rings:__BOOT__.S.highlightRings.length,
  chip:document.getElementById('geoBtn').textContent
})`))
const shot = async (name) => { const s = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(new URL(name + '.png', out), Buffer.from(s.data, 'base64')) }
const pass = (name, data) => console.log('PASS', name, JSON.stringify(data))

try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  await nav('?jump=access'); await clearGeo(); await nav('?jump=access'); await wait(1500)
  let s = await state()
  assert.equal(s.geo, false); assert.equal(s.chip, '定位 关'); assert.equal(s.tag, '全国视图 · NATIONAL')
  pass('default location is off', s)

  await ev('__BOOT__.locate(31.2304,121.4737)'); await wait(120); s = await state()
  assert.equal(s.name, '上海市'); assert.equal(s.inSG, true); assert.equal(s.tag, '上海电网'); assert.equal(s.region, '上海'); assert.ok(s.rings > 0)
  await shot('shanghai'); pass('Shanghai lookup', s)

  await ev('__BOOT__.locate(23.1291,113.2644)'); await wait(120); s = await state()
  assert.equal(s.name, '广东省'); assert.equal(s.inSG, false); assert.match(s.tag, /非国网经营区/); assert.equal(s.rings, 0)
  await shot('guangzhou'); pass('outside State Grid falls back', s)

  await ev('__BOOT__.locate(40.8426,111.7492)'); await wait(120); s = await state()
  assert.equal(s.name, '内蒙古自治区'); assert.equal(s.partial, true); assert.match(s.tag, /蒙东|蒙西/); assert.ok(s.rings > 0)
  pass('Inner Mongolia partial note', s)

  await ev('__BOOT__.locate(43.8256,87.6168)'); await wait(120); s = await state()
  assert.equal(s.name, '新疆维吾尔自治区'); assert.equal(s.tag, '新疆电网')
  pass('Xinjiang lookup', s)

  for (const item of [
    { lat: 20.02, lon: 110.35, name: '海南省', inSG: false },
    { lat: 22.32, lon: 114.17, name: '香港特别行政区', inSG: false },
    { lat: 29.65, lon: 91.13, name: '西藏自治区', inSG: true },
    { lat: 25.03, lon: 121.56, name: '台湾省', inSG: false },
  ]) {
    await ev(`__BOOT__.locate(${item.lat},${item.lon})`); await wait(100); s = await state()
    assert.equal(s.name, item.name); assert.equal(s.inSG, item.inSG)
  }
  pass('coverage boundaries: Hainan / Hong Kong / Tibet / Taiwan', true)

  // Real navigator.geolocation path with CDP permission + override.
  await clearGeo(); await nav('?jump=access')
  await call('Browser.grantPermissions', { origin, permissions: ['geolocation'] })
  await call('Emulation.setGeolocationOverride', { latitude: 31.2304, longitude: 121.4737, accuracy: 30 })
  await click('#geoBtn'); await wait(1100); s = await state()
  assert.equal(s.geo, true); assert.equal(s.name, '上海市'); assert.equal(s.tag, '上海电网'); assert.equal(s.chip, '定位 开')
  assert.match(await ev('document.cookie'), /dsh_boot_grid_zmd_geo=1/)
  await shot('live-shanghai'); pass('live geolocation path', s)

  await click('#geoBtn'); await wait(200); s = await state()
  assert.equal(s.geo, false); assert.equal(s.name, null); assert.equal(s.tag, '全国视图 · NATIONAL'); assert.equal(s.chip, '定位 关')
  pass('location toggle off', s)

  // Denial / unavailable fallback.
  await ev(`navigator.geolocation.getCurrentPosition = (ok, err) => err({ code: 1, message: 'denied' })`)
  await click('#geoBtn'); await wait(250); s = await state()
  assert.equal(s.geo, false); assert.equal(s.name, null); assert.equal(s.tag, '全国视图 · NATIONAL'); assert.equal(s.chip, '定位 关')
  assert.match(await ev('document.cookie'), /dsh_boot_grid_zmd_geo=0/)
  pass('permission denial falls back to national view', s)

  // Geo preference must not block auto demo (fresh page clears the denial stub).
  await nav('?jump=access'); await click('#geoBtn'); await wait(500)
  assert.equal((await state()).name, '上海市')
  await call('Page.navigate', { url: url + '?auto=1' }); await wait(3800); s = await state()
  assert.equal(s.geo, true); assert.equal(s.name, '上海市'); assert.equal(s.phase, 'order')
  pass('auto demo with location enabled', s)

  await ev(`document.cookie='dsh_boot_grid_zmd_geo=0; path=/; max-age=3600'`)
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await nav('?jump=access'); await wait(1500); await ev('__BOOT__.locate(31.2304,121.4737)'); await wait(300)
  const layout = JSON.parse(await ev(`(()=>{const g=document.getElementById('geoBtn').getBoundingClientRect(),m=document.getElementById('mapRegion').getBoundingClientRect(),d=document.getElementById('dock').getBoundingClientRect();return JSON.stringify({geoInViewport:g.left>=0&&g.right<=innerWidth&&g.bottom<=innerHeight,regionInMap:m.left>=0&&m.right<=innerWidth,idline:getComputedStyle(document.querySelector('.idline')).display,dock:d.toJSON()})})()`))
  assert.equal(layout.geoInViewport, true); assert.equal(layout.regionInMap, true); assert.equal(layout.idline, 'none')
  await shot('shanghai-1024'); pass('1024 location chip and tag fit', layout)

  // Real DSH overlay path: screen.js iframe with allow=geolocation.
  await nav('?jump=access'); await wait(300)
  await ev(`document.cookie='dsh_boot_grid_zmd_mode=manual; path=/; max-age=3600'; document.cookie='dsh_boot_grid_zmd_geo=1; path=/; max-age=3600'`)
  const screen = fs.readFileSync(new URL('../assets/screen.js', import.meta.url), 'utf8')
  await ev(screen); await wait(1800)
  const frameSrc = await ev('document.querySelector("[data-dsh-boot-grid-zmd] iframe")?.getAttribute("src")')
  assert.match(frameSrc, /auto=0/)
  const frameState = await ev(`(()=>{try{const w=document.querySelector('[data-dsh-boot-grid-zmd] iframe').contentWindow;return JSON.stringify({geo:w.__BOOT__?.S.geo,name:w.__BOOT__?.S.region?.name,tag:w.document.getElementById('mapRegion')?.textContent})}catch(e){return 'ERR '+e.message}})()`)
  assert.match(frameState, /上海/)
  const frameObj = JSON.parse(frameState); assert.equal(frameObj.geo, true); assert.equal(frameObj.name, '上海市'); assert.equal(frameObj.tag, '上海电网')
  pass('overlay iframe geolocation', frameObj)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait(900)
  assert.equal(await ev('!!document.querySelector("[data-dsh-boot-grid-zmd]")'), false)

  assert.deepEqual(errors, [], 'runtime exceptions')
  const assetFailures = failures.filter(f => !f.url.endsWith('/favicon.ico'))
  assert.deepEqual(assetFailures, [], 'asset failures')
  pass('runtime and asset errors', { exceptions: errors, failedRequests: failures })
} finally {
  await call('Emulation.clearGeolocationOverride').catch(() => {})
  await call('Browser.resetPermissions').catch(() => {})
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => {})
  await call('Page.navigate', { url }).catch(() => {})
  ws.close()
}
