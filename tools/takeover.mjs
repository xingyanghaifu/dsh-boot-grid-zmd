// 自动演示被真实输入接管 + iframe postMessage 两条验证
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const root = fileURLToPath(new URL('..', import.meta.url))
const pageUrl = pathToFileURL(join(root, 'assets/index.html')).href
const iframeUrl = pathToFileURL(join(root, 'tools/iframe.html')).href
const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url === 'about:blank') || targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text || 'exception')
  if (!m.id || !pending.has(m.id)) return
  const p = pending.get(m.id); pending.delete(m.id)
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
})
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })) })
const evalv = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value
await call('Page.enable'); await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

// A. 自动演示中的真实输入接管
await call('Page.navigate', { url: pageUrl + '?auto=1' })
await sleep(1600)
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1200, y: 220, button: 'left', buttons: 1, clickCount: 1 })
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1200, y: 220, button: 'left', buttons: 0, clickCount: 1 })
await sleep(2500)
const a = await evalv(`JSON.stringify({auto:__BOOT__.S.auto,phase:__BOOT__.S.phase,holding:__BOOT__.S.holding,progress:__BOOT__.S.progress})`)
console.log('A takeover:', a)

// B. iframe 内完成后 3 秒自动交还（不点击）
await call('Page.navigate', { url: iframeUrl })
await sleep(5600)
const b = await evalv(`JSON.stringify({msgs:window.__msgs})`)
console.log('B iframe auto-handoff:', b)
console.log('errors:', errors.length ? errors : 'none')
ws.close()
