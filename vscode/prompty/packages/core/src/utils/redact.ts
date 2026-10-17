/**
 * Improved secret redaction utility.
 *
 * Fixes from the original implementation:
 * - Added "key" pattern to catch "api_key", "secret_key", etc.
 * - Added "auth" to catch "authorization" headers/parameters
 * - Added "connectionString" pattern
 * - Added regex matching to catch partial key names (e.g., "my_api_key_1")
 * - Added string-value redaction for known secret patterns (e.g., "sk-", "AKIA")
 */

export function redactSecrets(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSecrets);
	}
	if (!value || typeof value !== 'object') {
		return redactSecretValue(value);
	}
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		result[key] = isSensitiveKey(key) ? '[redacted]' : redactSecrets(item);
	}
	return result;
}

export function redactSecretValue(value: unknown): unknown {
	if (typeof value !== 'string') {
		return value;
	}
	const lower = value.toLowerCase();
	// lower reserved for future pattern extensions
	// Redact values that look like known secret formats
	const patterns: RegExp[] = [
		/^sk-(proj-)?[a-zA-Z0-9-]+$/,          // OpenAI API key
		/^sk-ant-[a-zA-Z0-9-]+$/,              // Anthropic API key
		/^gh[pousr]_[a-zA-Z0-9_]+$/,             // GitHub PAT / OAuth token
		/^AKIA[0-9A-Z]{16}$/,                   // AWS access key (uppercase)
		/^xox[baprs]-[a-zA-Z0-9-]+$/,           // Slack token
		/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, // JWT
		/^AIza[0-9A-Za-z_-]{35}$/,              // Google API key
		/^Bearer\s+[a-zA-Z0-9._-]+$/,           // Bearer token in a string
	];
	if (patterns.some(p => p.test(value))) {
		return '[redacted]';
	}
	return value;
}

export function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return (
		normalized.includes('apikey') ||
		normalized.includes('api_key') ||
		normalized.includes('secret') ||
		normalized.includes('password') ||
		normalized.includes('token') ||
		normalized.includes('credential') ||
		normalized.includes('auth') ||                     // Added: catches "auth", "authorization"
		normalized.includes('key') ||                       // Added: catches "api_key", "secret_key", etc.
		normalized.includes('connectionstring') ||         // Added: connection strings
		normalized.includes('connstr') ||                  // Added: short connection string
		normalized.endsWith('_key') ||                     // Added: suffix pattern
		normalized.endsWith('-key') ||                     // Added: dash key suffix
		normalized.endsWith('_token') ||                   // Added: suffix token
		normalized.endsWith('_secret') ||                  // Added: suffix secret
		/^(api|app)[-_]*(key|token|secret)/i.test(key)     // Added: regex for prefix patterns
	);
}
