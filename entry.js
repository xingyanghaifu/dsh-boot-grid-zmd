/**
 * dsh-boot-grid-zmd — 国家电网 × 终末地风格开机动效的 Host 半边。
 *
 * 两件事：
 *   1. 把动画的静态资源挂在 `/plugins/dsh-boot-grid-zmd` 下（白名单，无目录穿越）。
 *   2. 在 index 渲染时往 `<head>` 注入一段脚本，由它铺一层 iframe 覆盖层。
 *
 * 为什么用 iframe：动画自带一整套 CSS 变量、全局选择器和 canvas，
 * 直接注进宿主等于共享作用域。iframe 让它出不了自己的框——这段代码
 * 出任何问题最多是「框没出来」，不会动到应用本身。
 *
 * 退场兜底在 screen.js 里：Esc、载入看门狗、总时长上限。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROUTE = '/plugins/dsh-boot-grid-zmd'

/** 覆盖层总时长上限（毫秒）。自动演示约 16 秒；留给用户交互余量。 */
const HOLD_MS = 60000

/** iframe 载入看门狗：连页面都没起来就别再挡着了。 */
const LOAD_MS = 9000

export const name = 'dsh-boot-grid-zmd'

export const inject = ['webServer']

const ASSET_DIR = fileURLToPath(new URL('./assets/', import.meta.url))
const SCREEN_PATH = join(ASSET_DIR, 'screen.js')

/** 白名单：能返回的文件本来就只有这几个。 */
const FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/boot.css', ['boot.css', 'text/css; charset=utf-8']],
  ['/boot.js', ['boot.js', 'text/javascript; charset=utf-8']],
  ['/china-data.js', ['china-data.js', 'text/javascript; charset=utf-8']],
  ['/logo-mark.png', ['logo-mark.png', 'image/png']],
])

/**
 * 覆盖层脚本，每次 index 渲染时重新读。
 * 读不到就返回空串：宿主退回它自己的启动页，这条路径是安全的。
 */
function screenSource() {
  try {
    return readFileSync(SCREEN_PATH, 'utf8')
  } catch (error) {
    process.emitWarning(`boot-grid-zmd: 无法读取 ${SCREEN_PATH}: ${String(error)}`)
    return ''
  }
}

export function apply(ctx) {
  const server = ctx.webServer

  if (!server) {
    ctx.logger?.warn?.('boot-grid-zmd: 没有 webServer，跳过')
    return
  }

  ctx.effect(() => server.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (req, res) => {
      const raw = (req.url ?? '/').split('?')[0]
      const rel = raw.startsWith(ROUTE) ? (raw.slice(ROUTE.length) || '/') : '/'
      const entry = FILES.get(rel)

      if (!entry) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('not found')
        return
      }

      const [file, type] = entry
      try {
        const body = readFileSync(join(ASSET_DIR, file))
        res.statusCode = 200
        res.setHeader('Content-Type', type)
        res.setHeader('Content-Length', String(body.length))
        // 开机资源改了要立刻生效，不做缓存
        res.setHeader('Cache-Control', 'no-store')
        if ((req.method ?? 'GET').toUpperCase() === 'HEAD') { res.end(); return }
        res.end(body)
      } catch (error) {
        ctx.logger?.error?.('boot-grid-zmd: 资源路由失败', error)
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end('error')
        } else {
          res.end()
        }
      }
    },
  }), 'boot-grid-zmd: 资源路由')

  ctx.on('webserver/index-inject', (table) => {
    const text = screenSource()
    if (!text) return
    table.push({
      kind: 'script',
      placement: 'head',
      text: `globalThis.__DSH_BOOT_GRID_ZMD_CFG__=${JSON.stringify({
        route: ROUTE,
        holdMs: HOLD_MS,
        loadMs: LOAD_MS,
      })}`,
    })
    table.push({ kind: 'script', placement: 'head', text })
  })
}
