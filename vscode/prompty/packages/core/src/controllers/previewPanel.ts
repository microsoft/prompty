import { ExtensionContext, TextEditor, ViewColumn, WebviewPanel, window, workspace, Disposable, RelativePattern } from 'vscode';
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

		// Watch for changes to ${file:...} referenced files in the same directory.
		// Uses a broad glob so any JSON/YAML/text file change triggers a refresh.
		const dirPattern = new RelativePattern(
			path.dirname(filePath), '**/*.{json,yaml,yml,txt}',
		);
		const fileWatcher = workspace.createFileSystemWatcher(dirPattern);
		fileWatcher.onDidChange(() => this.scheduleUpdate(), null, this.disposables);
		fileWatcher.onDidCreate(() => this.scheduleUpdate(), null, this.disposables);
		fileWatcher.onDidDelete(() => this.scheduleUpdate(), null, this.disposables);
		this.disposables.push(fileWatcher);
	}

	private scheduleUpdate(): void {
		if (this.debounceTimer) {clearTimeout(this.debounceTimer);}
		this.debounceTimer = setTimeout(() => void this.update(), 300);
	}

	private async update(): Promise<void> {
		try {
			const agent = load(this.filePath);

			// Build sample inputs from default/example values
			const sampleInputs: Record<string, unknown> = {};
			if (agent.inputs) {
				for (const prop of agent.inputs) {
					if (!prop.name) {continue;}
					if (prop.kind === 'thread') {continue;} // skip thread inputs
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
				messages = [new Message({ role: "system", parts: [textPart(agent.instructions ?? "(no instructions)")] })];
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

		// Check if agent has a thread input
		const threadInput = agent.inputs?.find(p => p.kind === 'thread');

		const messageCards = messages.map((msg) => {
			const role = msg.role ?? 'unknown';
			const content = msg.text || '(empty)';
			const rendered = marked.parse(content, { async: false }) as string;
			return { role, html: `<div class="message ${escapeHtml(role)}">
				<div class="role-label">${escapeHtml(role)}</div>
				<div class="content">${rendered}</div>
			</div>` };
		});

		// Insert thread placeholder between last system/assistant and first user message
		let messagesHtml: string;
		if (threadInput) {
			const threadName = threadInput.name ?? 'thread';
			const placeholder = `<div class="thread-placeholder">
				<div class="thread-label">&#x2195; ${escapeHtml(threadName)}</div>
				<div class="thread-desc">Conversation history will be inserted here at runtime</div>
			</div>`;

			// Find insertion point: after last non-user message before the first user message
			let insertIdx = messageCards.findIndex(m => m.role === 'user');
			if (insertIdx < 0) {insertIdx = messageCards.length;}

			const parts = messageCards.map(m => m.html);
			parts.splice(insertIdx, 0, placeholder);
			messagesHtml = parts.join('\n');
		} else {
			messagesHtml = messageCards.map(m => m.html).join('\n');
		}

		// Build the wire-format JSON (what gets sent to the API)
		const wireMessages = messages.map((msg) => ({
			role: msg.role ?? 'unknown',
			content: msg.toTextContent(),
		}));
		const rawJson = escapeHtml(JSON.stringify(wireMessages, null, 2));
		const frontmatterHtml = buildFrontmatterHtml(agent);

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
		border-bottom: 1px solid var(--vscode-panel-border);
		margin-bottom: 12px;
		padding: 0;
	}
	.view-toggle button {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
		font-family: var(--vscode-font-family);
		padding: 6px 12px;
		cursor: pointer;
		font-weight: 400;
	}
	.view-toggle button:hover {
		color: var(--vscode-foreground);
	}
	.view-toggle button.active {
		border-bottom-color: var(--vscode-textLink-foreground);
		color: var(--vscode-textLink-foreground);
		font-weight: 600;
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
	.thread-placeholder {
		margin-bottom: 12px;
		border-radius: 6px;
		padding: 10px 12px;
		border: 1px dashed var(--vscode-descriptionForeground);
		text-align: center;
		opacity: 0.7;
	}
	.thread-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--vscode-descriptionForeground);
	}
	.thread-desc {
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		margin-top: 2px;
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
	.hidden { display: none; }
	.raw-json {
		background: var(--vscode-editor-background);
		border: 1px solid var(--vscode-panel-border);
		border-radius: 6px;
		padding: 16px;
		margin: 0;
		overflow: auto;
		font-family: 'Cascadia Code', 'Fira Code', monospace;
		font-size: 12px;
		color: var(--vscode-foreground);
		line-height: 1.4;
		white-space: pre-wrap;
		word-break: break-all;
		tab-size: 2;
	}
	.fm-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 8px;
		margin-bottom: 12px;
	}
	.fm-card, .fm-section {
		border: 1px solid var(--vscode-panel-border);
		border-radius: 6px;
		background: color-mix(in srgb, var(--vscode-editorWidget-background) 70%, transparent);
	}
	.fm-card {
		padding: 10px 12px;
	}
	.fm-card-label, .fm-section h3 {
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}
	.fm-card-label {
		margin-bottom: 4px;
	}
	.fm-card-value {
		font-size: 13px;
		word-break: break-word;
	}
	.fm-section {
		margin-bottom: 12px;
		padding: 10px 12px;
	}
	.fm-section h3 {
		margin: 0 0 8px 0;
	}
	.fm-description {
		margin: 0 0 12px 0;
		color: var(--vscode-descriptionForeground);
	}
	.fm-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.fm-table th {
		text-align: left;
		color: var(--vscode-descriptionForeground);
		font-weight: 600;
		border-bottom: 1px solid var(--vscode-panel-border);
		padding: 4px 6px;
	}
	.fm-table td {
		border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
		padding: 5px 6px;
		vertical-align: top;
		word-break: break-word;
	}
	.fm-table tr:last-child td { border-bottom: 0; }
	.fm-chip {
		display: inline-block;
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		border-radius: 3px;
		padding: 1px 6px;
		margin: 0 4px 4px 0;
		font-size: 11px;
	}
	.fm-property-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fm-property {
		border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
		border-radius: 5px;
		padding: 8px 10px;
		background: color-mix(in srgb, var(--vscode-editor-background) 55%, transparent);
	}
	.fm-property-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 5px;
	}
	.fm-property-name {
		font-weight: 600;
		font-size: 13px;
	}
	.fm-kind, .fm-required, .fm-optional {
		border-radius: 3px;
		padding: 1px 6px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
	}
	.fm-kind {
		background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
		color: var(--vscode-textLink-foreground);
	}
	.fm-required {
		background: color-mix(in srgb, var(--vscode-errorForeground) 14%, transparent);
		color: var(--vscode-errorForeground);
	}
	.fm-optional {
		background: color-mix(in srgb, var(--vscode-descriptionForeground) 14%, transparent);
		color: var(--vscode-descriptionForeground);
	}
	.fm-property-desc {
		color: var(--vscode-descriptionForeground);
		margin-bottom: 6px;
	}
	.fm-property-value {
		background: var(--vscode-textCodeBlock-background);
		border-radius: 4px;
		font-family: 'Cascadia Code', 'Fira Code', monospace;
		font-size: 12px;
		padding: 5px 7px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.fm-empty {
		color: var(--vscode-descriptionForeground);
		font-style: italic;
	}
	.fm-raw summary {
		cursor: pointer;
		color: var(--vscode-textLink-foreground);
		margin-bottom: 8px;
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
		<button id="btn-rendered" class="active">Rendered</button>
		<button id="btn-raw">Raw JSON</button>
		<button id="btn-frontmatter">Frontmatter</button>
	</div>
	<div id="view-rendered">${messagesHtml}</div>
	<div id="view-raw" class="hidden"><pre class="raw-json">${rawJson}</pre></div>
	<div id="view-frontmatter" class="hidden">${frontmatterHtml}</div>
	<script nonce="${nonce}">
		function showView(view) {
			document.getElementById('view-rendered').className = view === 'rendered' ? '' : 'hidden';
			document.getElementById('view-frontmatter').className = view === 'frontmatter' ? '' : 'hidden';
			document.getElementById('view-raw').className = view === 'raw' ? '' : 'hidden';
			document.getElementById('btn-rendered').className = view === 'rendered' ? 'active' : '';
			document.getElementById('btn-frontmatter').className = view === 'frontmatter' ? 'active' : '';
			document.getElementById('btn-raw').className = view === 'raw' ? 'active' : '';
		}
		document.getElementById('btn-rendered').addEventListener('click', function() { showView('rendered'); });
		document.getElementById('btn-raw').addEventListener('click', function() { showView('raw'); });
		document.getElementById('btn-frontmatter').addEventListener('click', function() { showView('frontmatter'); });
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
		if (this.debounceTimer) {clearTimeout(this.debounceTimer);}
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

function buildFrontmatterHtml(agent: Prompty): string {
	const model = agent.model;
	const connection = toRecord(model?.connection);
	const template = toRecord(agent.template);
	const format = toRecord(template.format);
	const parser = toRecord(template.parser);
	const metadata = agent.metadata ?? {};

	const cards = [
		frontmatterCard('Name', agent.displayName || agent.name || 'unnamed'),
		frontmatterCard('Model', [model?.provider, model?.id].filter(Boolean).join(' - ') || 'not configured'),
		frontmatterCard('API', model?.apiType ?? 'chat'),
		frontmatterCard('Template', [format.kind, parser.kind].filter(Boolean).join(' -> ') || 'default'),
		frontmatterCard('Connection', describeConnection(connection)),
	];

	const sections = [
		agent.description ? frontmatterSection('Description', `<p class="fm-description">${escapeHtml(agent.description)}</p>`) : '',
		propertySection('Inputs', agent.inputs ?? []),
		propertySection('Outputs', agent.outputs ?? []),
		keyValueSection('Model options', optionEntries(model?.options)),
		toolsSection(agent.tools ?? []),
		metadataSection(metadata),
		rawFrontmatterSection(agent),
	].filter(Boolean).join('\n');

	return `<div class="fm-grid">${cards.join('\n')}</div>${sections}`;
}

function frontmatterCard(label: string, value: unknown): string {
	return `<div class="fm-card">
		<div class="fm-card-label">${escapeHtml(label)}</div>
		<div class="fm-card-value">${escapeHtml(formatValue(value, 120))}</div>
	</div>`;
}

function frontmatterSection(title: string, body: string): string {
	return `<section class="fm-section">
		<h3>${escapeHtml(title)}</h3>
		${body}
	</section>`;
}

function propertySection(title: string, properties: {
	name?: string;
	kind?: string;
	required?: boolean;
	default?: unknown;
	example?: unknown;
	description?: string;
	enumValues?: unknown[];
}[]): string {
	if (properties.length === 0) {
		return '';
	}
	const cards = properties.map((prop) => {
		const value = prop.default !== undefined ? prop.default : prop.example;
		const enumHtml = prop.enumValues && prop.enumValues.length > 0
			? `<div>${prop.enumValues.map(item => `<span class="fm-chip">${escapeHtml(formatValue(item, 40))}</span>`).join('')}</div>`
			: '';
		const valueHtml = value !== undefined
			? `<div class="fm-property-value">${escapeHtml(formatValue(value, 300))}</div>`
			: '';
		return `<div class="fm-property">
			<div class="fm-property-head">
				<span class="fm-property-name">${escapeHtml(prop.name || '(unnamed)')}</span>
				<span class="fm-kind">${escapeHtml(prop.kind || 'unknown')}</span>
				<span class="${prop.required ? 'fm-required' : 'fm-optional'}">${prop.required ? 'required' : 'optional'}</span>
			</div>
			${prop.description ? `<div class="fm-property-desc">${escapeHtml(prop.description)}</div>` : ''}
			${valueHtml}
			${enumHtml}
		</div>`;
	}).join('\n');

	return frontmatterSection(title, `<div class="fm-property-list">${cards}</div>`);
}

function keyValueSection(title: string, entries: [string, unknown][]): string {
	if (entries.length === 0) {
		return '';
	}
	const rows = entries.map(([key, value]) => `<tr>
		<td>${escapeHtml(key)}</td>
		<td>${escapeHtml(formatValue(value, 140))}</td>
	</tr>`).join('\n');
	return frontmatterSection(title, `<table class="fm-table">
		<thead><tr><th>Setting</th><th>Value</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>`);
}

function toolsSection(tools: { name?: string; kind?: string; description?: string; save?: () => Record<string, unknown> }[]): string {
	if (tools.length === 0) {
		return '';
	}
	const rows = tools.map((tool) => {
		const saved = saveObject(tool);
		const parameters = toRecord(saved.parameters);
		const parameterNames = Object.keys(toRecord(parameters.properties));
		const details = parameterNames.length > 0
			? parameterNames.join(', ')
			: Object.keys(saved).filter(k => !['name', 'kind', 'description'].includes(k)).join(', ');
		return `<tr>
			<td>${escapeHtml(tool.name || '(unnamed)')}</td>
			<td>${escapeHtml(tool.kind || 'unknown')}</td>
			<td>${escapeHtml(tool.description ?? '')}</td>
			<td>${escapeHtml(details || '')}</td>
		</tr>`;
	}).join('\n');
	return frontmatterSection('Tools', `<table class="fm-table">
		<thead><tr><th>Name</th><th>Kind</th><th>Description</th><th>Details</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>`);
}

function metadataSection(metadata: Record<string, unknown>): string {
	const entries = Object.entries(metadata);
	if (entries.length === 0) {
		return '';
	}
	const chipKeys = new Set(['authors', 'tags']);
	const chips = entries
		.filter(([key, value]) => chipKeys.has(key) && Array.isArray(value))
		.flatMap(([key, value]) => (value as unknown[]).map(item => `<span class="fm-chip">${escapeHtml(key)}: ${escapeHtml(String(item))}</span>`))
		.join('');
	const rows = entries
		.filter(([key]) => !chipKeys.has(key))
		.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(formatValue(value, 140))}</td></tr>`)
		.join('\n');
	const table = rows ? `<table class="fm-table"><tbody>${rows}</tbody></table>` : '';
	return frontmatterSection('Metadata', chips || table ? `${chips}${table}` : '<div class="fm-empty">No metadata</div>');
}

function rawFrontmatterSection(agent: Prompty): string {
	const saved = redactSecrets(saveObject(agent));
	return frontmatterSection('Raw frontmatter', `<details class="fm-raw">
		<summary>Show normalized frontmatter JSON</summary>
		<pre class="raw-json">${escapeHtml(JSON.stringify(saved, null, 2))}</pre>
	</details>`);
}

function optionEntries(options: unknown): [string, unknown][] {
	const saved = saveObject(options);
	const additionalProperties = toRecord(saved.additionalProperties);
	delete saved.additionalProperties;
	return [
		...Object.entries(saved),
		...Object.entries(additionalProperties).map(([key, value]) => [`additionalProperties.${key}`, value] as [string, unknown]),
	];
}

function describeConnection(connection: Record<string, unknown>): string {
	if (Object.keys(connection).length === 0) {
		return 'not configured';
	}
	const parts = [connection.kind, connection.name, connection.endpoint, connection.target]
		.filter((value): value is string => typeof value === 'string' && value.length > 0);
	return parts.join(' - ') || 'configured';
}

function formatValue(value: unknown, max: number): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value === 'string') {
		return truncate(value, max);
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return truncate(JSON.stringify(redactSecrets(value)), max);
}

function saveObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') {
		return {};
	}
	const maybeSave = (value as { save?: () => Record<string, unknown> }).save;
	if (typeof maybeSave === 'function') {
		return maybeSave.call(value);
	}
	return { ...(value as Record<string, unknown>) };
}

function toRecord(value: unknown): Record<string, unknown> {
	return saveObject(value);
}

function redactSecrets(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSecrets);
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		result[key] = isSensitiveKey(key) ? '[redacted]' : redactSecrets(item);
	}
	return result;
}

function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return normalized.includes('apikey')
		|| normalized.includes('api_key')
		|| normalized.includes('secret')
		|| normalized.includes('password')
		|| normalized.includes('token')
		|| normalized.includes('credential');
}
