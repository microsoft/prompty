import { ExtensionContext, ViewColumn, WebviewPanel, window, Uri, commands } from 'vscode';
import {
	load, prepare, execute, executeAgent,
	registerConnection, clearConnections,
	ReferenceConnection, Model,
	Tracer, PromptyTracer, traceSpan,
	type ToolCall, Message,
} from '@prompty/core';
import type { PromptAgent } from '@prompty/core';
import '@prompty/openai';
import '@prompty/foundry';
import '@prompty/anthropic';
import * as path from 'path';
import { getNonce } from '../utils/nonce';
import { ConnectionStore } from '../connections/store';
import { ConnectionProviderRegistry } from '../connections/registry';

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
 * prepare→execute cycle with the accumulated conversation history
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
	private sessionSpan: ReturnType<typeof Tracer.start> | undefined;
	private turnCount = 0;

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
		// Reuse existing panel for same file
		const existing = ChatPanel.panels.get(filePath);
		if (existing && !existing.disposed) {
			existing.panel.reveal();
			return existing;
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
			this.disposed = true;
			// Close session span if still open
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
		});
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
		this.postMessage({ command: 'setReady' });
	}

	/**
	 * Handle a user message: add to conversation, run the agent, display response.
	 */
	private async handleUserMessage(text: string): Promise<void> {
		// Show user message in chat
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

			let result: unknown;

			if (this.hasTools) {
				// Use executeAgent with mock tool functions
				const toolFns = this.buildToolFunctions();
				result = await executeAgent(this.agent, inputs, { tools: toolFns });
			} else {
				result = await execute(this.agent, inputs);
			}

			// Extract assistant response
			const assistantContent = typeof result === 'string'
				? result
				: JSON.stringify(result, null, 2);

			// Add to conversation history
			this.conversation.push({ role: 'assistant', content: assistantContent });

			// Show assistant response in chat
			this.postMessage({
				command: 'addMessage',
				role: 'assistant',
				content: assistantContent,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.postMessage({ command: 'addError', content: message });
		} finally {
			this.postMessage({ command: 'setLoading', loading: false });
		}
	}

	/**
	 * Build mock tool functions that prompt the user via the webview.
	 */
	private buildToolFunctions(): Record<string, (...args: unknown[]) => unknown> {
		const tools: Record<string, (...args: unknown[]) => unknown> = {};

		for (const tool of (this.agent.tools ?? [])) {
			if (tool.kind !== 'function') continue;
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
		content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<title>Chat: ${this.fileName}</title>
	<style nonce="${nonce}">
		:root {
			--bg: var(--vscode-editor-background);
			--fg: var(--vscode-editor-foreground);
			--input-bg: #3c3c3c;
			--input-fg: var(--vscode-input-foreground);
			--input-border: var(--vscode-input-border, #3c3c3c);
			--button-bg: #0e639c;
			--button-fg: #ffffff;
			--button-hover: #1177bb;
			--badge-bg: var(--vscode-badge-background);
			--badge-fg: var(--vscode-badge-foreground);
			--border: #2d2d2d;
			--card-bg: #252526;
			--error-fg: var(--vscode-errorForeground, #f44);
			--muted: var(--vscode-descriptionForeground);
			--blue: #569cd6;
			--green: #4ec9b0;
			--orange: #ce9178;
			--purple: #c586c0;
			--yellow: #dcdcaa;
			--user-bg: #264f78;
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
			background: rgba(86,156,214,0.12); color: var(--blue);
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
			padding: 8px 12px; border-radius: 6px; white-space: pre-wrap;
			word-break: break-word; line-height: 1.5;
		}
		.msg.system .msg-content {
			background: transparent; color: var(--muted); font-style: italic;
			font-size: 0.9em; border-left: 2px solid var(--purple); padding-left: 10px;
		}
		.msg.user .msg-content {
			background: var(--user-bg); color: #fff;
			align-self: flex-end; border-radius: 12px 12px 2px 12px; max-width: 80%;
		}
		.msg.assistant .msg-content {
			background: var(--card-bg); border: 1px solid var(--border);
		}
		.msg.error .msg-content {
			background: transparent; color: var(--error-fg); border: 1px solid var(--error-fg);
		}

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
			background: rgba(78,201,176,0.12); color: var(--green);
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
			font-size: 10px; font-weight: 600; text-transform: uppercase;
			letter-spacing: 0.05em; color: var(--purple); margin-bottom: 3px; cursor: pointer;
		}
		.msg-toggle::after { content: ' ▾'; font-weight: normal; }

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
	<div id="messages"></div>
	<div id="loading" class="loading">Thinking</div>
	<div id="input-area">
		<textarea id="user-input" placeholder="Type a message…" rows="4"></textarea>
		<button id="send-btn" title="Send (Enter)">▶</button>
		<button id="end-btn" title="End chat and save trace">■</button>
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
				const toggle = document.createElement('div');
				toggle.className = 'msg-toggle';
				toggle.textContent = role;
				toggle.addEventListener('click', () => {
					div.classList.toggle('collapsed');
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
			contentEl.textContent = content;
			div.appendChild(contentEl);

			messagesEl.appendChild(div);
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
				+ '<button title="Submit (Enter)">↵</button>'
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

			messagesEl.appendChild(div);
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
			messagesEl.appendChild(div);
			scrollToBottom();
		}

		function scrollToBottom() {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}

		function escapeHtml(str) {
			return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}

		window.addEventListener('message', (e) => {
			const msg = e.data;
			switch (msg.command) {
				case 'addMessage':
					addMessage(msg.role, msg.content, { collapsed: msg.collapsed });
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
					sendBtn.disabled = msg.loading;
					if (!msg.loading) inputEl.focus();
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
