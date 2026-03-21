import { ExtensionContext, Uri, Disposable, window, workspace } from 'vscode';
import { execute } from 'prompty';
import * as path from 'path';
import * as fs from 'fs';

export class PromptyController implements Disposable {
	private outputChannel = window.createOutputChannel('Prompty');

	constructor(private context: ExtensionContext) {}

	public async run(uri: Uri) {
		const filePath = uri.fsPath;
		const fileName = path.basename(filePath);

		this.outputChannel.show(true);
		this.outputChannel.appendLine(`\n${'─'.repeat(60)}`);
		this.outputChannel.appendLine(`Running: ${fileName}`);
		this.outputChannel.appendLine(`${'─'.repeat(60)}`);

		try {
			this.loadEnvFile(filePath);

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
				// Strip surrounding quotes
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