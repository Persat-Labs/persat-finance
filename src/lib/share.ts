/**
 * Share link helpers for Persat Finance.
 *
 * Always uses the current page origin so links work on Vercel, localhost,
 * or any other host — never the Arc Studio preview URL.
 */

const trimSlash = (url: string) => url.replace(/\/+$/, '')

/**
 * Returns the base URL for share links.
 * Uses window.location.origin so the link works wherever the app is deployed.
 */
export function getShareBase(): Promise<string> {
  const base = trimSlash(
    window.location.origin +
      ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'),
  )
  return Promise.resolve(base)
}

/**
 * Build a full share URL from an app-relative path.
 * e.g. buildShareLink('/deal/claim/0x123#key=0xabc')
 */
export async function buildShareLink(path: string): Promise<string> {
  return (await getShareBase()) + (path.startsWith('/') ? path : `/${path}`)
}
