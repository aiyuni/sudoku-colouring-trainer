import { readFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import type { EraseRect, GridImage } from '../src/sudoku/SudokuGridOcr'

/** Node-side GridImage for the OCR regression run (run.ts) - the same
 * contract CanvasGridImage implements in the browser, over a PNG decoded
 * with nothing but node:zlib, so the fixtures need no extra dependency.
 * Crops are bilinearly scaled like the canvas's smoothed drawImage. */
export class NodeGridImage implements GridImage {
  width: number
  height: number
  private rgb: Uint8Array
  private gray: Uint8Array

  constructor(file: string) {
    const { width, height, rgb } = decodePng(readFileSync(file))
    this.width = width
    this.height = height
    this.rgb = rgb
    this.gray = new Uint8Array(width * height)
    for (let i = 0; i < this.gray.length; i++) {
      this.gray[i] = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2])
    }
  }

  getGray(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return 255
    }
    return this.gray[y * this.width + x]
  }

  async toCroppedDataUrl(
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
    invert = false,
    erase?: readonly EraseRect[],
  ): Promise<string> {
    const sx = Math.max(0, Math.round(x))
    const sy = Math.max(0, Math.round(y))
    const sw = Math.max(1, Math.round(w))
    const sh = Math.max(1, Math.round(h))
    const dw = Math.max(1, Math.round(sw * scale))
    const dh = Math.max(1, Math.round(sh * scale))
    const source = (xx: number, yy: number, k: number) => {
      const cx = Math.min(Math.max(xx, sx), sx + sw - 1, this.width - 1)
      const cy = Math.min(Math.max(yy, sy), sy + sh - 1, this.height - 1)
      return this.rgb[(cy * this.width + cx) * 3 + k]
    }
    const out = new Uint8Array(dw * dh * 3)
    for (let j = 0; j < dh; j++) {
      for (let i = 0; i < dw; i++) {
        const fx = sx + (i + 0.5) / scale - 0.5
        const fy = sy + (j + 0.5) / scale - 0.5
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const ax = fx - x0
        const ay = fy - y0
        for (let k = 0; k < 3; k++) {
          const top = source(x0, y0, k) * (1 - ax) + source(x0 + 1, y0, k) * ax
          const bottom = source(x0, y0 + 1, k) * (1 - ax) + source(x0 + 1, y0 + 1, k) * ax
          out[(j * dw + i) * 3 + k] = Math.round(top * (1 - ay) + bottom * ay)
        }
      }
    }
    if (erase && erase.length > 0) {
      // Same as CanvasGridImage: the crop's per-channel median, painted one
      // source pixel wider than each rect.
      const median = [0, 1, 2].map((k) => {
        const values: number[] = []
        for (let yy = sy; yy < Math.min(sy + sh, this.height); yy++) {
          for (let xx = sx; xx < Math.min(sx + sw, this.width); xx++) {
            values.push(this.rgb[(yy * this.width + xx) * 3 + k])
          }
        }
        values.sort((a, b) => a - b)
        return values[Math.floor((values.length - 1) / 2)]
      })
      for (const r of erase) {
        const x0 = Math.max(0, Math.floor((r.x - 1 - sx) * scale))
        const y0 = Math.max(0, Math.floor((r.y - 1 - sy) * scale))
        const x1 = Math.min(dw, Math.ceil((r.x + r.w + 1 - sx) * scale))
        const y1 = Math.min(dh, Math.ceil((r.y + r.h + 1 - sy) * scale))
        for (let j = y0; j < y1; j++) {
          for (let i = x0; i < x1; i++) {
            out.set(median, (j * dw + i) * 3)
          }
        }
      }
    }
    if (invert) {
      for (let i = 0; i < out.length; i++) {
        out[i] = 255 - out[i]
      }
    }
    return `data:image/png;base64,${encodePng(dw, dh, out).toString('base64')}`
  }
}

/** 8-bit, non-interlaced PNGs of any colour type - what screenshots are. */
function decodePng(buf: Buffer): { width: number; height: number; rgb: Uint8Array } {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  let palette: Buffer | null = null
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8 || data[12] !== 0) {
        throw new Error('Only 8-bit, non-interlaced PNGs are supported.')
      }
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    pos += 12 + len
  }
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const px = new Uint8Array(width * height * bpp)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 255
    }
    px.set(cur, y * stride)
    prev = cur
  }
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    if (colorType === 3) {
      rgb.set(palette!.subarray(px[i] * 3, px[i] * 3 + 3), i * 3)
    } else if (colorType === 0 || colorType === 4) {
      rgb.fill(px[i * bpp], i * 3, i * 3 + 3)
    } else {
      // Alpha (colour type 6) is composited over white.
      const alpha = colorType === 6 ? px[i * 4 + 3] / 255 : 1
      for (let k = 0; k < 3; k++) {
        rgb[i * 3 + k] = Math.round(px[i * bpp + k] * alpha + 255 * (1 - alpha))
      }
    }
  }
  return { width, height, rgb }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return c >>> 0
})

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xffffffff
  for (const byte of body) {
    crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  }
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4)
  return out
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) {
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
