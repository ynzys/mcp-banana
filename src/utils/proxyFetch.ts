/**
 * Proxy-aware fetch utility
 * Creates a fetch function that routes requests through a proxy if configured.
 * Reads HTTPS_PROXY / HTTP_PROXY environment variables automatically.
 */

/**
 * Returns a proxy-aware fetch function if a proxy is configured,
 * otherwise returns undefined (SDK will use its default fetch).
 */
export async function createProxyFetch(): Promise<typeof fetch | undefined> {
  const proxyUrl =
    process.env['HTTPS_PROXY'] ||
    process.env['https_proxy'] ||
    process.env['HTTP_PROXY'] ||
    process.env['http_proxy']

  if (!proxyUrl) {
    return undefined
  }

  try {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici')
    const dispatcher = new ProxyAgent(proxyUrl)

    return (...args: Parameters<typeof fetch>) =>
      undiciFetch(args[0] as Parameters<typeof undiciFetch>[0], {
        ...(args[1] as object),
        dispatcher,
      }) as unknown as Promise<Response>
  } catch {
    // undici not available, fall back to default fetch
    return undefined
  }
}
