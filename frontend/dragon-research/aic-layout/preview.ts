// Renders every AIC row of a position, old (fixed curve) beside new
// (layoutAicOverlay), to an HTML page for eyeballing the link layout.
// Build: npx rolldown dragon-research/aic-layout/preview.ts --format esm --platform node -o dragon-research/aic-layout/.out/preview.mjs
// Run:   node dragon-research/aic-layout/.out/preview.mjs <puzzle> <out.html> [maxRows]
import fs from 'fs'
import { PuzzleImporter } from '../../src/sudoku/PuzzleImporter'
import { buildTechniqueInstances } from '../../src/techniqueEngine'
import { layoutAicOverlay } from '../../src/aicLinkLayout'
import type { FishTechnique } from '../../src/sudoku/SudokuFishFinder'

const [puzzle, out, maxRows] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 12)]
const r = await new PuzzleImporter().import(puzzle)
if (!r.ok) throw new Error(r.error)
const { board, candidates } = r
const pip = (row: number, col: number, digit: number) => ({
  x: col * 100 + (((digit - 1) % 3) + 0.5) * (100 / 3),
  y: row * 100 + (Math.floor((digit - 1) / 3) + 0.5) * (100 / 3),
})
function oldCurve(p1: { x: number; y: number }, p2: { x: number; y: number }) {
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, dx = p2.x - p1.x, dy = p2.y - p1.y
  const length = Math.hypot(dx, dy) || 1, k = Math.min(60, length * 0.25)
  return `M ${p1.x} ${p1.y} Q ${mx + (-dy / length) * k} ${my + (dx / length) * k} ${p2.x} ${p2.y}`
}
const instances = buildTechniqueInstances(board, candidates, 0, undefined, true, true, true, false, true, false, false, false, new Set<FishTechnique>(), false, Infinity, false, false, null, new Set())
const aics = instances.filter((i) => i.aicLinks && i.aicLinks.length > 0).slice(0, maxRows)
function svg(inst: (typeof aics)[number], mode: 'old' | 'new') {
  const chain = new Set((inst.aicCandidates ?? []).map((c) => `${c.row},${c.col},${c.digit}`))
  const elim = new Set(inst.eliminatedCandidates.map((c) => `${c.row},${c.col},${c.digit}`))
  let s = `<svg viewBox="-4 -4 908 908" width="430" height="430" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="900" height="900" fill="#fff"/>`
  for (let i = 0; i <= 9; i++) s += `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="900" stroke="#333" stroke-width="${i % 3 ? 1 : 4}"/><line y1="${i * 100}" x1="0" y2="${i * 100}" x2="900" stroke="#333" stroke-width="${i % 3 ? 1 : 4}"/>`
  for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
    if (board[row][col]) { s += `<text x="${col * 100 + 50}" y="${row * 100 + 68}" font-size="56" text-anchor="middle" font-family="Arial">${board[row][col]}</text>`; continue }
    for (let d = 1; d <= 9; d++) if (candidates[row][col][d - 1]) {
      const p = pip(row, col, d), k = `${row},${col},${d}`
      if (chain.has(k)) s += `<circle cx="${p.x}" cy="${p.y}" r="15" fill="#e9d5ff"/>`
      if (elim.has(k)) s += `<circle cx="${p.x}" cy="${p.y}" r="15" fill="#fca5a5"/>`
      s += `<text x="${p.x}" y="${p.y + 8}" font-size="22" text-anchor="middle" font-family="Arial" fill="${chain.has(k) ? '#6b21a8' : '#555'}">${d}</text>`
    }
  }
  if (mode === 'old') {
    for (const l of inst.aicLinks!) s += `<path d="${oldCurve(pip(l.from.row, l.from.col, l.from.digit), pip(l.to.row, l.to.col, l.to.digit))}" ${l.kind === 'strong' ? 'stroke="#dc2626" stroke-width="4"' : 'stroke="#2563eb" stroke-width="3" stroke-dasharray="7 6"'} fill="none" stroke-linecap="round"/>`
  } else {
    const o = layoutAicOverlay(inst.aicLinks!, inst.eliminatedCandidates, board, candidates)
    for (const [, g] of o.groups) {
      const pts = g.cells.map(([r2, c2]) => pip(r2, c2, g.digit))
      const x = Math.min(...pts.map((p) => p.x)) - 16.7, y = Math.min(...pts.map((p) => p.y)) - 16.7
      s += `<rect x="${x}" y="${y}" width="${Math.max(...pts.map((p) => p.x)) + 16.7 - x}" height="${Math.max(...pts.map((p) => p.y)) + 16.7 - y}" rx="16" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-dasharray="6 4"/>`
    }
    for (const p of o.paths) s += `<path d="${p.d}" ${p.kind === 'strong' ? 'stroke="#dc2626" stroke-width="4"' : 'stroke="#2563eb" stroke-width="3" stroke-dasharray="7 6"'} fill="none" stroke-linecap="round"/>`
  }
  return s + '</svg>'
}
let html = '<html><body style="font-family:Arial;margin:8px">'
for (const inst of aics) html += `<div style="margin-bottom:10px"><div style="font-size:13px">${inst.name}: ${inst.notation.slice(0, 160)}</div>${svg(inst, 'old')} ${svg(inst, 'new')}</div>`
fs.writeFileSync(out, html + '</body></html>')
console.log(aics.length, 'rows')
