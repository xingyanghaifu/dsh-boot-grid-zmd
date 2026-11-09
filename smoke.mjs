// 冒烟测试：假 ctx 跑 apply()，验证路由、注入表、白名单和 MIME。
// 用法：node smoke.mjs（不需要 DSH 在运行）
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const entry = await import('./entry.js')

const routes = []
const injectHandlers = []
let effects = 0

entry.apply({
  logger: { warn: (m) => console.log('[warn]', m), error: (m, e) => console.log('[error]', m, e) },
  webServer: { register(desc) { routes.push(desc); return () => {} } },
  effect(fn, label) { effects += 1; fn(); console.log('effect:', label) },
  on(event, handler) { if (event === 'webserver/index-inject') injectHandlers.push(handler); return () => {} },
})

assert.equal(entry.name, 'dsh-boot-grid-zmd')
assert.deepEqual(entry.inject, ['webServer'])
assert.equal(routes.length, 1)
assert.equal(routes[0].kind, 'prefix')
assert.equal(routes[0].path, '/plugins/dsh-boot-grid-zmd')
assert.equal(effects, 1)

const table = []
for (const handler of injectHandlers) handler(table)
assert.equal(table.length, 2)
assert.ok(table[0].text.includes('__DSH_BOOT_GRID_ZMD_CFG__'))
assert.ok(table[1].text.includes('__DSH_BOOT_GRID_ZMD__'))

const serve = (rel) => {
  const res = {
    statusCode: 0, headers: {}, body: null, headersSent: false,
    setHeader(k, v) { this.headers[k] = v },
    end(body) { this.body = body ?? null; this.headersSent = true },
  }
  routes[0].handler({ url: `/plugins/dsh-boot-grid-zmd${rel}`, method: 'GET' }, res)
  return res
}

const ok = [['/', 'text/html'], ['/index.html', 'text/html'], ['/boot.css', 'text/css'],
  ['/boot.js', 'text/javascript'], ['/china-data.js', 'text/javascript'], ['/logo-mark.png', 'image/png']]
for (const [rel, type] of ok) {
  const res = serve(rel)
  assert.equal(res.statusCode, 200, rel)
  assert.ok(String(res.headers['Content-Type']).startsWith(type), rel + ' type')
  assert.ok(res.body && res.body.length > 0, rel + ' body')
}

for (const rel of ['/nope.js', '/../package.json', '/assets/../../etc/passwd', '/docs/design.md']) {
  const res = serve(rel)
  assert.equal(res.statusCode, 404, rel + ' should 404')
}

// 每个资产都真实存在（防止白名单指向不存在的文件）
const dir = path.resolve('assets')
for (const file of ['index.html', 'boot.css', 'boot.js', 'china-data.js', 'logo-mark.png', 'screen.js']) {
  assert.ok(fs.existsSync(path.join(dir, file)), 'missing asset ' + file)
}

// 页面不能引用白名单之外的文件
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = m[1]
  if (/^(https?:|data:)/.test(ref)) continue
  assert.ok(fs.existsSync(path.join(dir, ref)), 'page references missing file ' + ref)
}

console.log('\nsmoke ok · 6 assets · 404 guard · inject table · script refs')
