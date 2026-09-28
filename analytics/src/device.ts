// Works out which device, OS and browser an import came from, for the
// puzzle_imports device columns.
//
// Mostly from the request's own User-Agent header, which every browser sends
// by itself. Two things it can't tell on its own, so the page adds a few hints
// to the body (see frontend/src/importAnalytics.ts):
//  - iPads (iPadOS 13+) send a desktop Mac User-Agent by default; only the
//    touch screen (`touchPoints` > 1) tells them apart.
//  - Chromium browsers "reduce" the User-Agent: Android is always
//    "Android 10; K", macOS always 10_15_7, Windows 10 and 11 both
//    "Windows NT 10.0". The real model and OS version come from User-Agent
//    Client Hints (`model`, `platformVersion`), which only Chromium has.
// Hints are only ever used to fill in or correct what the header says, never
// trusted on their own, and are length-limited in parseHints.
//
// A small hand-written parser rather than a library: it only needs the
// common cases, and ua-parser-js (the usual choice) is AGPL from v2 on.
// Anything it doesn't recognise is left NULL - the raw User-Agent is stored
// too, so rows can be re-classified later.

export interface DeviceHints {
  touchPoints?: number
  platform?: string
  platformVersion?: string
  model?: string
  mobile?: boolean
}

export interface DeviceInfo {
  /** 'phone' | 'tablet' | 'desktop' | 'unknown' */
  deviceType: string
  /** e.g. 'iPhone', 'iPad', 'Samsung SM-S918B', 'Google Pixel 7', 'Chromebook', 'Mac', 'Windows PC' */
  device: string | null
  /** e.g. 'iOS', 'iPadOS', 'Android', 'Windows', 'macOS', 'ChromeOS', 'Linux' */
  os: string | null
  /** e.g. '15.4', '13', '11', '10/11' - null when the browser doesn't say */
  osVersion: string | null
  /** e.g. 'Safari', 'Chrome', 'Samsung Internet', 'Firefox', 'Edge' */
  browser: string | null
  browserVersion: string | null
}

const MAX_HINT_LENGTH = 64

/** The hints part of the request body - anything malformed is dropped. */
export function parseHints(value: unknown): DeviceHints {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const raw = value as Record<string, unknown>
  const text = (v: unknown) =>
    typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_HINT_LENGTH).replace(/[^\x20-\x7e]/g, '') : undefined
  return {
    touchPoints:
      typeof raw.touchPoints === 'number' && Number.isFinite(raw.touchPoints) ? Math.max(0, Math.min(raw.touchPoints, 100)) : undefined,
    platform: text(raw.platform),
    platformVersion: text(raw.platformVersion),
    model: text(raw.model),
    mobile: typeof raw.mobile === 'boolean' ? raw.mobile : undefined,
  }
}

/** Android model code prefixes -> brand, for the models whose code doesn't
 * already name it ("Pixel 7" does; "SM-S918B" doesn't). Checked in order. */
const ANDROID_BRANDS: Array<[RegExp, string]> = [
  [/^(SM-|GT-|SC-|SCV|SGH-)/i, 'Samsung'],
  [/^Pixel/i, 'Google'],
  [/^(moto|XT\d)/i, 'Motorola'],
  [/^(Redmi|POCO|Mi |MI |M\d{4}|2\d{3}[A-Z0-9]{4,})/, 'Xiaomi'],
  [/^(ONEPLUS|KB2|LE2|IN2|NE2|CPH2[4-9]|PH[A-Z]1)/i, 'OnePlus'],
  [/^(CPH|PH[A-Z]M)/, 'OPPO'],
  [/^RMX/, 'realme'],
  [/^V2\d{3}/, 'vivo'],
  [/^(HUAWEI|[A-Z]{3}-(L|AL|TL|LX|W)\d)/, 'Huawei'],
  [/^(LM-|LG-)/, 'LG'],
  [/^(Nokia|TA-\d)/i, 'Nokia'],
  [/^(KF[A-Z]{2,4}|AFT)/, 'Amazon'],
  [/^Lenovo/i, 'Lenovo'],
  [/^(ASUS|ZS\d|AI\d)/i, 'ASUS'],
  [/^(SO-|XQ-|G8\d)/, 'Sony'],
]

function androidBrand(model: string): string | null {
  for (const [pattern, brand] of ANDROID_BRANDS) {
    if (pattern.test(model)) {
      return brand
    }
  }
  return null
}

function dotted(version: string | undefined): string | null {
  return version ? version.replace(/_/g, '.') : null
}

/** "15.4.1" -> "15.4", "13.0.0" -> "13", "10.0" -> "10" - enough to group by. */
function shortVersion(version: string | null): string | null {
  if (!version) {
    return null
  }
  const [major, minor] = version.split('.')
  return minor && minor !== '0' ? `${major}.${minor}` : major
}

function detectBrowser(ua: string): { browser: string | null; browserVersion: string | null } {
  const found = (browser: string, pattern: RegExp) => {
    const match = ua.match(pattern)
    return match ? { browser, browserVersion: shortVersion(match[1]) } : null
  }
  // Order matters: most of these also say "Chrome" and "Safari".
  return (
    found('Samsung Internet', /SamsungBrowser\/([\d.]+)/) ??
    found('Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/) ??
    found('Opera', /(?:OPR|OPT|Opera)\/([\d.]+)/) ??
    found('Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/) ??
    found('Chrome', /(?:CriOS|Chrome)\/([\d.]+)/) ??
    found('Safari', /Version\/([\d.]+).*Safari/) ?? { browser: null, browserVersion: null }
  )
}

export function describeDevice(userAgent: string, hints: DeviceHints): DeviceInfo {
  const ua = userAgent
  const { browser, browserVersion } = detectBrowser(ua)
  const info = (deviceType: string, device: string | null, os: string | null, osVersion: string | null): DeviceInfo => ({
    deviceType,
    device,
    os,
    osVersion,
    browser,
    browserVersion,
  })
  // Client Hints' platformVersion is the real one when the header's is frozen.
  const hintVersion = hints.platformVersion ? shortVersion(hints.platformVersion) : null

  const iOS = ua.match(/\((iPhone|iPad|iPod)[^)]*?OS ([\d_]+)/)
  if (iOS) {
    const [, kind, version] = iOS
    const osVersion = shortVersion(dotted(version))
    return kind === 'iPad' ? info('tablet', 'iPad', 'iPadOS', osVersion) : info('phone', kind === 'iPod' ? 'iPod touch' : 'iPhone', 'iOS', osVersion)
  }

  if (/Macintosh/.test(ua)) {
    // iPadOS 13+ asks for desktop sites with a Mac User-Agent; a Mac has no
    // touch screen. Safari's own version tracks iPadOS's major version.
    if ((hints.touchPoints ?? 0) > 1) {
      return info('tablet', 'iPad', 'iPadOS', browser === 'Safari' ? browserVersion : null)
    }
    const version = dotted(ua.match(/Mac OS X ([\d_.]+)/)?.[1])
    // Every current browser freezes this at 10.15(.7) whatever the real
    // version; only Chromium's Client Hints know better. A frozen value says
    // nothing, so it's left NULL rather than recorded as 10.15.
    const frozen = version === '10.15.7' || version === '10.15'
    return info('desktop', 'Mac', 'macOS', hintVersion ?? (frozen ? null : shortVersion(version)))
  }

  if (/CrOS/.test(ua)) {
    return info('desktop', 'Chromebook', 'ChromeOS', hintVersion ?? shortVersion(ua.match(/CrOS \S+ ([\d.]+)/)?.[1] ?? null))
  }

  const android = ua.match(/Android ([\d.]+)(?:;\s*([^;)]+?))?(?:\s+Build\/[^;)]*)?[;)]/)
  if (android || /Android/.test(ua)) {
    // Reduced Chromium UAs say "Android 10; K" whatever the phone, so both
    // the model and the version are meaningless there without Client Hints.
    const headerModel = android?.[2]?.trim()
    const reduced = headerModel === 'K'
    const model =
      hints.model || (headerModel && !reduced && !/^(wv|Linux|U|Mobile|Tablet)$/.test(headerModel) ? headerModel : undefined)
    const osVersion = hintVersion ?? (android && !reduced ? shortVersion(android[1]) : null)
    const tablet = hints.mobile === false || (!/Mobile/.test(ua) && hints.mobile !== true) || /^SM-[TXP]/.test(model ?? '')
    const brand = model ? androidBrand(model) : null
    const device = model
      ? brand && !model.toLowerCase().startsWith(brand.toLowerCase())
        ? `${brand} ${model}`
        : model
      : tablet
        ? 'Android tablet'
        : 'Android phone'
    return info(tablet ? 'tablet' : 'phone', device, 'Android', osVersion)
  }

  const windows = ua.match(/Windows NT ([\d.]+)/)
  if (windows) {
    // "Windows NT 10.0" is both 10 and 11; Client Hints say 13+ for 11.
    // Without them (Firefox, Safari) it stays '10/11'.
    const hintMajor = hints.platformVersion ? Number(hints.platformVersion.split('.')[0]) : NaN
    const osVersion =
      Number.isFinite(hintMajor) && hints.platform === 'Windows'
        ? hintMajor >= 13
          ? '11'
          : hintMajor > 0
            ? '10'
            : null
        : (({ '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }) as Record<string, string>)[windows[1]] ?? windows[1]
    return info('desktop', 'Windows PC', 'Windows', osVersion)
  }

  if (/Linux/.test(ua)) {
    return info('desktop', 'Linux PC', 'Linux', null)
  }
  return info('unknown', null, null, null)
}
