import * as vscode from "vscode";
import { getNonce } from "../utils/nonce";

export class PromptyTraceProvider implements vscode.CustomTextEditorProvider {
	private static readonly viewType = "prompty.traceViewer";

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new PromptyTraceProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(
			PromptyTraceProvider.viewType,
			provider
		);
		return providerRegistration;
	}

	constructor(private readonly context: vscode.ExtensionContext) { }

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri),
				vscode.Uri.joinPath(this.context.extensionUri, "out"),
				vscode.Uri.joinPath(this.context.extensionUri, "packages/trace/dist"),
			],
		};


		webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);

		const updateWebview = () => {
			console.log("Updating webview with document content");
			console.log("Document URI:", document.uri.toString());
			//console.log("Document Text:", document.getText());
			webviewPanel.webview.postMessage({
				command: "trace",
				/* maybe do some format checking here */
				text: document.getText(),
			});
		};

		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() === document.uri.toString()) {
				updateWebview();
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
		});

		webviewPanel.onDidChangeViewState((e) => {
			if (e.webviewPanel.visible) {
				updateWebview();
			}
		});

		// Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage((message) => {
			console.log("Received message from webview:", JSON.stringify(message));
			if (message.command === "ready") {
				updateWebview();
			} else {
				console.log("Message", JSON.stringify(message));
			}
			/*
			const command = message.command;
			const text = message.text;
			switch (command) {
				case "info":
					vscode.window.showInformationMessage(text);
					return;
			}
			*/
		});

	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// The JS file from the React build output
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, "packages", "trace", "dist", "index.js")
		);

		const nonce = getNonce();

		return /*html*/ `
    <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta
            http-equiv="Content-Security-Policy"
            content="img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; style-src-elem 'unsafe-inline';"
          />
          <title>Prompty Trace</title>
          <script type="module" crossorigin src="${scriptUri}" nonce="${nonce}"></script>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>
    `;
	}
}
