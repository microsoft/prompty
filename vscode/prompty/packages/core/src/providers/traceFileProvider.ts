import * as path from 'path';
import * as vscode from "vscode";

export const Resource_Type_Workspace = "workspace";
export const Resource_Type_Function = "function";
export const Resource_Type_Trace = "trace";

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
			this.iconPath = new vscode.ThemeIcon("pulse");
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
			}).sort((a, b) => {
				const mode = TraceFileProvider.sortMode;
				if (mode.startsWith("date") && a.trace.date && b.trace.date) {
					const cmp = a.trace.date.getTime() - b.trace.date.getTime();
					return mode === "date-desc" ? -cmp : cmp;
				}
				const cmp = a.trace.name.localeCompare(b.trace.name);
				return mode === "name-desc" ? -cmp : cmp;
			});
		} else {
			return [];
		}
	}
}

export type TraceSortMode = "date-desc" | "date-asc" | "name-asc" | "name-desc";

export class TraceFileProvider implements vscode.TreeDataProvider<TraceItem> {
	static sortMode: TraceSortMode = "date-desc";

	public static createTreeView(
		context: vscode.ExtensionContext,
		provider: TraceFileProvider,
		viewId: string,
		refreshCommand: string
	): vscode.TreeView<TraceItem> {
		const treeView = vscode.window.createTreeView(viewId, {
			treeDataProvider: provider,
			canSelectMany: true,
			showCollapseAll: true,
		});
		vscode.commands.registerCommand(refreshCommand, () => provider.refresh());
		vscode.commands.registerCommand("prompty.sortTracesDate", () => {
			// Toggle between date-desc and date-asc
			provider.setSortMode(TraceFileProvider.sortMode === "date-desc" ? "date-asc" : "date-desc");
		});
		vscode.commands.registerCommand("prompty.sortTracesName", () => {
			// Toggle between name-asc and name-desc
			provider.setSortMode(TraceFileProvider.sortMode === "name-asc" ? "name-desc" : "name-asc");
		});
		context.subscriptions.push(treeView);
		provider.refresh();

		return treeView;
	}

	public setSortMode(mode: TraceSortMode) {
		TraceFileProvider.sortMode = mode;
		this.refresh();
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
				})
				.sort((a, b) => a.trace.name.localeCompare(b.trace.name));
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
			} catch {
				continue;
			}
		}

		for (const key in functions) {
			traces.push({
				name: key,
				type: "function",
				children: functions[key].sort((a, b) => {
					return b.date!.getTime() - a.date!.getTime();
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
