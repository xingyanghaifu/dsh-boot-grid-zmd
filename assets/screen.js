/**
 * dsh-boot-grid-zmd 的覆盖层：铺一层全屏 iframe，动画跑在框里。
 *
 * 三条退场路径，任意一条触发都不会再挡着应用：
 *   1. 框内上报 boot-grid-zmd:done / boot-grid-zmd:skip
 *   2. 外层按 Esc
 *   3. 兜底计时器：载入看门狗 + 总时长上限
 *
 * 本脚本不查询宿主 DOM、不读应用状态、不改宿主样式表；
 * 只创建一个 div 和一个 iframe，然后按需删掉。
 */
(function () {
  var KEY = '__DSH_BOOT_GRID_ZMD__'
  if (globalThis[KEY]) return

  var cfg = globalThis.__DSH_BOOT_GRID_ZMD_CFG__ || {}
  var route = cfg.route || '/plugins/dsh-boot-grid-zmd'
  var holdMs = cfg.holdMs || 60000
  var loadMs = cfg.loadMs || 9000

  var root = null
  var settled = false
  var loadTimer = 0

  function teardown() {
    if (settled) return
    settled = true
    globalThis.clearTimeout(loadTimer)
    if (!root) return
    var node = root
    root = null
    node.style.opacity = '0'
    globalThis.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node)
    }, 780)
  }

  function mount() {
    if (root || settled) return

    root = document.createElement('div')
    root.setAttribute('data-dsh-boot-grid-zmd', '')
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483000',
      'background:#0f1419',
      'opacity:1',
      'transition:opacity .75s ease',
      'overflow:hidden'
    ].join(';')

    var frame = document.createElement('iframe')
    frame.src = route + '/?auto=1'
    frame.setAttribute('title', '国家电网启动序列')
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0'

    root.appendChild(frame)

    var host = document.body || document.documentElement
    if (!host) { root = null; return }
    host.appendChild(root)

    loadTimer = globalThis.setTimeout(teardown, loadMs)
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      teardown()
    }
  }, true)

  globalThis.addEventListener('message', function (event) {
    if (event.data === 'boot-grid-zmd:ready') globalThis.clearTimeout(loadTimer)
    if (event.data === 'boot-grid-zmd:done' || event.data === 'boot-grid-zmd:skip') teardown()
  })

  globalThis.setTimeout(teardown, holdMs)

  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)

  globalThis[KEY] = { clientReady: teardown, dismiss: teardown }
})()
