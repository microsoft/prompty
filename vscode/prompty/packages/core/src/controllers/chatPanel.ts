import { ExtensionContext, ViewColumn, WebviewPanel, window, Uri, commands } from 'vscode';
import {
	turn,
	Tracer, PromptyTracer,
} from '@prompty/core';
import type { PromptAgent } from '@prompty/core';
import '@prompty/openai';
import '@prompty/foundry';
import '@prompty/anthropic';
import { marked } from 'marked';
import * as path from 'path';
import { getNonce } from '../utils/nonce';
import { ConnectionStore } from '../connections/store';
import { ConnectionProviderRegistry } from '../connections/registry';

/** Render markdown to HTML for the chat webview. Detects image URLs and embeds them. */
function renderMarkdown(content: string): string {
	const formattedJson = tryFormatJsonString(content);
	if (formattedJson) {
		return renderJsonBlock(formattedJson);
	}

	// If the content looks like an image URL (from apiType: image), embed it
	const imageUrlPattern = /^https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|svg)(\?\S*)?$/i;
	const lines = content.split('\n');
	const transformed = lines.map(line => {
		const trimmed = line.trim();
		if (imageUrlPattern.test(trimmed)) {
			return `![Generated image](${trimmed})`;
		}
		return line;
	}).join('\n');

	return marked.parse(transformed, { async: false }) as string;
}

function escapeHtml(content: string): string {
	return content
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** Check if a value is an async iterable (i.e. a streaming response). */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return value != null && typeof value === 'object' && Symbol.asyncIterator in value;
}

function hasStructuredOutputs(agent: PromptAgent): boolean {
	if (agent.outputs?.length) {return true;}
	const record = agent as unknown as Record<string, unknown>;
	const outputSchema = record.outputSchema;
	if (!outputSchema || typeof outputSchema !== 'object') {return false;}
	return Object.keys(outputSchema).length > 0;
}

function tryFormatJsonString(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
		return undefined;
	}
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return undefined;
	}
}

function colorizeJson(json: string): string {
	return escapeHtml(json).replace(
		/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\bnull\b/g,
		(match, key, stringValue, numberValue, booleanValue) => {
			if (key) {return `<span class="json-key">${key}</span>`;}
			if (stringValue) {return `<span class="json-string">${stringValue}</span>`;}
			if (numberValue) {return `<span class="json-number">${numberValue}</span>`;}
			if (booleanValue) {return `<span class="json-boolean">${booleanValue}</span>`;}
			return `<span class="json-null">${match}</span>`;
		}
	);
}

function renderJsonBlock(json: string): string {
	return `<pre class="json-block"><code class="language-json">${colorizeJson(json)}</code></pre>`;
}

function formatAssistantResult(result: unknown, structured: boolean): { text: string; html: string } {
	const text = typeof result === 'string'
		? structured ? tryFormatJsonString(result) ?? result : result
		: JSON.stringify(result, null, 2);
	const html = renderMarkdown(text);
	return { text, html };
}

function toChatMessages(value: unknown): ChatMessage[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const messages: ChatMessage[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') {continue;}
		const record = item as Record<string, unknown>;
		const role = record.role;
		if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {continue;}
		const content = record.content;
		messages.push({
			role,
			content: typeof content === 'string' ? content : JSON.stringify(content ?? '', null, 2),
		});
	}
	return messages;
}

/**
 * Chat message for the webview.
 */
interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCall?: { name: string; arguments: string };
	toolCallId?: string;
}

/**
 * Interactive chat panel for prompty files with thread inputs.
 *
 * Opens a webview with a chat UI. Each user message triggers a full
 * prepare→invoke cycle with the accumulated conversation history
 * passed as the thread input.
 */
export class ChatPanel {
	private static panels = new Map<string, ChatPanel>();
	private panel: WebviewPanel;
	private agent: PromptAgent;
	private threadInputName: string;
	private sampleInputs: Record<string, unknown>;
	private conversation: ChatMessage[] = [];
	private disposed = false;
	private promptyTracer: PromptyTracer;
	private hasTools: boolean;
	private structuredOutputs: boolean;
	private sessionSpan: ReturnType<typeof Tracer.start> | undefined;
	private turnCount = 0;
	private sentInitialConversation = false;

	public static async open(
		context: ExtensionContext,
		filePath: string,
		agent: PromptAgent,
		sampleInputs: Record<string, unknown>,
		threadInputName: string,
		connectionStore?: ConnectionStore,
		connectionRegistry?: ConnectionProviderRegistry,
		bridgeConnections?: () => Promise<void>,
	): Promise<ChatPanel> {
		const existing = ChatPanel.panels.get(filePath);
		if (existing && !existing.disposed) {
			existing.dispose();
		}

		const fileName = path.basename(filePath, '.prompty');
		const workspaceRoot = (await import('vscode')).workspace.workspaceFolders?.[0]?.uri.fsPath
			?? path.dirname(filePath);
		const runsDir = path.join(workspaceRoot, '.runs');

		const chatPanel = new ChatPanel(
			context, filePath, fileName, agent, sampleInputs,
			threadInputName, runsDir, bridgeConnections,
		);
		ChatPanel.panels.set(filePath, chatPanel);
		return chatPanel;
	}

	private constructor(
		private context: ExtensionContext,
		private filePath: string,
		private fileName: string,
		agent: PromptAgent,
		sampleInputs: Record<string, unknown>,
		threadInputName: string,
		private runsDir: string,
		private bridgeConnections?: () => Promise<void>,
	) {
		this.agent = agent;
		this.threadInputName = threadInputName;
		this.sampleInputs = { ...sampleInputs };
		this.hasTools = (agent.tools?.length ?? 0) > 0;
		this.structuredOutputs = hasStructuredOutputs(agent);
		this.conversation = toChatMessages(this.sampleInputs[this.threadInputName]);

		// Enable streaming for the chat panel — better UX for interactive use.
		// Only applies to non-agent mode (turn() consumes streams internally).
		if (!this.hasTools && this.agent.model?.options) {
			const opts = this.agent.model.options;
			if (!opts.additionalProperties) {opts.additionalProperties = {};}
			if (opts.additionalProperties.stream === undefined) {
				opts.additionalProperties.stream = true;
			}
		}

		this.promptyTracer = new PromptyTracer({ outputDir: runsDir });
		Tracer.add('prompty-chat', this.promptyTracer.factory);

		// Start a single root span for the entire chat session.
		// All user turns become child spans. The .tracy file is written
		// when endChat() calls sessionSpan.end().
		this.sessionSpan = Tracer.start(`chatSession:${this.fileName}`);
		this.sessionSpan('signature', 'prompty.chatSession');
		this.sessionSpan('description', `Interactive chat session: ${this.fileName}`);
		this.sessionSpan('inputs', { agent: this.agent.name, description: this.agent.description, threadInput: this.threadInputName });

		this.panel = window.createWebviewPanel(
			'prompty.chat',
			`Chat: ${this.fileName}`,
			ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [Uri.joinPath(context.extensionUri)],
			},
		);

		this.panel.webview.html = this.getHtml();

		this.panel.webview.onDidReceiveMessage(async (msg) => {
			switch (msg.command) {
				case 'ready':
					// Send system prompt context on load
					this.sendSystemContext();
					break;
				case 'sendMessage':
					await this.handleUserMessage(msg.text);
					break;
				case 'endChat':
					await this.endChat();
					break;
				case 'toolCallResponse':
					// Handled via promise resolver in handleToolCall
					break;
			}
		});

		this.panel.onDidDispose(() => {
			this.dispose();
		});
	}

	private dispose(): void {
		if (this.disposed) {return;}
		this.disposed = true;
		if (this.sessionSpan) {
			this.sessionSpan('result', {
				turns: this.turnCount,
				conversation: this.conversation.map(m => ({ role: m.role, content: m.content })),
			});
			this.sessionSpan.end();
			this.sessionSpan = undefined;
		}
		Tracer.remove('prompty-chat');
		ChatPanel.panels.delete(this.filePath);
		this.panel.dispose();
	}

	/**
	 * Show the system prompt so the user sees the conversation context.
	 */
	private sendSystemContext(): void {
		// Do a dry render to show the system message
		const systemContent = this.agent.instructions ?? '';
		if (systemContent) {
			this.postMessage({
				command: 'addMessage',
				role: 'system',
				content: systemContent.trim().slice(0, 200) + (systemContent.length > 200 ? '…' : ''),
				collapsed: true,
			});
		}
		if (!this.sentInitialConversation) {
			for (const message of this.conversation) {
				this.postMessage({
					command: 'addMessage',
					role: message.role,
					content: message.role === 'assistant' ? renderMarkdown(message.content) : message.content,
					isHtml: message.role === 'assistant',
				});
			}
			this.sentInitialConversation = true;
		}
		this.postMessage({ command: 'setReady' });
	}

	/**
	 * Handle a user message: add to conversation, run the agent, display response.
	 * Streams tokens into the webview with debounced DOM updates when possible.
	 */
	private async handleUserMessage(text: string): Promise<void> {
		// Show user message in chat (user messages rendered as plain text for safety)
		this.postMessage({ command: 'addMessage', role: 'user', content: text });
		this.postMessage({ command: 'setLoading', loading: true });

		// Add user message to conversation thread
		this.conversation.push({ role: 'user', content: text });
		this.turnCount++;

		try {
			// Build thread messages for the prepare() call
			const threadMessages = this.conversation.map(m => ({
				role: m.role,
				content: m.content,
			}));

			// Set thread input to current conversation
			const inputs = {
				...this.sampleInputs,
				[this.threadInputName]: threadMessages,
			};

			// Build tool handlers if this agent has tools
			const tools = this.hasTools ? this.buildToolFunctions() : undefined;
			if (this.hasTools) {
				this.postMessage({ command: 'setLoadingText', text: 'Running agent' });
			}

			// One conversational turn: prepare + run (or agent loop with tools)
			const result = await turn(this.agent, inputs, {
				tools,
				turn: this.turnCount,
			});

			if (isAsyncIterable(result)) {
				// Streaming path: debounced chunk delivery
				await this.handleStreamingResponse(result);
			} else {
				const formatted = formatAssistantResult(result, this.structuredOutputs);
				const assistantContent = formatted.text;
				this.conversation.push({ role: 'assistant', content: assistantContent });
				this.postMessage({
					command: 'addMessage',
					role: 'assistant',
					content: formatted.html,
					isHtml: true,
				});
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.postMessage({ command: 'addError', content: message });
		} finally {
			this.postMessage({ command: 'setLoading', loading: false });
		}
	}

	/**
	 * Stream an async iterable response into the webview with debounced updates.
	 *
	 * Accumulates text chunks and re-renders markdown at most every 50ms
	 * to prevent webview jitter while keeping the UI responsive.
	 */
	private async handleStreamingResponse(stream: AsyncIterable<unknown>): Promise<void> {
		const DEBOUNCE_MS = 50;
		let accumulated = '';
		let flushTimer: ReturnType<typeof setTimeout> | undefined;
		let needsFlush = false;

		// Tell the webview to create the streaming message container
		this.postMessage({ command: 'startStream', role: 'assistant' });

		const flush = () => {
			flushTimer = undefined;
			needsFlush = false;
			const html = this.structuredOutputs
				? formatAssistantResult(accumulated, true).html
				: renderMarkdown(accumulated);
			this.postMessage({
				command: 'streamChunk',
				html,
			});
		};

		// run() already processed the stream — iterate text chunks directly
		for await (const chunk of stream) {
			if (typeof chunk === 'string') {
				accumulated += chunk;
				needsFlush = true;
				// Debounce: schedule a flush if one isn't pending
				if (!flushTimer) {
					flushTimer = setTimeout(flush, DEBOUNCE_MS);
				}
			}
		}

		// Final flush — clear any pending timer and send the complete content
		if (flushTimer) {
			clearTimeout(flushTimer);
		}
		if (needsFlush || accumulated) {
			const finalMarkdown = this.structuredOutputs
				? formatAssistantResult(accumulated, true).html
				: accumulated;
			this.postMessage({
				command: 'streamChunk',
				html: this.structuredOutputs ? finalMarkdown : renderMarkdown(finalMarkdown),
			});
		}

		// Finalize the stream
		this.postMessage({ command: 'streamEnd' });
		this.conversation.push({
			role: 'assistant',
			content: this.structuredOutputs ? formatAssistantResult(accumulated, true).text : accumulated,
		});
	}

	/**
	 * Build mock tool functions that prompt the user via the webview.
	 */
	private buildToolFunctions(): Record<string, (...args: unknown[]) => unknown> {
		const tools: Record<string, (...args: unknown[]) => unknown> = {};

		for (const tool of (this.agent.tools ?? [])) {
			if (tool.kind !== 'function') {continue;}
			const toolName = tool.name;
			tools[toolName] = async (args: unknown) => {
				const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);

				// Show tool call in chat and wait for user response
				return new Promise<string>((resolve) => {
					const callId = `tc_${Date.now()}`;

					// Show tool call in the webview
					this.postMessage({
						command: 'showToolCall',
						callId,
						toolName,
						arguments: argsStr,
					});

					// Listen for the response
					const handler = this.panel.webview.onDidReceiveMessage((msg) => {
						if (msg.command === 'toolCallResponse' && msg.callId === callId) {
							handler.dispose();
							// Update loading to show we're sending the result back
							this.postMessage({ command: 'setLoadingText', text: `Processing ${toolName} result` });
							resolve(msg.response);
						}
					});
				});
			};
		}

		return tools;
	}

	/**
	 * End the chat session: close the root span, flush the tracer, and open the .tracy file.
	 */
	private async endChat(): Promise<void> {
		// Close the session span — this finalizes the root frame and writes the .tracy file
		if (this.sessionSpan) {
			this.sessionSpan('result', {
				turns: this.turnCount,
				conversation: this.conversation.map(m => ({ role: m.role, content: m.content })),
			});
			this.sessionSpan.end();
			this.sessionSpan = undefined;
		}

		Tracer.remove('prompty-chat');

		const tracePath = this.promptyTracer.lastTracePath;
		if (tracePath) {
			this.postMessage({ command: 'chatEnded', tracePath });
			const traceUri = Uri.file(tracePath);
			try {
				await commands.executeCommand('vscode.openWith', traceUri, 'prompty.traceViewer');
			} catch {
				try {
					await window.showTextDocument(traceUri, { preview: true, viewColumn: ViewColumn.Beside });
				} catch {
					// Trace file is still on disk
				}
			}
		} else {
			this.postMessage({ command: 'chatEnded', tracePath: null });
		}
	}

	private postMessage(message: Record<string, unknown>): void {
		if (!this.disposed) {
			this.panel.webview.postMessage(message);
		}
	}

	private getHtml(): string {
		const nonce = getNonce();
		const csp = this.panel.webview.cspSource;

		return /*html*/`<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${csp} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${csp} https:;">
	<title>Chat: ${this.fileName}</title>
	<style nonce="${nonce}">
		:root {
			--bg: var(--vscode-editor-background);
			--fg: var(--vscode-editor-foreground);
			--input-bg: var(--vscode-input-background);
			--input-fg: var(--vscode-input-foreground);
			--input-border: var(--vscode-input-border, var(--vscode-panel-border));
			--button-bg: var(--vscode-button-background);
			--button-fg: var(--vscode-button-foreground);
			--button-hover: var(--vscode-button-hoverBackground);
			--badge-bg: var(--vscode-badge-background);
			--badge-fg: var(--vscode-badge-foreground);
			--border: var(--vscode-panel-border);
			--card-bg: var(--vscode-editorWidget-background);
			--error-fg: var(--vscode-errorForeground);
			--muted: var(--vscode-descriptionForeground);
			--blue: var(--vscode-charts-blue);
			--green: var(--vscode-charts-green);
			--orange: var(--vscode-charts-orange);
			--purple: var(--vscode-charts-purple);
			--yellow: var(--vscode-charts-yellow);
			--user-bg: var(--vscode-inputOption-activeBackground);
			--user-fg: var(--vscode-inputOption-activeForeground);
			--subtle-blue-bg: color-mix(in srgb, var(--vscode-charts-blue) 14%, transparent);
			--subtle-green-bg: color-mix(in srgb, var(--vscode-charts-green) 14%, transparent);
			--inline-code-bg: var(--vscode-textCodeBlock-background);
			--code-font: 'Cascadia Code', 'Fira Code', var(--vscode-editor-font-family), monospace;
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		html, body { height: 100%; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); }
		body { display: flex; flex-direction: column; }

		/* Header */
		#header {
			display: flex; align-items: center; gap: 10px;
			padding: 12px 16px; border-bottom: 1px solid var(--border);
		}
		.header-icon {
			width: 26px; height: 26px; border-radius: 4px;
			background: var(--subtle-blue-bg); color: var(--blue);
			display: flex; align-items: center; justify-content: center;
			font-weight: 700; font-size: 13px; font-family: var(--code-font);
			flex-shrink: 0;
		}
		.header-title { font-weight: 600; font-size: 14px; }
		.header-sub { font-size: 11px; color: var(--muted); }
		#end-btn {
			width: 36px; height: 36px; background: transparent;
			color: var(--muted); border: 1px solid var(--border); border-radius: 4px;
			cursor: pointer; font-size: 14px; display: flex;
			align-items: center; justify-content: center; flex-shrink: 0;
		}
		#end-btn:hover { color: var(--fg); border-color: var(--fg); }
		#end-btn:disabled { opacity: 0.4; cursor: default; }

		/* Messages */
		#messages {
			flex: 1; overflow-y: auto; padding: 12px 16px;
		}
		.msg {
			margin-bottom: 12px; display: flex; flex-direction: column;
		}
		.msg-role {
			font-size: 10px; font-weight: 600; text-transform: uppercase;
			letter-spacing: 0.05em; margin-bottom: 3px;
		}
		.msg.system .msg-role { color: var(--purple); }
		.msg.user .msg-role { color: var(--blue); }
		.msg.assistant .msg-role { color: var(--yellow); }
		.msg.error .msg-role { color: var(--error-fg); }

		.msg-content {
			padding: 8px 12px; border-radius: 6px;
			word-break: break-word; overflow-wrap: anywhere; line-height: 1.5;
		}
		.msg.system .msg-content {
			background: transparent; color: var(--muted); font-style: italic;
			font-size: 0.9em; border-left: 2px solid var(--purple); padding-left: 10px;
			white-space: pre-wrap;
		}
		.msg.user .msg-content {
			background: var(--user-bg); color: var(--user-fg);
			align-self: flex-end; border-radius: 12px 12px 2px 12px; max-width: 80%;
			white-space: pre-wrap;
		}
		.msg.assistant .msg-content {
			background: var(--card-bg); border: 1px solid var(--border);
		}
		.msg.error .msg-content {
			background: transparent; color: var(--error-fg); border: 1px solid var(--error-fg);
		}

		/* Markdown content styles */
		.msg-content p { margin: 0.4em 0; }
		.msg-content p:first-child { margin-top: 0; }
		.msg-content p:last-child { margin-bottom: 0; }
		.msg-content code {
			font-family: var(--code-font); font-size: 0.9em;
			background: var(--inline-code-bg); padding: 1px 4px;
			border-radius: 3px;
		}
		.msg-content pre {
			margin: 0.5em 0; padding: 8px 10px; border-radius: 4px;
			background: var(--bg); overflow-x: hidden; line-height: 1.4;
			white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
		}
		.msg-content pre code {
			background: none; padding: 0; font-size: 12px; white-space: inherit;
		}
		.json-key { color: var(--vscode-textLink-foreground); }
		.json-string { color: var(--vscode-terminal-ansiGreen); }
		.json-number { color: var(--vscode-terminal-ansiYellow); }
		.json-boolean { color: var(--vscode-terminal-ansiMagenta); }
		.json-null { color: var(--vscode-descriptionForeground); }
		.msg-content ul, .msg-content ol {
			margin: 0.4em 0; padding-left: 1.5em;
		}
		.msg-content li { margin: 0.2em 0; }
		.msg-content blockquote {
			margin: 0.4em 0; padding-left: 10px;
			border-left: 2px solid var(--muted); color: var(--muted);
		}
		.msg-content h1, .msg-content h2, .msg-content h3,
		.msg-content h4, .msg-content h5, .msg-content h6 {
			margin: 0.5em 0 0.3em; font-weight: 600;
		}
		.msg-content h1 { font-size: 1.3em; }
		.msg-content h2 { font-size: 1.15em; }
		.msg-content h3 { font-size: 1.05em; }
		.msg-content a { color: var(--blue); text-decoration: none; }
		.msg-content a:hover { text-decoration: underline; }
		.msg-content table {
			border-collapse: collapse; margin: 0.4em 0; font-size: 0.9em;
		}
		.msg-content th, .msg-content td {
			border: 1px solid var(--border); padding: 4px 8px;
		}
		.msg-content th { background: var(--vscode-editorWidget-background); font-weight: 600; }
		.msg-content hr { border: none; border-top: 1px solid var(--border); margin: 0.6em 0; }
		.msg-content img {
			max-width: 100%; border-radius: 6px; margin: 0.4em 0;
		}

		/* Streaming cursor effect */
		.msg.streaming .msg-content::after {
			content: '▍'; animation: blink 0.8s step-end infinite; color: var(--muted);
		}
		@keyframes blink { 50% { opacity: 0; } }

		/* Tool calls */
		.tool-call {
			margin-bottom: 12px; border: 1px solid var(--border);
			border-radius: 6px; padding: 10px 12px; background: var(--card-bg);
		}
		.tool-call-header {
			font-size: 12px; font-weight: 600; color: var(--green);
			display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
		}
		.tool-call-header .tool-badge {
			width: 18px; height: 18px; border-radius: 3px;
			background: var(--subtle-green-bg); color: var(--green);
			display: inline-flex; align-items: center; justify-content: center;
			font-size: 11px; font-family: var(--code-font); flex-shrink: 0;
		}
		.tool-call-header .resolved-mark { color: var(--green); font-size: 14px; margin-left: auto; }
		.tool-call-args {
			font-family: var(--code-font); font-size: 12px;
			background: var(--bg); padding: 6px 8px; border-radius: 4px;
			margin-bottom: 8px; white-space: pre-wrap; color: var(--orange);
		}
		.tool-call-input { display: flex; gap: 6px; }
		.tool-call-input input {
			flex: 1; padding: 4px 8px; background: var(--input-bg);
			color: var(--input-fg); border: 1px solid var(--border);
			border-radius: 4px; font-family: inherit; font-size: inherit;
		}
		.tool-call-input button {
			width: 28px; height: 28px; background: var(--button-bg);
			color: var(--button-fg); border: none; border-radius: 4px;
			cursor: pointer; font-size: 14px; display: flex;
			align-items: center; justify-content: center;
		}
		.tool-call-input button:hover { background: var(--button-hover); }
		.tool-call.resolved { opacity: 0.7; }
		.tool-call.resolved .tool-call-input { display: none; }
		.tool-call-result {
			font-size: 12px; color: var(--green); margin-top: 6px;
			font-family: var(--code-font);
		}

		/* Loading indicator */
		.loading {
			display: none; padding: 8px 16px; color: var(--muted);
			font-size: 12px;
		}
		.loading.active { display: block; }
		.loading::after { content: ''; animation: dots 1.5s steps(4,end) infinite; }
		@keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

		/* Input area */
		#input-area {
			display: flex; gap: 8px; padding: 12px 16px;
			border-top: 1px solid var(--border); align-items: flex-end;
		}
		#user-input {
			flex: 1; padding: 8px 12px; background: var(--input-bg); color: var(--input-fg);
			border: 1px solid var(--border); border-radius: 6px;
			font-family: inherit; font-size: inherit; resize: none;
			rows: 4; line-height: 1.4;
		}
		#user-input:focus { outline: none; border-color: var(--blue); }
		#send-btn {
			width: 36px; height: 36px; background: var(--button-bg);
			color: var(--button-fg); border: none; border-radius: 4px;
			cursor: pointer; font-size: 16px; display: flex;
			align-items: center; justify-content: center; flex-shrink: 0;
		}
		#send-btn:hover { background: var(--button-hover); }
		#send-btn:disabled { opacity: 0.5; cursor: default; }

		/* Collapsed system messages */
		.collapsed .msg-content { display: none; }
		.collapsed .msg-toggle { cursor: pointer; }
		.collapsed .msg-toggle::after { content: ' ▸ click to expand'; font-weight: normal; font-style: italic; }
		.msg-toggle {
			background: none; border: 0; padding: 0;
			font-size: 10px; font-weight: 600; text-transform: uppercase;
			letter-spacing: 0.05em; color: var(--purple); margin-bottom: 3px; cursor: pointer;
		}
		.msg-toggle::after { content: ' ▾'; font-weight: normal; }
		.msg-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

		/* Chat ended state */
		#input-area.ended { display: none; }
		#ended-bar {
			display: none; padding: 12px 16px; border-top: 1px solid var(--border);
			color: var(--muted); font-size: 12px; text-align: center;
		}
		#ended-bar.active { display: block; }
	</style>
</head>
<body>
	<div id="header">
		<div class="header-icon">P</div>
		<div>
			<div class="header-title">${this.fileName}</div>
			<div class="header-sub">Interactive chat</div>
		</div>
	</div>
	<div id="messages">
		<div id="loading" class="loading">Thinking</div>
	</div>
	<div id="input-area">
		<textarea id="user-input" placeholder="Type a message…" rows="4"></textarea>
		<button id="send-btn" title="Send (Enter)" aria-label="Send message">▶</button>
		<button id="end-btn" title="End chat and save trace" aria-label="End chat and save trace">■</button>
	</div>
	<div id="ended-bar">Chat ended — trace saved.</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const messagesEl = document.getElementById('messages');
		const loadingEl = document.getElementById('loading');
		const inputEl = document.getElementById('user-input');
		const sendBtn = document.getElementById('send-btn');
		const endBtn = document.getElementById('end-btn');
		const inputArea = document.getElementById('input-area');
		const endedBar = document.getElementById('ended-bar');
		let isLoading = false;
		let isChatEnded = false;
		let pendingToolCalls = 0;

		// Send on Enter (Shift+Enter for newline)
		inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});

		sendBtn.addEventListener('click', sendMessage);
		endBtn.addEventListener('click', endChat);

		function sendMessage() {
			const text = inputEl.value.trim();
			if (!text || isLoading || isChatEnded) return;
			inputEl.value = '';
			inputEl.style.height = 'auto';
			vscode.postMessage({ command: 'sendMessage', text });
		}

		function endChat() {
			if (isChatEnded) return;
			isChatEnded = true;
			endBtn.disabled = true;
			inputArea.className = 'ended';
			endedBar.className = 'active';
			vscode.postMessage({ command: 'endChat' });
		}

		function addMessage(role, content, opts = {}) {
			const div = document.createElement('div');
			div.className = 'msg ' + role;
			if (opts.collapsed) div.className += ' collapsed';

			if (opts.collapsed) {
				const toggle = document.createElement('button');
				toggle.className = 'msg-toggle';
				toggle.textContent = role;
				toggle.type = 'button';
				toggle.setAttribute('aria-expanded', 'false');
				toggle.addEventListener('click', () => {
					div.classList.toggle('collapsed');
					toggle.setAttribute('aria-expanded', div.classList.contains('collapsed') ? 'false' : 'true');
				});
				div.appendChild(toggle);
			} else {
				const roleEl = document.createElement('div');
				roleEl.className = 'msg-role';
				roleEl.textContent = role;
				div.appendChild(roleEl);
			}

			const contentEl = document.createElement('div');
			contentEl.className = 'msg-content';
			if (opts.isHtml) {
				contentEl.innerHTML = content;
			} else {
				contentEl.textContent = content;
			}
			colorizeJsonBlocks(contentEl);
			div.appendChild(contentEl);

			messagesEl.insertBefore(div, loadingEl);
			scrollToBottom();
		}
		let streamDiv = null;
		let streamContentEl = null;
		let scrollRafId = null;

		function startStream(role) {
			streamDiv = document.createElement('div');
			streamDiv.className = 'msg ' + role + ' streaming';

			const roleEl = document.createElement('div');
			roleEl.className = 'msg-role';
			roleEl.textContent = role;
			streamDiv.appendChild(roleEl);

			streamContentEl = document.createElement('div');
			streamContentEl.className = 'msg-content';
			streamDiv.appendChild(streamContentEl);

			messagesEl.insertBefore(streamDiv, loadingEl);
			scrollToBottom();
		}

		function streamChunk(html) {
			if (!streamContentEl) return;
			streamContentEl.innerHTML = html;
			colorizeJsonBlocks(streamContentEl);
			// Debounce scroll with rAF to avoid layout thrashing
			if (!scrollRafId) {
				scrollRafId = requestAnimationFrame(() => {
					scrollRafId = null;
					scrollToBottom();
				});
			}
		}

		function streamEnd() {
			if (streamDiv) streamDiv.classList.remove('streaming');
			streamDiv = null;
			streamContentEl = null;
			if (scrollRafId) {
				cancelAnimationFrame(scrollRafId);
				scrollRafId = null;
			}
			scrollToBottom();
		}

		function addToolCall(callId, toolName, args) {
			pendingToolCalls++;
			loadingEl.textContent = 'Waiting for tool response';
			loadingEl.className = 'loading active';

			const div = document.createElement('div');
			div.className = 'tool-call';
			div.id = 'tc-' + callId;

			div.innerHTML = '<div class="tool-call-header">'
				+ '<span class="tool-badge">🔧</span> '
				+ escapeHtml(toolName)
				+ '</div>'
				+ '<div class="tool-call-args">' + escapeHtml(args) + '</div>'
				+ '<div class="tool-call-input">'
				+ '<input type="text" placeholder="Mock response…" />'
				+ '<button title="Submit (Enter)" aria-label="Submit tool response">↵</button>'
				+ '</div>';

			const input = div.querySelector('input');
			const btn = div.querySelector('button');

			function submit() {
				const val = input.value.trim() || 'OK';
				vscode.postMessage({ command: 'toolCallResponse', callId, response: val });
				div.classList.add('resolved');
				const header = div.querySelector('.tool-call-header');
				if (header) {
					const mark = document.createElement('span');
					mark.className = 'resolved-mark';
					mark.textContent = '✓';
					header.appendChild(mark);
				}
				const result = document.createElement('div');
				result.className = 'tool-call-result';
				result.textContent = '→ ' + val;
				div.appendChild(result);

				pendingToolCalls--;
				if (pendingToolCalls <= 0) {
					pendingToolCalls = 0;
					loadingEl.textContent = 'Thinking';
				}
			}

			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); submit(); }
			});
			btn.addEventListener('click', submit);

			messagesEl.insertBefore(div, loadingEl);
			scrollToBottom();
			input.focus();
		}

		function addError(content) {
			const div = document.createElement('div');
			div.className = 'msg error';
			const roleEl = document.createElement('div');
			roleEl.className = 'msg-role';
			roleEl.textContent = 'error';
			div.appendChild(roleEl);
			const contentEl = document.createElement('div');
			contentEl.className = 'msg-content';
			contentEl.textContent = content;
			div.appendChild(contentEl);
			messagesEl.insertBefore(div, loadingEl);
			scrollToBottom();
		}

		function scrollToBottom() {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}

		function escapeHtml(str) {
			return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}

		function tryPrettyJson(text) {
			const trimmed = text.trim();
			if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
			try {
				return JSON.stringify(JSON.parse(trimmed), null, 2);
			} catch {
				return null;
			}
		}

		function colorizeJsonText(json) {
			return escapeHtml(json).replace(
				/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\\s*:)|("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)|\\b(true|false)\\b|\\bnull\\b/g,
				(match, key, stringValue, numberValue, booleanValue) => {
					if (key) return '<span class="json-key">' + key + '</span>';
					if (stringValue) return '<span class="json-string">' + stringValue + '</span>';
					if (numberValue) return '<span class="json-number">' + numberValue + '</span>';
					if (booleanValue) return '<span class="json-boolean">' + booleanValue + '</span>';
					return '<span class="json-null">' + match + '</span>';
				}
			);
		}

		function colorizeJsonBlocks(root) {
			const blocks = [];
			if (root.matches && root.matches('pre code, pre')) blocks.push(root);
			blocks.push(...root.querySelectorAll('pre code, pre'));
			for (const block of blocks) {
				if (block.classList.contains('json-tokenized')) continue;
				const pretty = tryPrettyJson(block.textContent || '');
				if (!pretty) continue;
				block.classList.add('json-tokenized', 'language-json');
				block.innerHTML = colorizeJsonText(pretty);
			}
		}

		window.addEventListener('message', (e) => {
			const msg = e.data;
			switch (msg.command) {
				case 'addMessage':
					addMessage(msg.role, msg.content, { collapsed: msg.collapsed, isHtml: msg.isHtml });
					break;
				case 'startStream':
					startStream(msg.role);
					break;
				case 'streamChunk':
					streamChunk(msg.html);
					break;
				case 'streamEnd':
					streamEnd();
					break;
				case 'showToolCall':
					addToolCall(msg.callId, msg.toolName, msg.arguments);
					break;
				case 'addError':
					addError(msg.content);
					break;
				case 'setLoading':
					isLoading = msg.loading;
					loadingEl.className = 'loading' + (msg.loading ? ' active' : '');
					loadingEl.textContent = 'Thinking';
					sendBtn.disabled = msg.loading;
					scrollToBottom();
					if (!msg.loading) inputEl.focus();
					break;
				case 'setLoadingText':
					loadingEl.textContent = msg.text;
					break;
				case 'setReady':
					inputEl.focus();
					break;
				case 'chatEnded':
					if (msg.tracePath) {
						endedBar.textContent = 'Chat ended — trace saved to ' + msg.tracePath;
					}
					break;
			}
		});

		// Notify extension we're ready
		vscode.postMessage({ command: 'ready' });
	</script>
</body>
</html>`;
	}
}
