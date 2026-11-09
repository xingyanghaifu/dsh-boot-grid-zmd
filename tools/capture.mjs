// CDP 截图 / 取状态：node capture.mjs <url> <out.png> [waitMs] [expr]
// 依赖本地无头 Edge：--remote-debugging-port=9223（见 README「自检」）。
import fs from 'node:fs'

const [url, out, waitArg, expr, widthArg, heightArg] = process.argv.slice(2)
const waitMs = Number(waitArg) > 0 ? Number(waitArg) : 2600
const vw = Number(widthArg) || 1440
const vh = Number(heightArg) || 900

const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url === 'about:blank') || targets.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (!msg.id || !pending.has(msg.id)) return
  const p = pending.get(msg.id); pending.delete(msg.id)
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
  else p.resolve(msg.result)
})
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id
  pending.set(n, { resolve, reject })
  ws.send(JSON.stringify({ id: n, method, params }))
})

await call('Page.enable')
await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false })
await call('Page.navigate', { url })
await new Promise((r) => setTimeout(r, waitMs))

if (expr && expr !== '-') {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  console.log('EVAL', JSON.stringify(r.result?.value ?? r.result))
}
if (out) {
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('SHOT', out)
}
ws.close()
