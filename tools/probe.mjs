// 视觉探针：悬停提示 / 收尾黄扫 / 键盘按住 / 减弱动效
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, 'docs/shots')
const pageUrl = pathToFileURL(join(root, 'assets/index.html')).href
const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url === 'about:blank') || targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (!m.id || !pending.has(m.id)) return
  const p = pending.get(m.id); pending.delete(m.id)
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
})
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })) })
const evalv = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value
const shot = async (name) => {
  const s = await call('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(`${dir}/${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('shot', name)
}
await call('Page.enable'); await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

// 悬停：把鼠标移到「昌吉」节点上
await call('Page.navigate', { url: pageUrl })
await sleep(2200)
const node = JSON.parse(await evalv(`(()=>{const n=__BOOT__.nodes.find(x=>x.name==='昌吉');const r=document.getElementById('map').getBoundingClientRect();return JSON.stringify({x:r.x+n.x,y:r.y+n.y})})()`))
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: node.x, y: node.y, button: 'none' })
await sleep(400)
await shot('16-hover-node')

// 收尾黄扫：手动触发，停在 180ms
await evalv(`document.getElementById('sweep').classList.add('go')`)
await sleep(180)
await shot('17-sweep')
await evalv(`document.getElementById('sweep').classList.remove('go')`)

// 键盘按住：focus 按钮后 Space 1.4s
await call('Page.navigate', { url: pageUrl })
await sleep(1600)
await evalv(`document.getElementById('holdBtn').focus()`)
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' })
await sleep(1400)
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
await sleep(700)
const kb = await evalv(`JSON.stringify({phase:__BOOT__.S.phase,hold:__BOOT__.S.hold})`)
console.log('keyboard hold:', kb)

// 减弱动效
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await call('Page.navigate', { url: pageUrl + '?jump=boot' })
await sleep(2000)
const rm = await evalv(`JSON.stringify({mq:matchMedia('(prefers-reduced-motion: reduce)').matches,phase:__BOOT__.S.phase,reveal:__BOOT__.S.reveal})`)
console.log('reduced motion:', rm)
await shot('18-reduced-motion')
await call('Emulation.setEmulatedMedia', { features: [] })
ws.close()
