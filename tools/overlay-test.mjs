// 验证 screen.js：注入后能铺 iframe 覆盖层，Esc 能移除
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const root = fileURLToPath(new URL('..', import.meta.url))
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
const evalv = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value
await call('Page.enable'); await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await call('Page.navigate', { url: 'http://127.0.0.1:8123/plugins/dsh-boot-grid-zmd/' })
await sleep(1200)

const src = fs.readFileSync(join(root, 'assets/screen.js'), 'utf8')
await evalv(`globalThis.__DSH_BOOT_GRID_ZMD_CFG__ = ${JSON.stringify({ route: 'http://127.0.0.1:8123/plugins/dsh-boot-grid-zmd', holdMs: 60000, loadMs: 9000 })}`)
await evalv(src)
await sleep(900)
const mounted = await evalv(`(()=>{const r=document.querySelector('[data-dsh-boot-grid-zmd]');const f=r&&r.querySelector('iframe');return JSON.stringify({mounted:!!r,src:f?f.getAttribute('src'):null})})()`)
console.log('overlay:', mounted)

await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(1000)
const after = await evalv(`JSON.stringify({mounted:!!document.querySelector('[data-dsh-boot-grid-zmd]')})`)
console.log('after Esc:', after)
console.log('errors:', errors.length ? errors : 'none')
ws.close()
