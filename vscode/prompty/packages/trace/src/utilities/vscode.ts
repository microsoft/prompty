import type { WebviewApi } from "vscode-webview";

class VSCodeAPIWrapper {
	private readonly vsCodeApi: WebviewApi<unknown> | undefined;
	readonly warningMessage =
		"Running in a non-webview context. This behaves differently in the browser.";


	constructor() {
		if (typeof acquireVsCodeApi === "function") {
			this.vsCodeApi = acquireVsCodeApi();
		} else {
			this.vsCodeApi = undefined;
			console.warn(this.warningMessage);
		}
	}

	public isVSCodeContext(): boolean {
		return this.vsCodeApi !== undefined;
	}


	public postMessage(message: unknown): void {
		if (this.vsCodeApi) {
			this.vsCodeApi.postMessage(message);
		} else {
			console.log(message);
		}
	}


	public getState(): unknown | undefined {
		if (this.vsCodeApi) {
			return this.vsCodeApi.getState();
		} else {
			//const trace = fetch("/prompty.trace");
			const state = localStorage.getItem("vscodeState");
			return state ? JSON.parse(state) : undefined;
		}
	}

	public setState<T extends unknown | undefined>(newState: T): T {
		if (this.vsCodeApi) {
			return this.vsCodeApi.setState(newState);
		} else {
			localStorage.setItem("vscodeState", JSON.stringify(newState));
			return newState;
		}
	}

	public registerCallback(
		callback: (event: MessageEvent) => void,
	): void {
		if (this.vsCodeApi) {
			window.addEventListener("message", callback);
		} else {
			console.warn(this.warningMessage);
		}
	}
}

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscode = new VSCodeAPIWrapper();
