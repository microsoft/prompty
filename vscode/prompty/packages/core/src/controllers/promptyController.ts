import { ExtensionContext, Uri, Disposable, window, workspace } from 'vscode';
import { execute, registerConnection, clearConnections } from 'prompty';
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

		try {
			this.loadEnvFile(filePath);
			await this.bridgeConnections();

			const startTime = Date.now();
			const result = await execute(filePath);
			const elapsed = Date.now() - startTime;

			this.outputChannel.appendLine(`\n✓ Completed in ${elapsed}ms\n`);

			if (typeof result === 'string') {
				this.outputChannel.appendLine(result);
			} else {
				this.outputChannel.appendLine(JSON.stringify(result, null, 2));
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`\n✗ Error: ${message}`);
			window.showErrorMessage(`Prompty execution failed: ${message}`);
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
			if (profile.authType !== 'api-key') continue;

			const secret = await this.connectionStore!.getSecret(profile.id);
			if (!secret) continue;

			// Set provider-specific env vars if not already set
			switch (profile.providerType) {
				case 'openai':
					if (!process.env.OPENAI_API_KEY) {
						process.env.OPENAI_API_KEY = secret;
					}
					break;
				case 'azure-openai':
					if (!process.env.AZURE_OPENAI_API_KEY) {
						process.env.AZURE_OPENAI_API_KEY = secret;
					}
					if ('endpoint' in profile && !process.env.AZURE_OPENAI_ENDPOINT) {
						process.env.AZURE_OPENAI_ENDPOINT = (profile as any).endpoint;
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