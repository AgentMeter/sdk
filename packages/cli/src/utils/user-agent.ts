/** Injected from package.json by tsup and vitest; undefined when running source directly */
declare const __CLI_VERSION__: string | undefined;

/**
 * Sent on every API request so the server can tell which CLI versions are still in use
 * (e.g. before removing deprecated response fields)
 */
export const USER_AGENT = `agentmeter-cli/${
  typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.0.0-dev'
}`;
