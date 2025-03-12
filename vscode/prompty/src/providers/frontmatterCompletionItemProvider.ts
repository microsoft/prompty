
import * as vscode from 'vscode';

export class FrontmatterCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        

        const completionItems: vscode.CompletionItem[] = [
            new vscode.CompletionItem('title', vscode.CompletionItemKind.Field),
            new vscode.CompletionItem('date', vscode.CompletionItemKind.Field),
            new vscode.CompletionItem('tags', vscode.CompletionItemKind.Field),
            new vscode.CompletionItem('summary', vscode.CompletionItemKind.Field),
            new vscode.CompletionItem('author', vscode.CompletionItemKind.Field),
            new vscode.CompletionItem('category', vscode.CompletionItemKind.Field),
            new vscode.CompletionItem('status', vscode.CompletionItemKind.Field),
        ];

        return completionItems;
    }
}