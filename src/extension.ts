import * as vscode from 'vscode';
import { SorexChatViewProvider } from './webview/sorexChatView';
import { SorexSettingsPanel } from './webview/sorexSettingsPanel';
import { SorexWorkspaceTools } from './tools/vscodeTools';
import { getSorexSettingsPath, initializeSorexConfig } from './config/sorexConfig';

export function activate(context: vscode.ExtensionContext) {
  initializeSorexConfig(context);
  const tools = new SorexWorkspaceTools(context);
  const provider = new SorexChatViewProvider(context.extensionUri, tools, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SorexChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand('sorex.openChat', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.sorex');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('sorex.openSettings', async () => {
    SorexSettingsPanel.show(context.extensionUri, context);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('sorex.openIndexingSettings', async () => {
    SorexSettingsPanel.show(context.extensionUri, context, 'indexing');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('sorex.refreshIndex', async (silent?: boolean) => {
    await provider.refreshWorkspaceIndex(Boolean(silent));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('sorex.refreshModels', async () => {
    await provider.refreshModels();
  }));

  const settingsPath = getSorexSettingsPath(context);
  const settingsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(settingsPath).with({ path: vscode.Uri.file(settingsPath).path.replace(/[^\\/]+$/, '') }).fsPath, vscode.Uri.file(settingsPath).fsPath.split(/[\\/]/).pop() || 'settings.json'));
  const refreshFromSettingsFile = async () => {
    await provider.refreshModels();
    await provider.autoRefreshIndexIfConfigured();
  };
  context.subscriptions.push(settingsWatcher);
  context.subscriptions.push(settingsWatcher.onDidChange(refreshFromSettingsFile));
  context.subscriptions.push(settingsWatcher.onDidCreate(refreshFromSettingsFile));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
    const keys = [
      'sorex.indexEnabled',
      'sorex.indexAutoRefresh',
      'sorex.indexEmbeddingAutoSelect',
      'sorex.indexEmbeddingProvider',
      'sorex.indexRankingMode',
      'sorex.indexStorageMode',
      'sorex.indexIncludeGlobs',
      'sorex.indexExcludeGlobs',
      'sorex.indexMaxFiles',
      'sorex.indexMaxFileSizeKb',
      'sorex.indexChunkChars',
      'sorex.indexChunkOverlap',
      'sorex.indexEmbeddingEnabled',
      'sorex.indexEmbeddingEndpoint',
      'sorex.indexEmbeddingModel',
      'sorex.indexEmbeddingBatchSize',
      'sorex.indexEmbeddingWeight'
    ];
    if (keys.some(key => event.affectsConfiguration(key))) {
      await provider.autoRefreshIndexIfConfigured();
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('sorex.clearChat', async () => {
    provider.clear();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('sorex.testReadWorkspace', async () => {
    const files = await tools.searchFiles('**/*.{ts,tsx,js,jsx,json}', '**/node_modules/**', 25);
    await vscode.window.showInformationMessage(`SOREX saw ${files.length} workspace files.`);
  }));
}

export function deactivate() {}
