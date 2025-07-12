import * as path from 'path';
import * as vscode from "vscode";

const traceLight = `<svg width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M14.1005 5.52661L13.7805 4.77994L10.7939 1.79328L10.1005 1.52661H4.07388L3.06055 2.48661V14.4866L4.07388 15.4999H8.6582L8.53125 14.4866H4.07388V2.48661H9.08721V6.48661H13.0872V7.69299L14.1005 7.99768V5.52661ZM10.041 5.52663H13.0277L10.041 2.48663V5.52663ZM9.1986 9.49834C9.17414 9.29172 9.32181 9.10438 9.52843 9.07992L10.2886 8.98991L10.9938 8.90641L11.9758 8.79012C13.2672 8.63721 14.4381 9.56013 14.591 10.8515C14.7439 12.1429 13.821 13.3138 12.5296 13.4667L11.5475 13.583L11.7044 14.908C11.7289 15.1146 11.5812 15.302 11.3746 15.3264L10.2834 15.4556C10.0767 15.4801 9.88941 15.3324 9.86495 15.1258L9.1986 9.49834ZM10.669 10.0934L10.7888 10.0795C11.3239 10.0172 11.8081 10.4006 11.8703 10.9356C11.9325 11.4707 11.5492 11.9549 11.0141 12.0171L10.8943 12.0311C10.6014 12.0651 10.3364 11.8553 10.3023 11.5624L10.2003 10.6853C10.1663 10.3925 10.3761 10.1274 10.669 10.0934ZM12.5225 9.84808L12.6423 9.83415C13.1774 9.77194 13.6616 10.1553 13.7238 10.6903C13.786 11.2254 13.4027 11.7096 12.8676 11.7718L12.7478 11.7858C12.4549 11.8198 12.1899 11.61 12.1558 11.3171L12.0539 10.44C12.0198 10.1472 12.2296 9.88214 12.5225 9.84808Z" fill="#3B3B3B"/>
</svg>`;
const traceDark = `<svg width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M14.1005 5.52661L13.7805 4.77994L10.7939 1.79328L10.1005 1.52661H4.07388L3.06055 2.48661V14.4866L4.07388 15.4999H8.6582L8.53125 14.4866H4.07388V2.48661H9.08721V6.48661H13.0872V7.69299L14.1005 7.99768V5.52661ZM10.041 5.52663H13.0277L10.041 2.48663V5.52663ZM9.1986 9.49834C9.17414 9.29172 9.32181 9.10438 9.52843 9.07992L10.2886 8.98991L10.9938 8.90641L11.9758 8.79012C13.2672 8.63721 14.4381 9.56013 14.591 10.8515C14.7439 12.1429 13.821 13.3138 12.5296 13.4667L11.5475 13.583L11.7044 14.908C11.7289 15.1146 11.5812 15.302 11.3746 15.3264L10.2834 15.4556C10.0767 15.4801 9.88941 15.3324 9.86495 15.1258L9.1986 9.49834ZM10.669 10.0934L10.7888 10.0795C11.3239 10.0172 11.8081 10.4006 11.8703 10.9356C11.9325 11.4707 11.5492 11.9549 11.0141 12.0171L10.8943 12.0311C10.6014 12.0651 10.3364 11.8553 10.3023 11.5624L10.2003 10.6853C10.1663 10.3925 10.3761 10.1274 10.669 10.0934ZM12.5225 9.84808L12.6423 9.83415C13.1774 9.77194 13.6616 10.1553 13.7238 10.6903C13.786 11.2254 13.4027 11.7096 12.8676 11.7718L12.7478 11.7858C12.4549 11.8198 12.1899 11.61 12.1558 11.3171L12.0539 10.44C12.0198 10.1472 12.2296 9.88214 12.5225 9.84808Z" fill="#CCCCCC"/>
</svg>`;

export const Resource_Type_Workspace = "workspace";
export const Resource_Type_Function = "function";
export const Resource_Type_Trace = "trace";

const darkImage = traceDark
	.replace(/<\?xml.*\?>/, "")
	.replace(/<!DOCTYPE.*>/, "")
	.replace(/\n/g, "")
	.replace(/\r/g, "");
const lightImage = traceLight
	.replace(/<\?xml.*\?>/, "")
	.replace(/<!DOCTYPE.*>/, "")
	.replace(/\n/g, "")
	.replace(/\r/g, "");

export interface ITrace {
	name: string;
	type: "workspace" | "function" | "trace";
	uri?: vscode.Uri;
	children?: ITrace[];
	date?: Date;
}

export class TraceItem extends vscode.TreeItem {
	constructor(
		public readonly trace: ITrace,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(trace.name, collapsibleState);
		this.tooltip = trace.uri ? trace.uri.fsPath : trace.name;
		this.contextValue = this.trace.type;
		if (this.trace.type === "workspace") {
			this.iconPath = new vscode.ThemeIcon("symbol-folder");
		} else if (this.trace.type === "function") {
			this.iconPath = new vscode.ThemeIcon("symbol-method");
		} else {
			this.iconPath = {
				light: vscode.Uri.from({
					scheme: "data",
					path: `image/svg+xml;utf8,${lightImage}`,
				}),
				dark: vscode.Uri.from({
					scheme: "data",
					path: `image/svg+xml;utf8,${darkImage}`,
				}),
			};
		}
	}

	getChildren(): TraceItem[] {
		if (this.trace.children) {
			return this.trace.children.map((child) => {
				return new TraceItem(
					child,
					child.type === "trace"
						? vscode.TreeItemCollapsibleState.None
						: vscode.TreeItemCollapsibleState.Collapsed
				);
			});
		} else {
			return [];
		}
	}
}

export class TraceFileProvider implements vscode.TreeDataProvider<TraceItem> {
	public static createTreeView(
		context: vscode.ExtensionContext,
		viewId: string,
		refreshCommand: string
	): vscode.TreeView<TraceItem> {
		const traceFileProvider = new TraceFileProvider();
		const treeView = vscode.window.createTreeView(viewId, {
			treeDataProvider: traceFileProvider,
			canSelectMany: true,
			showCollapseAll: true,
		});
		vscode.commands.registerCommand(refreshCommand, () => traceFileProvider.refresh());
		context.subscriptions.push(treeView);
		return treeView;
	}

	fetchTraces = async (): Promise<TraceItem[]> => {
		if (vscode.workspace.workspaceFolders) {
			const traces: ITrace[] = await Promise.all(
				vscode.workspace.workspaceFolders.map(
					async (folder) => await this.fetchTracesFromFolder(folder)
				)
			);
			return traces
				.filter((trace) => trace.children && trace.children.length > 0)
				.map((trace) => {
					return new TraceItem(
						trace,
						trace.type === "workspace"
							? vscode.TreeItemCollapsibleState.Collapsed
							: vscode.TreeItemCollapsibleState.None
					);
				});
		} else {
			return [];
		}
	};

	numberHelper = (arr: string[], start: number, end: number): number => {
		return parseInt(arr.slice(start, end).join(""), 10);
	};

	fetchTracesFromFolder = async (folder: vscode.WorkspaceFolder): Promise<ITrace> => {
		const search = new vscode.RelativePattern(folder, "**/*.tracy");
		const files = await vscode.workspace.findFiles(search);

		const traces: ITrace[] = [];
		const functions: Record<string, ITrace[]> = {};
		for (const file of files) {
			const split = path.basename(file.fsPath).split(".");
			if (split.length !== 4) {
				continue;
			}

			try {
				const [name, date, time] = split;
				functions[name] = functions[name] || [];
				const d = Array.from(date + time);
				const traceDate = new Date(
					this.numberHelper(d, 0, 4),
					this.numberHelper(d, 4, 6) - 1,
					this.numberHelper(d, 6, 8),
					this.numberHelper(d, 8, 10),
					this.numberHelper(d, 10, 12),
					this.numberHelper(d, 12, 14)
				);

				functions[name].push({
					name: traceDate.toLocaleDateString() + " " + traceDate.toLocaleTimeString(),
					type: "trace",
					uri: file,
					date: traceDate,
				});
			} catch (e) {
				console.log(e);
				continue;
			}
		}

		for (const key in functions) {
			traces.push({
				name: key,
				type: "function",
				children: functions[key].sort((a, b) => {
					return a.date!.getTime() - b.date!.getTime();
				}),
			});
		}

		return {
			name: folder.name,
			type: "workspace",
			children: traces,
		};
	};

	getTreeItem(element: TraceItem): TraceItem {
		return element;
	}

	getChildren(element?: TraceItem): vscode.ProviderResult<TraceItem[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			return Promise.resolve([]);
		}
		if (element) {
			return Promise.resolve(element.getChildren());
		} else {
			return Promise.resolve(this.fetchTraces());
		}
	}

	private _onDidChangeTreeData: vscode.EventEmitter<TraceItem | undefined | null | void> =
		new vscode.EventEmitter<TraceItem | undefined | null | void>();

	readonly onDidChangeTreeData: vscode.Event<TraceItem | undefined | null | void> =
		this._onDidChangeTreeData.event;

	public refresh(): void {
		this._onDidChangeTreeData.fire();
	}
}