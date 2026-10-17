import { redactSecrets, redactSecretValue, isSensitiveKey } from '../../utils/redact';

/* Tests for improved redaction logic */

function test_redact_key_names() {
	const data = {
		apiKey: 'sk-1234',
		api_key: 'secret',
		secretKey: 'mysecret',
		password: 'hunter2',
		token: 'abc123',
		credential: 'cred',
		auth: 'bearer-token',
		authorization: 'Bearer abc.def.ghi',
		connectionString: 'mongodb://user:pass@host',
		connStr: 'postgres://...',
		apiToken_key: 'should_redact',
	};

	for (const [key, val] of Object.entries(data)) {
		const redacted = redactSecrets({ [key]: val }) as Record<string, unknown>;
		if (redacted[key] !== '[redacted]') {
			throw new Error(`Key '${key}' was not redacted`);
		}
	}
}

function test_redact_value_patterns() {
	const secrets = [
		'sk-1pZm9...',
		'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz',
		'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz',
		'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD',
		'gho_1234567890abcdefghijklmnopqrstuvwxyz',
		'AKIA' + 'A'.repeat(16),
		'xoxb-1234567890-abcdef',
		'eyJhbGci.eyJzdWI.SflV',
		'AIzaSy' + 'B'.repeat(33),
		'Bearer abc.def.ghi',
	];

	for (const secret of secrets) {
		const result = redactSecretValue(secret);
		if (result !== '[redacted]') {
			throw new Error(`Value pattern not redacted: ${secret.slice(0, 20)}...`);
		}
	}

	// Non-secret values should pass through
	const nonSecrets = ['hello', 'plain text', '12345', 'normal-key'];
	for (const val of nonSecrets) {
		const result = redactSecretValue(val);
		if (result !== val) {
			throw new Error(`Non-secret value was redacted: ${val}`);
		}
	}
}

function test_redact_nested() {
	const data = {
		config: {
			apiKey: 'sk-123',
			nested: {
				password: 'pass',
				safe: 'val',
			},
		},
		arr: [
			{ token: 'tok' },
			{ ok: 'data' },
		],
	};

	const result = redactSecrets(data) as any;
	if (result.config.apiKey !== '[redacted]') throw new Error('Nested key not redacted');
	if (result.config.nested.password !== '[redacted]') throw new Error('Deep nested key not redacted');
	if (result.config.nested.safe !== 'val') throw new Error('Safe value was redacted');
	if (result.arr[0].token !== '[redacted]') throw new Error('Array element key not redacted');
	if (result.arr[1].ok !== 'data') throw new Error('Array safe value was redacted');
}

function test_isSensitiveKey() {
	const sensitive = ['apiKey', 'api_key', 'secret', 'password', 'token', 'credential',
		'auth', 'authorization', 'connectionString', 'connStr', 'apiToken_key',
		'my-api-key', 'auth_token', 'SECRET_KEY'];
	const safe = ['name', 'description', 'id', 'version', 'endpoint', 'provider'];

	for (const key of sensitive) {
		if (!isSensitiveKey(key)) throw new Error(`Should be sensitive: ${key}`);
	}
	for (const key of safe) {
		if (isSensitiveKey(key)) throw new Error(`Should not be sensitive: ${key}`);
	}
}

// Run tests
test_redact_key_names();
test_redact_value_patterns();
test_redact_nested();
test_isSensitiveKey();

console.log('All 4 tests passed (12 assertions)');
