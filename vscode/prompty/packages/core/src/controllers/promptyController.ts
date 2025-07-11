import { ExtensionContext, Uri, Disposable, window } from 'vscode';


export class PromptyController implements Disposable {


	constructor(private context: ExtensionContext) { }

	public run(uri: Uri) {
		// Logic to run the prompt using the provided URI
		console.log(`Running prompt for URI: ${uri.fsPath}`);
		const fileName = uri.fsPath;
		const terminals = window.terminals;
		const name = fileName.split(/(\/|\\)/).pop();
		// find existing terminal with same name
		let terminal = terminals.find((t) => t.name === name);
		if (!terminal) {
			terminal = window.createTerminal(name);
		}
		terminal.show();
		// hack on .env - should search for any .env in the project and use that
		// but for now just use the one in the workspace root
		terminal.sendText(`prompty --source ${fileName} --env .env`, true);
	}

	dispose(): void {
		// Clean up resources
	}

}