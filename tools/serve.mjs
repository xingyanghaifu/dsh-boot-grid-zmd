// 用插件真实的 entry.apply() 起一个本地静态服务，验证子路径下的资源与 MIME。
// node tools/serve.mjs [port]
import http from 'node:http'
import { apply } from '../entry.js'

const port = Number(process.argv[2]) || 8123
let handler = null

apply({
  logger: console,
  webServer: { register(desc) { handler = desc.handler; return () => {} } },
  effect(fn) { fn() },
  on() { return () => {} },
})

if (!handler) { console.error('no route'); process.exit(1) }

http.createServer((req, res) => handler(req, res)).listen(port, '127.0.0.1', () => {
  console.log(`serving http://127.0.0.1:${port}/plugins/dsh-boot-grid-zmd/`)
})
