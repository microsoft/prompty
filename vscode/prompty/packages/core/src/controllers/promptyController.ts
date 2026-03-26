import { ExtensionContext, Uri, Disposable, window, workspace, commands } from 'vscode';
import { load, execute, registerConnection, clearConnections, ReferenceConnection, FoundryConnection, Model, Tracer, PromptyTracer, traceSpan, sanitizeValue } from '@prompty/core';
import type { PromptAgent } from '@prompty/core';
// Import provider packages to trigger auto-registration of executors/processors
import '@prompty/openai';
import '@prompty/foundry';
import type { FoundryConnectionProfile } from '../connections/types';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionStore } from '../connections/store';
import { ConnectionProviderRegistry } from '../connections/registry';

export class PromptyController implements Disposable {
	private outputChannel = window.createOutputChannel('Prompty');

	constructor(
		private context: ExtensionContext,
		private connectionStore?: ConnectionStore,
		private connectionRegistry?: ConnectionProviderRegistry
	) {}

	public async run(uri: Uri) {
		const filePath = uri.fsPath;
		const fileName = path.basename(filePath);

		this.outputChannel.show(true);
		this.outputChannel.appendLine(`\n${'─'.repeat(60)}`);
		this.outputChannel.appendLine(`Running: ${fileName}`);
		this.outputChannel.appendLine(`${'─'.repeat(60)}`);

		// Determine the .runs output directory (workspace root)
		const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath
			?? path.dirname(filePath);
		const runsDir = path.join(workspaceRoot, '.runs');

		// Create a file-writing tracer for .tracy output
		const promptyTracer = new PromptyTracer({ outputDir: runsDir });

		try {
			this.loadEnvFile(filePath);
			await this.bridgeConnections();

			// Register tracers: output channel + file writer
			Tracer.add('vscode-output', (signature) => {
				this.outputChannel.appendLine(`  [trace] ── ${signature}`);
				return (key, value) => {
					if (key === '__end__') return;
					const display = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
					this.outputChannel.appendLine(`  [trace]    ${key}: ${display}`);
				};
			});
			Tracer.add('prompty-file', promptyTracer.factory);

			// Load agent first so we can apply sidebar connections
			const agent = load(filePath);
			await this.applyDefaultConnection(agent);

			this.outputChannel.appendLine(`  → Provider: ${agent.model?.provider ?? 'unset'}`);
			this.outputChannel.appendLine(`  → Model: ${agent.model?.id ?? 'unset'}`);
			this.outputChannel.appendLine(`  → Connection: ${agent.model?.connection?.constructor?.name ?? 'none'} (${(agent.model?.connection as any)?.endpoint ?? (agent.model?.connection as any)?.name ?? 'no name'})`);

			// Wrap the full pipeline in a top-level span (matches Python's CLI wrapper)
			const promptName = path.basename(filePath, '.prompty');
			const startTime = Date.now();
			const result = await traceSpan(promptName, async (emit) => {
				emit('type', 'vscode');
				emit('signature', 'prompty.vscode.execute');
				emit('description', 'Prompty VS Code Execution');
				emit('inputs', { prompt_path: filePath, inputs: {} });

				const executionResult = await execute(agent);
				emit('result', executionResult);
				return executionResult;
			});

			const elapsed = Date.now() - startTime;

			Tracer.remove('vscode-output');
			Tracer.remove('prompty-file');

			this.outputChannel.appendLine(`\n✓ Completed in ${elapsed}ms\n`);

			if (typeof result === 'string') {
				this.outputChannel.appendLine(result);
			} else {
				this.outputChannel.appendLine(JSON.stringify(result, null, 2));
			}

			// Auto-open the .tracy file in the trace viewer
			if (promptyTracer.lastTracePath) {
				const traceUri = Uri.file(promptyTracer.lastTracePath);
				this.outputChannel.appendLine(`  → Trace: ${promptyTracer.lastTracePath}`);
				try {
					await commands.executeCommand('vscode.openWith', traceUri, 'prompty.traceViewer');
				} catch {
					// Fall back to default text editor if custom editor isn't available
					try {
						await window.showTextDocument(traceUri, { preview: true, viewColumn: 2 });
					} catch {
						// Ignore — trace file is still on disk
					}
				}
			}
		} catch (error: unknown) {
			Tracer.remove('vscode-output');
			Tracer.remove('prompty-file');
			const message = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`\n✗ Error: ${message}`);
			window.showErrorMessage(`Prompty execution failed: ${message}`);
		}
	}

	/**
	 * Apply the sidebar's default connection to the agent if the frontmatter
	 * doesn't already specify a usable connection.
	 *
	 * Cascading precedence:
	 * 1. Frontmatter connection (explicit in .prompty file) — kept as-is
	 * 2. Default sidebar connection for the provider — applied here
	 * 3. Nothing — execution will fail at the executor level
	 */
	private async applyDefaultConnection(agent: PromptAgent): Promise<void> {
		if (!this.connectionStore) return;

		const conn = agent.model?.connection;

		// If the frontmatter already specifies a usable connection, respect it
		if (conn instanceof ReferenceConnection && conn.name) return;
		if (conn instanceof FoundryConnection && conn.endpoint) return;
		if (conn && 'apiKey' in conn && (conn as any).apiKey) return;

		// No usable connection — find the default from the sidebar
		// First try matching the explicit provider, then fall back to any default
		const provider = agent.model?.provider;
		let defaultProfile = provider
			? await this.connectionStore.getDefault(provider)
			: undefined;

		if (!defaultProfile) {
			// No provider specified or no match — use any default connection
			const profiles = await this.connectionStore.getProfiles();
			defaultProfile = profiles.find(p => p.isDefault) ?? profiles[0];
		}

		if (!defaultProfile) return;

		if (!agent.model) {
			agent.model = new Model();
		}

		// Set the provider to match the resolved connection
		agent.model.provider = defaultProfile.providerType;

		// Build the appropriate agentschema connection type
		if (defaultProfile.providerType === 'foundry') {
			const foundryProfile = defaultProfile as FoundryConnectionProfile;
			const foundryConn = new FoundryConnection();
			foundryConn.endpoint = foundryProfile.endpoint;
			if (foundryProfile.connectionName) {
				foundryConn.name = foundryProfile.connectionName;
			}
			agent.model.connection = foundryConn;
		} else {
			// For other providers, use reference to the pre-registered client
			const ref = new ReferenceConnection();
			ref.name = defaultProfile.name;
			agent.model.connection = ref;
		}
	}

	/**
	 * Bridge sidebar connections into the prompty runtime registry.
	 * This makes sidebar connections available as `kind: reference`
	 * connections in prompty files.
	 */
	private async bridgeConnections(): Promise<void> {
		if (!this.connectionStore || !this.connectionRegistry) {
			return;
		}

		try {
			clearConnections();
			const profiles = await this.connectionStore.getProfiles();

			for (const profile of profiles) {
				try {
					const secret = await this.connectionStore.getSecret(profile.id);
					const client = await this.connectionRegistry.createClient(profile, secret);

					// Register by connection name (for kind: reference matching)
					registerConnection(profile.name, client);

					// Also register by ID for programmatic access
					registerConnection(profile.id, client);

					// If this is a provider default, also register as the provider name
					if (profile.isDefault) {
						registerConnection(profile.providerType, client);
					}

					this.outputChannel.appendLine(`  ✓ Connection: ${profile.name}`);
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					this.outputChannel.appendLine(`  ⚠ Connection "${profile.name}": ${msg}`);
				}
			}

			// Also inject API keys into env vars for ${env:VAR} resolution
			await this.bridgeEnvVars(profiles);
		} catch {
			// Non-fatal — execution can still work with .env files
		}
	}

	/**
	 * For connections with API keys, set common env vars so ${env:VAR}
	 * references in prompty files resolve without a .env file.
	 */
	private async bridgeEnvVars(profiles: import('../connections/types').ConnectionProfile[]): Promise<void> {
		for (const profile of profiles) {
			// Foundry connections: inject project endpoint
			if (profile.providerType === 'foundry' && 'endpoint' in profile) {
				if (!process.env.AZURE_AI_PROJECT_ENDPOINT) {
					process.env.AZURE_AI_PROJECT_ENDPOINT = (profile as any).endpoint;
				}
				continue;
			}

			if (profile.authType !== 'key') continue;

			const secret = await this.connectionStore!.getSecret(profile.id);
			if (!secret) continue;

			// Set provider-specific env vars if not already set
			switch (profile.providerType) {
				case 'openai':
					if (!process.env.OPENAI_API_KEY) {
						process.env.OPENAI_API_KEY = secret;
					}
					break;
				case 'anthropic':
					if (!process.env.ANTHROPIC_API_KEY) {
						process.env.ANTHROPIC_API_KEY = secret;
					}
					break;
			}
		}
	}

	private loadEnvFile(promptyFilePath: string) {
		const workspaceFolders = workspace.workspaceFolders;
		if (!workspaceFolders) {
			return;
		}

		let searchDir = path.dirname(promptyFilePath);
		const workspaceRoot = workspaceFolders[0].uri.fsPath;

		while (searchDir.length >= workspaceRoot.length) {
			const envPath = path.join(searchDir, '.env');
			if (fs.existsSync(envPath)) {
				this.parseEnvFile(envPath);
				return;
			}
			const parent = path.dirname(searchDir);
			if (parent === searchDir) {
				break;
			}
			searchDir = parent;
		}
	}

	private parseEnvFile(envPath: string) {
		try {
			const content = fs.readFileSync(envPath, 'utf-8');
			for (const line of content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#')) {
					continue;
				}
				const eqIndex = trimmed.indexOf('=');
				if (eqIndex === -1) {
					continue;
				}
				const key = trimmed.slice(0, eqIndex).trim();
				let value = trimmed.slice(eqIndex + 1).trim();
				if ((value.startsWith('"') && value.endsWith('"')) ||
					(value.startsWith("'") && value.endsWith("'"))) {
					value = value.slice(1, -1);
				}
				if (!process.env[key]) {
					process.env[key] = value;
				}
			}
		} catch {
			// Ignore errors reading .env file
		}
	}

	dispose(): void {
		this.outputChannel.dispose();
	}
}