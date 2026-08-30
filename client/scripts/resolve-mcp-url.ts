const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Registering against a deployed (non-loopback) mcp-server without also
 * setting MCP_SHARED_SECRET used to succeed silently: the connector got
 * registered with the loopback default (pointing a deployed TrueForge
 * connector at its own localhost) or, if SENTINEL_MCP_URL was corrected
 * without also setting the secret, an unauthenticated connector that then
 * 401s on every real tool call — Render's generated MCP_SHARED_SECRET
 * protects every deployed request. Fail immediately with the fix instead.
 *
 * Pulled out of register.ts (rather than tested via that file directly)
 * because register.ts calls main() at import time — importing it in a test
 * would perform real registration calls against a TrueForge instance.
 */
export function resolveMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.SENTINEL_MCP_URL ?? "http://127.0.0.1:8791/mcp";
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`SENTINEL_MCP_URL is not a valid URL: "${url}"`);
  }
  const isLoopback = LOOPBACK_HOSTNAMES.has(hostname);
  if (!isLoopback && !env.MCP_SHARED_SECRET) {
    throw new Error(
      `SENTINEL_MCP_URL ("${url}") is not a loopback address, so this looks like a deployed server ` +
      "(e.g. Render) — those always require MCP_SHARED_SECRET and reject every unauthenticated request " +
      "with 401. Set MCP_SHARED_SECRET to the value Render generated for the sentinel-alpaca-mcp service " +
      "(Render dashboard → sentinel-alpaca-mcp → Environment) before running register. " +
      "See README's \"Deploying to Render\" section for the full command.",
    );
  }
  return url;
}
