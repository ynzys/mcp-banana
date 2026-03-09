/**
 * Proxy support via undici setGlobalDispatcher.
 * Sets a global ProxyAgent so all fetch calls (including @google/genai SDK)
 * are routed through the proxy automatically.
 */

let applied = false

export async function applyProxyFetch(): Promise<void> {
  if (applied) return
  applied = true

  const proxyUrl =
    process.env['HTTPS_PROXY'] ||
    process.env['https_proxy'] ||
    process.env['HTTP_PROXY'] ||
    process.env['http_proxy']

  if (!proxyUrl) return

  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici')
    setGlobalDispatcher(new ProxyAgent(proxyUrl))
  } catch {
    // undici not available
  }
}
