// Shared by importAnalytics.ts and usageTracking.ts; read on the Worker by
// analytics/src/device.ts.

interface UserAgentData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ platform?: string; platformVersion?: string; model?: string; mobile?: boolean }>
}

/** What the User-Agent header can't say by itself (see analytics/src/device.ts):
 * the touch-point count, which is what tells an iPad (whose Safari claims to
 * be a Mac) from a Mac, and - Chromium only, via User-Agent Client Hints -
 * the real phone model and OS version the header now hides. Best effort:
 * anything unavailable is just left out. */
export async function deviceHints(): Promise<Record<string, unknown>> {
  const hints: Record<string, unknown> = { touchPoints: navigator.maxTouchPoints ?? 0 }
  try {
    const uaData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
    if (uaData?.getHighEntropyValues) {
      const values = await uaData.getHighEntropyValues(['model', 'platformVersion'])
      hints.platform = values.platform
      hints.platformVersion = values.platformVersion
      hints.model = values.model
      hints.mobile = values.mobile
    }
  } catch {
    // Not available, or refused - the header alone will do.
  }
  return hints
}
