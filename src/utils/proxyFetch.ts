/**
 * Proxy-aware fetch utility
 * Patches globalThis.fetch to route requests through a proxy if configured.
 * Reads HTTPS_PROXY / HTTP_PROXY environment variables automatically.
 *
 * @google/genai SDK calls the global fetch directly, so we must patch it.
 */

let applied = false

/**
 * If HTTPS_PROXY / HTTP_PROXY is set, replaces globalThis.fetch with a
 * proxy-aware version using undici ProxyAgent.
 * Safe to call multiple times — patches only once.
 */
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
    const { ProxyAgent, fetch: undiciFetch } = await import('undici')
    const dispatcher = new ProxyAgent(proxyUrl)

    globalThis.fetch = ((...args: Parameters<typeof fetch>) =>
      undiciFetch(args[0] as Parameters<typeof undiciFetch>[0], {
        ...(args[1] as object),
        dispatcher,
      }) as unknown as Promise<Response>) as typeof fetch
  } catch {
    // undici not available, keep default fetch
  }
}
