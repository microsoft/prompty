/**
 * Connection registry for pre-configured SDK clients.
 *
 * Executors look up registered connections when
 * `model.connection.kind === "reference"`.
 *
 * @module
 */

const connections = new Map<string, unknown>();

/**
 * Register a pre-configured SDK client by name.
 *
 * @example
 * ```ts
 * import OpenAI from "openai";
 * registerConnection("my-openai", new OpenAI({ apiKey: "sk-..." }));
 * ```
 */
export function registerConnection(name: string, client: unknown): void {
  connections.set(name, client);
}

/**
 * Look up a registered connection.
 * @throws {Error} if the name is not registered.
 */
export function getConnection(name: string): unknown {
  const c = connections.get(name);
  if (c === undefined) {
    throw new Error(
      `Connection "${name}" is not registered. ` +
      `Call registerConnection("${name}", client) first.`,
    );
  }
  return c;
}

/** Remove all registered connections. Useful in tests. */
export function clearConnections(): void {
  connections.clear();
}
