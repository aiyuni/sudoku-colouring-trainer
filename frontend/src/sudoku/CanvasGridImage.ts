import type { EraseRect, GridImage } from './SudokuGridOcr'

/** Browser-side GridImage, backed by a Canvas - the same algorithm in
 * SudokuGridOcr.ts runs against this in the app as runs against the Jimp-
 * backed one used to validate it offline. */
export class CanvasGridImage implements GridImage {
  width: number
  height: number
  private gray: Uint8ClampedArray
  private canvas: HTMLCanvasElement
  private rgba: Uint8ClampedArray

  private constructor(canvas: HTMLCanvasElement, gray: Uint8ClampedArray, rgba: Uint8ClampedArray) {
    this.canvas = canvas
    this.rgba = rgba
    this.width = canvas.width
    this.height = canvas.height
    this.gray = gray
  }

  static async fromImageSource(source: HTMLImageElement | ImageBitmap): Promise<CanvasGridImage> {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      throw new Error('Could not create a 2D canvas context.')
    }
    ctx.drawImage(source, 0, 0)

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const gray = new Uint8ClampedArray(canvas.width * canvas.height)
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4
      gray[i] = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2])
    }

    return new CanvasGridImage(canvas, gray, data)
  }

  static async fromBlob(blob: Blob): Promise<CanvasGridImage> {
    const bitmap = await createImageBitmap(blob)
    try {
      return await CanvasGridImage.fromImageSource(bitmap)
    } finally {
      bitmap.close()
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

    const out = document.createElement('canvas')
    out.width = dw
    out.height = dh
    const outCtx = out.getContext('2d')
    if (!outCtx) {
      throw new Error('Could not create a 2D canvas context.')
    }
    outCtx.imageSmoothingEnabled = true
    outCtx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, dw, dh)
    if (erase && erase.length > 0) {
      outCtx.fillStyle = this.medianColour(sx, sy, sw, sh)
      for (const r of erase) {
        // One source pixel wider all round, for the blob's anti-aliased fringe.
        outCtx.fillRect((r.x - 1 - sx) * scale, (r.y - 1 - sy) * scale, (r.w + 2) * scale, (r.h + 2) * scale)
      }
    }
    if (invert) {
      // Done on the pixels rather than with `ctx.filter = 'invert(1)'`,
      // which Safari ignores on canvas drawing.
      const pixels = outCtx.getImageData(0, 0, dw, dh)
      const data = pixels.data
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i]
        data[i + 1] = 255 - data[i + 1]
        data[i + 2] = 255 - data[i + 2]
      }
      outCtx.putImageData(pixels, 0, 0)
    }
    return out.toDataURL('image/png')
  }

  /** The crop's background colour: per-channel median, since background
   * covers most of any crop around a single glyph. */
  private medianColour(sx: number, sy: number, sw: number, sh: number): string {
    const channels = [0, 1, 2].map(() => new Array<number>(256).fill(0))
    let total = 0
    for (let y = sy; y < Math.min(sy + sh, this.height); y++) {
      for (let x = sx; x < Math.min(sx + sw, this.width); x++) {
        const o = (y * this.width + x) * 4
        channels.forEach((histogram, k) => histogram[this.rgba[o + k]]++)
        total++
      }
    }
    const [r, g, b] = channels.map((histogram) => {
      let seen = 0
      for (let v = 0; v < 256; v++) {
        seen += histogram[v]
        if (seen * 2 >= total) {
          return v
        }
      }
      return 255
    })
    return `rgb(${r}, ${g}, ${b})`
  }
}
