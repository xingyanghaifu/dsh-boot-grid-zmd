// One-off, reproducible: build names for the province rings already in china-data.js.
// Source: grid-boot/.china-raw.json (same DataV GeoJSON used to make china-data.js).
import fs from 'node:fs'
import assert from 'node:assert/strict'

const raw = JSON.parse(fs.readFileSync('E:/dshwork/grid-boot/.china-raw.json', 'utf8'))
const chinaPath = 'assets/china-data.js'
const chinaLine = fs.readFileSync(chinaPath, 'utf8').split(/\r?\n/).find((line) => line.startsWith('window.__CHINA__='))
const china = JSON.parse(chinaLine.match(/window\.__CHINA__=(\{.*\});?\s*$/)[1])
const LON0 = 72, LON1 = 137, LAT0 = 15, LAT1 = 55

function simplify(pts, tol) {
  if (pts.length <= 2) return pts
  const sq = tol * tol
  const keep = new Uint8Array(pts.length)
  keep[0] = 1; keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  const seg = (p, a, b) => {
    let x = a[0], y = a[1]
    let dx = b[0] - x, dy = b[1] - y
    if (dx || dy) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)
      if (t > 1) { x = b[0]; y = b[1] } else if (t > 0) { x += dx * t; y += dy * t }
    }
    dx = p[0] - x; dy = p[1] - y
    return dx * dx + dy * dy
  }
  while (stack.length) {
    const [f, l] = stack.pop()
    let md = 0, mi = -1
    for (let i = f + 1; i < l; i++) {
      const d = seg(pts[i], pts[f], pts[l])
      if (d > md) { md = d; mi = i }
    }
    if (md > sq && mi > 0) { keep[mi] = 1; stack.push([f, mi], [mi, l]) }
  }
  const out = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i])
  return out
}

const rings = []
const ringProvince = []
for (const f of raw.features) {
  const geometry = f.geometry
  if (!geometry) continue
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length < 6) continue
      const simplified = simplify(ring.map(([x, y]) => [x, y]), 0.045)
      if (simplified.length < 4) continue
      const flat = []
      for (const [x, y] of simplified) {
        flat.push(Math.round((x - LON0) / (LON1 - LON0) * 1000), Math.round((LAT1 - y) / (LAT1 - LAT0) * 1000))
      }
      rings.push(flat)
      ringProvince.push(f.properties.name)
    }
  }
}

assert.equal(rings.length, china.provinces.length, `ring count ${rings.length} vs ${china.provinces.length}`)
for (let i = 0; i < rings.length; i++) {
  assert.equal(rings[i].length, china.provinces[i].length, `ring ${i} length differs`)
  for (let j = 0; j < rings[i].length; j++) assert.equal(rings[i][j], china.provinces[i][j], `ring ${i} point ${j}`)
}

const SOUTHERN = new Set(['广东省', '广西壮族自治区', '云南省', '贵州省', '海南省'])
const OUTSIDE = new Set(['香港特别行政区', '澳门特别行政区', '台湾省'])
const PARTIAL = new Set(['内蒙古自治区'])
const shortName = (name) => name.replace(/(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/, '')
const provinces = raw.features.map((f) => {
  const p = f.properties
  const isProvince = Boolean(p.name)
  const name = p.name || '南海诸岛'
  const [lon, lat] = p.center || p.centroid || [0, 0]
  return {
    name,
    short: isProvince ? shortName(name) : '南海诸岛',
    adcode: p.adcode,
    center: [lon, lat],
    isProvince,
    inSG: isProvince && !SOUTHERN.has(name) && !OUTSIDE.has(name),
    partial: PARTIAL.has(name),
  }
})

const body = `window.__PROVINCE_META__=${JSON.stringify({ rings: ringProvince, provinces })};`
fs.writeFileSync(chinaPath, chinaLine + '\n' + body + '\n')
console.log('rings', rings.length, 'provinces', provinces.length, 'bytes', Buffer.byteLength(body))
console.log('inSG', provinces.filter(p => p.inSG).length, 'partial', provinces.filter(p => p.partial).map(p => p.name))
