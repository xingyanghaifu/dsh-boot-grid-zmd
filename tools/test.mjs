// 交互验收：真实 CDP 鼠标事件走完 按住 → 复诵 → 执行 → 拖动合闸 → 全网启动 → 完成
// node test.mjs <url> <shotDir>
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const url = process.argv[2] || pathToFileURL(join(root, 'assets/index.html')).href
const dir = process.argv[3] || join(root, 'docs/shots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url === 'about:blank') || targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.text || 'exception')
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text)
  if (!msg.id || !pending.has(msg.id)) return
  const p = pending.get(msg.id); pending.delete(msg.id)
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
  else p.resolve(msg.result)
})
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }))
})
const evalv = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value

await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await call('Page.navigate', { url })
await sleep(1200)

const rect = async (sel) => evalv(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`)
const mouse = (type, x, y, buttons = 0) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
const click = async (sel) => { const r = await rect(sel); await mouse('mousePressed', r.x, r.y, 1); await sleep(60); await mouse('mouseReleased', r.x, r.y, 0) }
const shot = async (name) => {
  const s = await call('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(`${dir}/${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('shot', name)
}
const state = async (tag) => {
  const s = await evalv(`JSON.stringify({phase:__BOOT__.S.phase, progress:__BOOT__.S.progress, brk:__BOOT__.S.brk, done:__BOOT__.S.done})`)
  console.log(tag, s)
  return JSON.parse(s)
}

let s = await state('start')
if (s.phase !== 'access') throw new Error('expected access')

// 1) 按住 1.5s
let r = await rect('#holdBtn')
await mouse('mousePressed', r.x, r.y, 1)
await sleep(1500)
await mouse('mouseReleased', r.x, r.y, 0)
await sleep(500)
await shot('10-hold-success')
s = await state('after-hold')
if (s.phase !== 'order') throw new Error('hold did not advance: ' + s.phase)

// 2) 等指令打完，点复诵 → 等回显，点执行
await sleep(1400)
await shot('11-order-ready')
await click('#repeatBtn')
await sleep(1600)
await shot('12-readback')
s = await state('after-repeat')
if (!(await evalv('__BOOT__.S.repeated'))) throw new Error('readback not registered')
await click('#execBtn')
await sleep(1200)
s = await state('after-exec')
if (s.phase !== 'close') throw new Error('exec did not advance: ' + s.phase)

// 3) 拖动合闸把手到 100%
const knob = await rect('#brkKnob')
const track = await rect('#brkTrack')
await mouse('mousePressed', knob.x, knob.y, 1)
for (let i = 1; i <= 12; i++) {
  await mouse('mouseMoved', track.x - track.w / 2 + (track.w * i) / 12, knob.y, 1)
  await sleep(45)
}
await shot('13-breaker-drag')
await mouse('mouseReleased', track.x + track.w / 2, knob.y, 0)
await sleep(1200)
s = await state('after-close')
if (s.phase !== 'boot') throw new Error('close did not advance: ' + s.phase)

// 4) 启动中段 / 完成
await sleep(1800)
await shot('14-boot-mid')
await sleep(6200)
s = await state('after-boot')
if (!s.done) throw new Error('boot did not finish')
await sleep(800)
await shot('15-done')
await click('#doneCta')
await sleep(400)
console.log('errors:', errors.length ? errors : 'none')
ws.close()
if (errors.length) process.exitCode = 1
