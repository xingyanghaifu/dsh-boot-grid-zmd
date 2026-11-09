import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const dir = fileURLToPath(new URL('../assets/', import.meta.url))
const html = fs.readFileSync(dir + 'index.html', 'utf8')
const js = fs.readFileSync(dir + 'boot.js', 'utf8')
const css = fs.readFileSync(dir + 'boot.css', 'utf8')

// 1) JS 语法
try { new Function(js) } catch (e) { console.error('JS syntax error:', e.message); process.exitCode = 1 }

// 2) HTML id -> JS 引用
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])
const refs = [...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1])
const missing = [...new Set(refs)].filter(r => !ids.includes(r))
console.log('ids:', ids.length, 'refs:', new Set(refs).size, 'missing:', missing.length ? missing : 'none')

// 3) CSS 里引用的 id 不存在
for (const m of css.matchAll(/#([a-zA-Z][\w-]*)/g)) {
  const id = m[1]
  if (/^[0-9a-f]{3,6}$/i.test(id)) continue
  if (['bg', 'stage', 'map', 'wave', 'frame', 'scan'].includes(id)) continue
  if (!ids.includes(id)) console.log('css id not in html (may be fine):', id)
}

// 4) 脚本加载顺序
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1])
console.log('scripts:', scripts)
for (const s of scripts) if (!fs.existsSync(dir + s)) { console.error('missing script file:', s); process.exitCode = 1 }

// 5) 关键 ID 清单
const must = ['stage', 'map', 'bg', 'wave', 'log', 'fill', 'pct', 'phaseText', 'dock', 'stepNo', 'stepName', 'stepEn',
  'holdBtn', 'holdArc', 'holdFill', 'holdT', 'orderText', 'orderEcho', 'repeatBtn', 'execBtn', 'brkTrack', 'brkFill',
  'brkKnob', 'kv', 'bootFill', 'bootPct', 'dockHint', 'toast', 'skipBtn', 'hush', 'done', 'doneCta', 'soundChip',
  'mapCoord', 'nodeTip', 'clock', 'modeChip', 'freq', 'volt', 'act', 'state']
const missMust = must.filter(x => !ids.includes(x))
console.log('must ids missing:', missMust.length ? missMust : 'none')
if (missMust.length) process.exitCode = 1

console.log('js chars:', js.length, 'css chars:', css.length, 'html chars:', html.length)
