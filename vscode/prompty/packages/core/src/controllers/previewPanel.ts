import { ExtensionContext, TextDocument, TextEditor, ViewColumn, WebviewPanel, window, workspace, Disposable, Uri } from 'vscode';
import { load, prepare, Message, text as textPart } from '@prompty/core';
import type { Prompty } from '@prompty/core';
import { marked } from 'marked';
import * as path from 'path';
import { getNonce } from '../utils/nonce';

/**
 * Side-by-side preview panel for .prompty files.
 *
 * Loads the agent, renders with default/example inputs, and displays the
 * resulting messages with role-colored styling. Updates live as the user
 * edits the .prompty file.
 */
export class PreviewPanel implements Disposable {
	private static panels = new Map<string, PreviewPanel>();
	private panel: WebviewPanel;
	private filePath: string;
	private disposables: Disposable[] = [];
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;

	public static toggle(context: ExtensionContext, editor: TextEditor): void {
		const filePath = editor.document.uri.fsPath;

		const existing = PreviewPanel.panels.get(filePath);
		if (existing) {
			existing.panel.reveal();
			return;
		}

		const panel = new PreviewPanel(context, filePath);
		PreviewPanel.panels.set(filePath, panel);
		panel.update();
	}

	private constructor(context: ExtensionContext, filePath: string) {
		this.filePath = filePath;
		const fileName = path.basename(filePath);

		this.panel = window.createWebviewPanel(
			'prompty.preview',
			`Preview: ${fileName}`,
			ViewColumn.Beside,
			{ enableScripts: true, retainContextWhenHidden: false },
		);

		this.panel.onDidDispose(() => {
			PreviewPanel.panels.delete(this.filePath);
			this.dispose();
		}, null, this.disposables);

		// Live update on edit
		workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.fsPath === this.filePath) {
				this.scheduleUpdate();
			}
		}, null, this.disposables);

		// Also update when switching back to this editor
		window.onDidChangeActiveTextEditor((editor) => {
			if (editor?.document.uri.fsPath === this.filePath) {
				this.update();
			}
		}, null, this.disposables);
	}

	private scheduleUpdate(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => void this.update(), 300);
	}

	private async update(): Promise<void> {
		try {
			const agent = load(this.filePath);

			// Build sample inputs from default/example values
			const sampleInputs: Record<string, unknown> = {};
			if (agent.inputs) {
				for (const prop of agent.inputs) {
					if (!prop.name) continue;
					if (prop.kind === 'thread') continue; // skip thread inputs
					if (prop.example !== undefined) {
						sampleInputs[prop.name] = prop.example;
					} else if (prop.default !== undefined) {
						sampleInputs[prop.name] = prop.default;
					}
				}
			}

			let messages: Message[];
			try {
				messages = await prepare(agent, sampleInputs);
			} catch {
				// If prepare fails (missing renderer, etc.), show raw instructions
				messages = [new Message('system', [textPart(agent.instructions ?? '(no instructions)')])];
			}

			this.panel.webview.html = this.getHtml(agent, messages, sampleInputs);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.panel.webview.html = this.getErrorHtml(msg);
		}
	}

	private getHtml(agent: Prompty, messages: Message[], inputs: Record<string, unknown>): string {
		const nonce = getNonce();

		const modelInfo = agent.model
			? `${agent.model.id ?? 'unknown'}${agent.model.provider ? ` · ${agent.model.provider}` : ''}`
			: 'no model';

		const inputSummary = Object.keys(inputs).length > 0
			? Object.entries(inputs).map(([k, v]) => `<span class="input-tag">${escapeHtml(k)}: ${escapeHtml(truncate(String(v), 40))}</span>`).join(' ')
			: '<span class="muted">no inputs</span>';

		const messagesHtml = messages.map((msg) => {
			const role = msg.role ?? 'unknown';
			const content = msg.text || '(empty)';
			const rendered = marked.parse(content, { async: false }) as string;
			return `<div class="message ${escapeHtml(role)}">
				<div class="role-label">${escapeHtml(role)}</div>
				<div class="content">${rendered}</div>
			</div>`;
		}).join('\n');

		// Build the wire-format JSON (what gets sent to the API)
		const wireMessages = messages.map((msg) => ({
			role: msg.role ?? 'unknown',
			content: msg.toTextContent(),
		}));
		const rawJson = escapeHtml(JSON.stringify(wireMessages, null, 2));

		return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
	body {
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
		padding: 12px 16px;
		line-height: 1.5;
	}
	.header {
		border-bottom: 1px solid var(--vscode-panel-border);
		padding-bottom: 8px;
		margin-bottom: 12px;
	}
	.header h2 {
		margin: 0 0 4px 0;
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--vscode-descriptionForeground);
	}
	.model-info {
		font-size: 12px;
		color: var(--vscode-descriptionForeground);
	}
	.inputs-bar {
		margin: 8px 0 12px 0;
		font-size: 12px;
	}
	.input-tag {
		display: inline-block;
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		padding: 1px 6px;
		border-radius: 3px;
		margin-right: 4px;
		font-size: 11px;
	}
	.muted { color: var(--vscode-descriptionForeground); }
	.view-toggle {
		display: flex;
		gap: 0;
		margin-bottom: 12px;
	}
	.view-toggle button {
		padding: 4px 12px;
		font-size: 12px;
		font-family: var(--vscode-font-family);
		border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
		cursor: pointer;
		background: var(--vscode-button-secondaryBackground);
		color: var(--vscode-button-secondaryForeground);
	}
	.view-toggle button:first-child { border-radius: 3px 0 0 3px; }
	.view-toggle button:last-child { border-radius: 0 3px 3px 0; border-left: none; }
	.view-toggle button.active {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: var(--vscode-button-background);
	}
	.message {
		margin-bottom: 12px;
		border-radius: 6px;
		padding: 8px 12px;
		border-left: 3px solid transparent;
	}
	.message.system {
		background: color-mix(in srgb, var(--vscode-terminal-ansiMagenta) 10%, transparent);
		border-left-color: var(--vscode-terminal-ansiMagenta);
	}
	.message.user {
		background: color-mix(in srgb, var(--vscode-terminal-ansiBlue) 10%, transparent);
		border-left-color: var(--vscode-terminal-ansiBlue);
	}
	.message.assistant {
		background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 10%, transparent);
		border-left-color: var(--vscode-terminal-ansiGreen);
	}
	.message.tool {
		background: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 10%, transparent);
		border-left-color: var(--vscode-terminal-ansiYellow);
	}
	.role-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 4px;
		opacity: 0.8;
	}
	.content {
		line-height: 1.6;
		word-wrap: break-word;
	}
	.content p { margin: 0.4em 0; }
	.content h1, .content h2, .content h3, .content h4 {
		margin: 0.6em 0 0.3em;
		font-weight: 600;
	}
	.content h1 { font-size: 1.3em; }
	.content h2 { font-size: 1.15em; }
	.content h3 { font-size: 1.05em; }
	.content ul, .content ol { margin: 0.3em 0; padding-left: 1.5em; }
	.content code {
		background: var(--vscode-textCodeBlock-background);
		padding: 1px 4px;
		border-radius: 3px;
		font-size: 0.9em;
	}
	.content pre {
		background: var(--vscode-textCodeBlock-background);
		padding: 8px;
		border-radius: 4px;
		overflow-x: auto;
	}
	.content pre code { background: none; padding: 0; }
	.content blockquote {
		border-left: 3px solid var(--vscode-descriptionForeground);
		margin: 0.4em 0;
		padding-left: 10px;
		opacity: 0.85;
	}
	.raw-json {
		background: var(--vscode-textCodeBlock-background);
		padding: 12px;
		border-radius: 6px;
		overflow-x: auto;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--vscode-editor-font-size);
		line-height: 1.4;
		white-space: pre;
		tab-size: 2;
	}
</style>
</head>
<body>
	<div class="header">
		<h2>Prompt Preview</h2>
		<div class="model-info">Model: ${escapeHtml(modelInfo)}</div>
	</div>
	<div class="inputs-bar">Inputs: ${inputSummary}</div>
	<div class="view-toggle">
		<button id="btn-rendered" class="active" onclick="showView('rendered')">Rendered</button>
		<button id="btn-raw" onclick="showView('raw')">Raw JSON</button>
	</div>
	<div id="view-rendered">${messagesHtml}</div>
	<div id="view-raw" style="display:none"><pre class="raw-json">${rawJson}</pre></div>
	<script nonce="${nonce}">
		function showView(view) {
			document.getElementById('view-rendered').style.display = view === 'rendered' ? '' : 'none';
			document.getElementById('view-raw').style.display = view === 'raw' ? '' : 'none';
			document.getElementById('btn-rendered').className = view === 'rendered' ? 'active' : '';
			document.getElementById('btn-raw').className = view === 'raw' ? 'active' : '';
		}
	</script>
</body>
</html>`;
	}

	private getErrorHtml(message: string): string {
		const nonce = getNonce();
		return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">
	body {
		font-family: var(--vscode-font-family);
		color: var(--vscode-foreground);
		padding: 20px;
	}
	.error {
		color: var(--vscode-errorForeground);
		background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
		padding: 12px;
		border-radius: 6px;
		white-space: pre-wrap;
	}
</style>
</head>
<body>
	<div class="error">${escapeHtml(message)}</div>
</body>
</html>`;
	}

	dispose(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) + '…' : s;
}
