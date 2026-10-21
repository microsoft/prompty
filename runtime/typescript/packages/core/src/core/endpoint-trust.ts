/**
 * Endpoint trust — keep ambient credentials on host-approved destinations (spec §2.5.1).
 *
 * A `.prompty` file is untrusted input. When its connection carries no
 * file-supplied credential, executors fall back to ambient credentials
 * (`DefaultAzureCredential`, `*_API_KEY` env vars). This module decides
 * whether the file-chosen destination may receive them.
 *
 * @module
 */

import { PromptyLoadError } from "./errors.js";

/** Env var holding additional comma-separated trusted origins. */
export const TRUSTED_ENDPOINTS_ENV = "PROMPTY_TRUSTED_ENDPOINTS";

/** First-party provider origins that are always trusted. */
export const BUILTIN_TRUSTED_ENDPOINTS: readonly string[] = Object.freeze([
  "https://api.openai.com",
  "https://api.anthropic.com",
  "https://*.openai.azure.com",
  "https://*.services.ai.azure.com",
  "https://*.cognitiveservices.azure.com",
  "https://login.microsoftonline.com",
]);

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };
const CREDENTIAL_KEYS: Record<string, string> = {
  key: "apiKey",


};
const DESTINATION_KEYS = ["endpoint", "tokenUrl"] as const;

type Origin = [scheme: string, host: string, port: number];

/** Return `[scheme, host, port]` for an absolute http(s) URL, else `undefined`. */
function origin(url: string): Origin | undefined {
  const trimmed = url.trim();
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(trimmed);
  if (!match) return undefined;
  const scheme = match[1].toLowerCase();
  if (!(scheme in DEFAULT_PORTS)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return undefined;
  const port = parsed.port ? Number(parsed.port) : DEFAULT_PORTS[scheme];
  return [scheme, host, port];
}

function trustedEntries(trustedEndpoints?: Iterable<string>): string[] {
  const entries: unknown[] = [
    ...BUILTIN_TRUSTED_ENDPOINTS,
    ...(trustedEndpoints ?? []),
    ...(process.env[TRUSTED_ENDPOINTS_ENV] ?? "").split(","),
  ];
  return entries
    .filter((e): e is string => typeof e === "string")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

/**
 * Return `true` if `url`'s origin matches a built-in, host-supplied, or
 * `PROMPTY_TRUSTED_ENDPOINTS` trusted origin.
 */
export function isTrustedEndpoint(
  url: string,
  trustedEndpoints?: Iterable<string>,
): boolean {
  const entries = trustedEntries(trustedEndpoints);
  if (entries.includes("*")) return true;
  const target = origin(url);
  if (!target) return false;
  const [scheme, host, port] = target;
  for (const entry of entries) {
    const allowed = origin(entry);
    if (!allowed || allowed[0] !== scheme || allowed[2] !== port) continue;
    const pattern = allowed[1];
    if (pattern.startsWith("*.")) {
      if (host.endsWith(pattern.slice(1))) return true;
    } else if (pattern === host) {
      return true;
    }
  }
  return false;
}

function isReference(value: string): boolean {
  return value.startsWith("${") && value.endsWith("}");
}

function fileSuppliedCredential(connection: Record<string, unknown>): boolean {
  // Only the credential field the declared kind actually consumes counts; any other kind is ambient.
  const kind = connection["kind"];
  const key =
    typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(CREDENTIAL_KEYS, kind)
      ? CREDENTIAL_KEYS[kind]
      : undefined;
  if (key === undefined) return false;
  const value = connection[key];
  return typeof value === "string" && value.length > 0 && !isReference(value);
}

/** Return the effective destination if the file chose it, else `undefined`. */
function fileControlledDestination(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return String(value);
  if (isReference(value)) {
    const inner = value.slice(2, -1);
    const colon = inner.indexOf(":");
    const protocol = colon === -1 ? inner : inner.slice(0, colon);
    const rest = colon === -1 ? "" : inner.slice(colon + 1);
    if (protocol.toLowerCase() === "env") {
      const next = rest.indexOf(":");
      const varName = next === -1 ? rest : rest.slice(0, next);
      const defaultVal = next === -1 ? "" : rest.slice(next + 1);
      if (process.env[varName] !== undefined) return undefined;
      return defaultVal || undefined;
    }
  }
  return value;
}

/**
 * Throw `untrusted_endpoint` if ambient credentials could reach a file-chosen,
 * untrusted destination.
 *
 * @param connection - The RAW (unresolved) `model.connection` mapping.
 * @param trustedEndpoints - Host-supplied trusted origins.
 */
export function checkConnectionTrust(
  connection: unknown,
  trustedEndpoints?: Iterable<string>,
): void {
  if (
    typeof connection !== "object" ||
    connection === null ||
    Array.isArray(connection)
  ) {
    return;
  }
  const conn = connection as Record<string, unknown>;
  if (conn["kind"] === "reference") return;
  if (fileSuppliedCredential(conn)) return;
  for (const key of DESTINATION_KEYS) {
    const destination = fileControlledDestination(conn[key]);
    if (
      destination !== undefined &&
      !isTrustedEndpoint(destination, trustedEndpoints)
    ) {
      throw new PromptyLoadError(
        "untrusted_endpoint",
        `Connection ${key} '${destination}' is not trusted to receive ambient credentials. ` +
          `Set the ${key} via \${env:VAR}, add its origin to trustedEndpoints or ` +
          `${TRUSTED_ENDPOINTS_ENV}, or use 'kind: reference'.`,
      );
    }
  }
}
