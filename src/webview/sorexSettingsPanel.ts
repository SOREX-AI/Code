import * as vscode from 'vscode';
import { settingsPanelStyles } from './ui/settingsPanel';
import { getSorexConfig, openSorexSettingsJson, SorexConfigLike } from '../config/sorexConfig';
import { LmStudioClient } from '../llm/lmStudioClient';

type ProviderMode = 'lmstudio' | 'ollama' | 'jan' | 'custom' | 'openai' | 'anthropic' | 'google' | 'openrouter';

type SettingValue = string | number | boolean;

const INDEX_SETTING_KEYS = new Set([
  'indexEnabled',
  'indexAutoRefresh',
  'indexStorageMode',
  'indexRankingMode',
  'indexIncludeGlobs',
  'indexExcludeGlobs',
  'indexMaxFiles',
  'indexMaxFileSizeKb',
  'indexChunkChars',
  'indexChunkOverlap',
  'indexMaxResults',
  'indexStaleMs',
  'indexEmbeddingEnabled',
  'indexEmbeddingProvider',
  'indexEmbeddingAutoSelect',
  'indexEmbeddingEndpoint',
  'indexEmbeddingModel',
  'indexEmbeddingBatchSize',
  'indexEmbeddingWeight'
]);

const TOOL_SETTING_KEYS = new Set([
  'toolListDirEnabled',
  'toolFileSearchEnabled',
  'toolGrepSearchEnabled',
  'toolReadFileEnabled',
  'toolDiagnosticsEnabled',
  'toolWorkspaceIndexSearchEnabled',
  'toolWorkspaceIndexRefreshEnabled',
  'toolEditFilesEnabled',
  'toolTerminalEnabled',
  'toolWebSearchEnabled',
  'toolWebFetchEnabled',
  'webSearchMaxResults',
  'webFetchMaxChars'
]);

export class SorexSettingsPanel {
  static currentPanel?: SorexSettingsPanel;
  private readonly panel: vscode.WebviewPanel;
  private readonly client: LmStudioClient;
  private initialFocusSent = false;

  static show(extensionUri: vscode.Uri, context: vscode.ExtensionContext, initialPage = 'providers') {
    if (SorexSettingsPanel.currentPanel) {
      SorexSettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      void SorexSettingsPanel.currentPanel.postState();
      void SorexSettingsPanel.currentPanel.focusPage(initialPage, true);
      return;
    }
    SorexSettingsPanel.currentPanel = new SorexSettingsPanel(extensionUri, context, initialPage);
  }

  private constructor(private readonly extensionUri: vscode.Uri, private readonly context: vscode.ExtensionContext, private readonly initialPage = 'providers') {
    this.client = new LmStudioClient(context);
    this.panel = vscode.window.createWebviewPanel(
      'sorexSettings',
      `${getExtensionDisplayName(context)} Settings`,
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true }
    );
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => SorexSettingsPanel.currentPanel = undefined);
    this.panel.webview.onDidReceiveMessage(async msg => {
      const config = getSorexConfig();
      try {
        if (msg.type === 'pollModels') {
          const models = await this.client.listLocalModels();
          const providerContextTokens = await this.detectProviderContextTokens();
          await this.panel.webview.postMessage({ type: 'modelsOnly', models, providerContextTokens });
          return;
        }
        if (msg.type === 'load' || msg.type === 'refreshModels' || msg.type === 'refreshEmbeddingModels') {
          await this.postState(msg.settings);
          if (msg.type === 'load' && !this.initialFocusSent) {
            this.initialFocusSent = true;
            await this.focusPage(this.initialPage, true);
          }
          return;
        }
        if (msg.type === 'refreshIndex') {
          await vscode.commands.executeCommand('sorex.refreshIndex', false);
          await this.postState();
          return;
        }
        if (msg.type === 'openUserSettingsJson') {
          await openSorexSettingsJson(this.context);
          return;
        }
        if (msg.type === 'save') {
          const s = msg.settings ?? {};
          const has = (key: string) => Object.prototype.hasOwnProperty.call(s, key);
          const indexSettingsChanged = [...INDEX_SETTING_KEYS].some(key => has(key));

          const updateString = async (key: string) => { if (has(key)) await config.update(key, String(s[key] ?? '')); };
          const updateNumber = async (key: string) => { if (has(key)) await config.update(key, Number(s[key])); };
          const updateBool = async (key: string) => { if (has(key)) await config.update(key, Boolean(s[key])); };

          await updateString('providerMode');
          await updateString('endpoint');
          await updateString('model');
          await updateString('openaiEndpoint');
          await updateString('openaiModel');
          await updateString('anthropicEndpoint');
          await updateString('anthropicModel');
          await updateString('googleEndpoint');
          await updateString('googleModel');
          await updateString('openrouterEndpoint');
          await updateString('openrouterModel');
          await updateNumber('maxInputTokens');
          await updateNumber('maxOutputTokens');
          await updateNumber('temperature');
          await updateNumber('compactAtPercent');
          await updateBool('autoCompactEnabled');
          await updateNumber('maxUserMessageChars');
          await updateBool('preferLocalModels');
          await updateNumber('maxToolRounds');
          await updateBool('nativeToolCallingEnabled');
          await updateBool('conservativeToolCalling');
          await updateBool('indexEnabled');
          await updateBool('indexAutoRefresh');
          await updateString('indexStorageMode');
          await updateString('indexRankingMode');
          await updateString('indexIncludeGlobs');
          await updateString('indexExcludeGlobs');
          await updateNumber('indexMaxFiles');
          await updateNumber('indexMaxFileSizeKb');
          await updateNumber('indexChunkChars');
          await updateNumber('indexChunkOverlap');
          await updateNumber('indexMaxResults');
          await updateNumber('indexStaleMs');
          await updateBool('indexEmbeddingEnabled');
          await updateString('indexEmbeddingProvider');
          await updateBool('indexEmbeddingAutoSelect');
          await updateString('indexEmbeddingEndpoint');
          await updateString('indexEmbeddingModel');
          await updateNumber('indexEmbeddingBatchSize');
          await updateNumber('indexEmbeddingWeight');
          await updateBool('includeToolSchemaInContextBudget');
          await updateNumber('contextSafetyTokens');
          await updateNumber('webSearchMaxResults');
          await updateNumber('webFetchMaxChars');
          for (const key of TOOL_SETTING_KEYS) {
            if (key.startsWith('tool')) await updateBool(key);
          }

          const providerMode = String(s.providerMode || config.get('providerMode', 'lmstudio')) as ProviderMode;
          if (has('apiKey') && String(s.apiKey || '').trim()) await this.client.setCloudApiKey(providerMode, String(s.apiKey));
          if (has('clearApiKey') && Boolean(s.clearApiKey)) await this.client.clearCloudApiKey(providerMode);
          if (has('indexEmbeddingApiKey') && String(s.indexEmbeddingApiKey || '').trim()) await this.client.setIndexEmbeddingApiKey(String(s.indexEmbeddingApiKey));
          if (has('clearIndexEmbeddingApiKey') && Boolean(s.clearIndexEmbeddingApiKey)) await this.client.clearIndexEmbeddingApiKey();

          const activeModel = activeModelFor(providerMode, s, config);
          if (activeModel) await config.update('model', activeModel);

          await this.postState();
          await vscode.commands.executeCommand('sorex.refreshModels');
          setTimeout(() => void vscode.commands.executeCommand('sorex.refreshModels'), 160);
          await vscode.window.showInformationMessage(`${this.extensionDisplayName()} settings saved.`);
          if (indexSettingsChanged && Boolean(s.indexEnabled ?? config.get('indexEnabled', false)) && Boolean(s.indexAutoRefresh ?? config.get('indexAutoRefresh', false))) {
            void vscode.commands.executeCommand('sorex.refreshIndex', true);
          }
        }
      } catch (err) {
        await vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
        await this.postState();
      }
    });
  }

  private extensionDisplayName(): string {
    return getExtensionDisplayName(this.context);
  }

  private async postState(overrideSettings?: Record<string, SettingValue>) {
    const config = getSorexConfig();
    const models = await this.client.listLocalModels();
    const providerContextTokens = await this.detectProviderContextTokens(overrideSettings);
    if (!overrideSettings && providerContextTokens && Number(config.get('maxInputTokens', 32768)) !== providerContextTokens) {
      await config.update('maxInputTokens', providerContextTokens);
    }
    const embeddingProvider = String(overrideSettings?.indexEmbeddingProvider ?? config.get('indexEmbeddingProvider', 'active') ?? 'active');
    const embeddingEndpoint = String(overrideSettings?.indexEmbeddingEndpoint ?? config.get('indexEmbeddingEndpoint', '') ?? '');
    const activeProvider = String(config.get('providerMode', 'lmstudio'));
    const resolvedEmbeddingProvider = embeddingProvider === 'active' ? activeProvider : embeddingProvider;
    const embeddingIsCloud = ['openai', 'anthropic', 'google', 'openrouter'].includes(resolvedEmbeddingProvider);
    await this.panel.webview.postMessage({
      type: 'state',
      appName: this.extensionDisplayName(),
      settings: {
        providerMode: config.get('providerMode', 'lmstudio'),
        endpoint: config.get('endpoint', 'http://localhost:1234/v1'),
        model: config.get('model', ''),
        openaiEndpoint: config.get('openaiEndpoint', 'https://api.openai.com/v1'),
        openaiModel: config.get('openaiModel', ''),
        anthropicEndpoint: config.get('anthropicEndpoint', 'https://api.anthropic.com/v1'),
        anthropicModel: config.get('anthropicModel', ''),
        googleEndpoint: config.get('googleEndpoint', 'https://generativelanguage.googleapis.com/v1beta/openai'),
        googleModel: config.get('googleModel', ''),
        openrouterEndpoint: config.get('openrouterEndpoint', 'https://openrouter.ai/api/v1'),
        openrouterModel: config.get('openrouterModel', ''),
        maxInputTokens: providerContextTokens || config.get('maxInputTokens', 32768),
        maxOutputTokens: config.get('maxOutputTokens', 4096),
        temperature: config.get('temperature', 0.15),
        compactAtPercent: config.get('compactAtPercent', 90),
        autoCompactEnabled: config.get('autoCompactEnabled', true),
        maxUserMessageChars: config.get('maxUserMessageChars', 24000),
        preferLocalModels: config.get('preferLocalModels', true),
        maxToolRounds: config.get('maxToolRounds', 8),
        nativeToolCallingEnabled: config.get('nativeToolCallingEnabled', true),
        conservativeToolCalling: config.get('conservativeToolCalling', false),
        indexEnabled: config.get('indexEnabled', false),
        indexAutoRefresh: config.get('indexAutoRefresh', false),
        indexStorageMode: config.get('indexStorageMode', 'folder-json-vectors'),
        indexRankingMode: config.get('indexRankingMode', 'hybrid'),
        indexIncludeGlobs: config.get('indexIncludeGlobs', ''),
        indexExcludeGlobs: config.get('indexExcludeGlobs', ''),
        indexMaxFiles: config.get('indexMaxFiles', 6000),
        indexMaxFileSizeKb: config.get('indexMaxFileSizeKb', 384),
        indexChunkChars: config.get('indexChunkChars', 2200),
        indexChunkOverlap: config.get('indexChunkOverlap', 220),
        indexMaxResults: config.get('indexMaxResults', 16),
        indexStaleMs: config.get('indexStaleMs', 120000),
        indexEmbeddingEnabled: config.get('indexEmbeddingEnabled', true),
        indexEmbeddingProvider: embeddingProvider,
        indexEmbeddingAutoSelect: config.get('indexEmbeddingAutoSelect', true),
        indexEmbeddingEndpoint: embeddingEndpoint,
        indexEmbeddingModel: config.get('indexEmbeddingModel', ''),
        indexEmbeddingBatchSize: config.get('indexEmbeddingBatchSize', 12),
        indexEmbeddingWeight: config.get('indexEmbeddingWeight', 32),
        includeToolSchemaInContextBudget: config.get('includeToolSchemaInContextBudget', true),
        contextSafetyTokens: config.get('contextSafetyTokens', 1024),
        webSearchMaxResults: config.get('webSearchMaxResults', 5),
        webFetchMaxChars: config.get('webFetchMaxChars', 12000),
        toolListDirEnabled: config.get('toolListDirEnabled', true),
        toolFileSearchEnabled: config.get('toolFileSearchEnabled', true),
        toolGrepSearchEnabled: config.get('toolGrepSearchEnabled', true),
        toolReadFileEnabled: config.get('toolReadFileEnabled', true),
        toolDiagnosticsEnabled: config.get('toolDiagnosticsEnabled', true),
        toolWorkspaceIndexSearchEnabled: config.get('toolWorkspaceIndexSearchEnabled', true),
        toolWorkspaceIndexRefreshEnabled: config.get('toolWorkspaceIndexRefreshEnabled', true),
        toolEditFilesEnabled: config.get('toolEditFilesEnabled', true),
        toolTerminalEnabled: config.get('toolTerminalEnabled', true),
        toolWebSearchEnabled: config.get('toolWebSearchEnabled', true),
        toolWebFetchEnabled: config.get('toolWebFetchEnabled', true)
      },
      apiKeys: {
        openai: await this.client.hasCloudApiKey('openai'),
        anthropic: await this.client.hasCloudApiKey('anthropic'),
        google: await this.client.hasCloudApiKey('google'),
        openrouter: await this.client.hasCloudApiKey('openrouter'),
        indexEmbedding: await this.client.hasIndexEmbeddingApiKey()
      },
      apiKeyValues: {
        openai: await this.client.getCloudApiKey('openai'),
        anthropic: await this.client.getCloudApiKey('anthropic'),
        google: await this.client.getCloudApiKey('google'),
        openrouter: await this.client.getCloudApiKey('openrouter')
      },
      cloudModels: {
        openai: cloudModelsFor('openai'),
        anthropic: cloudModelsFor('anthropic'),
        google: cloudModelsFor('google'),
        openrouter: cloudModelsFor('openrouter')
      },
      embeddingModels: embeddingIsCloud ? [] : await this.client.listEmbeddingModels({ provider: embeddingProvider, endpoint: embeddingEndpoint }),
      models,
      providerContextTokens
    });
  }

  private async detectProviderContextTokens(overrideSettings?: Record<string, SettingValue>): Promise<number | undefined> {
    const config = getSorexConfig();
    const providerMode = String(overrideSettings?.providerMode ?? config.get('providerMode', 'lmstudio')) as ProviderMode;
    const model = activeModelFor(providerMode, overrideSettings || {}, config);
    if (!model) return undefined;
    try {
      return await this.client.providerContextTokens(providerMode, model);
    } catch {
      return undefined;
    }
  }

  private async focusPage(page: string, explicit = false): Promise<void> {
    await this.panel.webview.postMessage({ type: 'focusPage', page, explicit });
  }

  private html(): string {
    const nonce = getNonce();
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Settings</title>
<style>${settingsPanelStyles}</style>
</head>
<body>
<div class="shell">
  <nav class="nav"><div class="brand" data-app-name>SOREX</div><button class="tab" data-page="providers">Providers</button><button class="tab" data-page="context">Context</button><button class="tab" data-page="indexing">Indexing</button><button class="tab" data-page="tooling">Tooling</button><button class="tab" data-page="agent">Agent</button><button class="json-link" id="openUserSettingsJson" title="Open user settings.json">Edit settings.json</button></nav>
  <main class="main">
    <section id="providers" class="page"><div class="hero"><div class="title">Providers</div><div class="sub">Configure the model provider <span data-app-name>SOREX</span> uses for chat and tool-calling.</div></div><div class="panel"><div><h2>Active provider</h2><label>Provider</label><select id="providerMode"><option value="lmstudio">LM Studio</option><option value="ollama">Ollama</option><option value="jan">Jan</option><option value="custom">Custom OpenAI-compatible</option><option value="openai">OpenAI API</option><option value="anthropic">Anthropic API</option><option value="google">Google Gemini API</option><option value="openrouter">OpenRouter API</option></select><div id="providerHint" class="hint"></div><div id="localProviderFields" class="provider-only"><label>Endpoint</label><input id="endpoint"><label>Model</label><select id="model"><option value="">No local models detected</option></select></div><div id="cloudProviderFields" class="provider-only"><h2 id="cloudTitle">Cloud</h2><label id="cloudEndpointLabel">Endpoint</label><input id="cloudEndpoint"><label id="cloudModelLabel">Model</label><select id="cloudModelSelect"></select><label>Custom model override</label><input id="cloudModelCustom"><label id="apiKeyLabel">API key</label><div class="secret-wrap"><input id="apiKey" type="password" placeholder="Paste only to set/replace"><input id="clearApiKey" type="hidden" value=""><button class="secret-action change-inline" id="changeProviderInfo" type="button" title="Change saved provider info">Change</button><button id="clearApiKeyButton" class="secret-action clear-key-btn" type="button" title="Clear saved API key"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button><button id="toggleApiKeyVisible" class="secret-action eye-btn" type="button" title="Show or hide API key"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button></div><div id="apiStatus" class="api-status"></div></div></div></div></section>
    <section id="context" class="page"><div class="hero"><div class="title">Context</div><div class="sub">Controls the visible context meter, compaction trigger, and token safety reserve.</div></div><div class="panel"><div class="section"><h2>Token budget</h2><label>Max input tokens</label><input id="maxInputTokens" type="number" min="2048" step="1024"><label>Max output tokens</label><input id="maxOutputTokens" type="number" min="256" step="256"><label>Context safety tokens</label><input id="contextSafetyTokens" type="number" min="0" step="128"></div><div class="section"><h2>Compaction</h2><div class="toggle-row"><input id="autoCompactEnabled" type="checkbox"><label for="autoCompactEnabled">Auto compact conversation</label></div><label>Auto compact at percent</label><input id="compactAtPercent" type="number" min="35" max="95" step="1"><label>Max single message chars</label><input id="maxUserMessageChars" type="number" min="4000" max="200000" step="1000"><div class="toggle-row"><input id="includeToolSchemaInContextBudget" type="checkbox"><label for="includeToolSchemaInContextBudget">Count tool schema in budget</label></div><div class="hint">The ring shows real conversation context. The compaction trigger also accounts for output reserve, safety reserve, and tool schema overhead.</div></div></div></section>
    <section id="indexing" class="page"><div class="hero"><div class="title">Indexing</div><div class="sub">Workspace indexing gives <span data-app-name>SOREX</span> fast repo recall and persists this repo cache to the .ai-index/ folder. If vector/hybrid mode is enabled, select or auto-detect an embedding model before auto-indexing starts.</div></div><div class="panel"><div class="section"><h2>Embedding model</h2><div class="toggle-row"><input id="indexEmbeddingEnabled" type="checkbox"><label for="indexEmbeddingEnabled">Use real embedding vectors for semantic repo recall</label></div><div class="toggle-row" id="indexEmbeddingAutoRow"><input id="indexEmbeddingAutoSelect" type="checkbox"><label for="indexEmbeddingAutoSelect">Auto-select detected embedding model when blank</label></div><label>Embedding provider</label><select id="indexEmbeddingProvider"><option value="active">Use active provider</option><option value="lmstudio">LM Studio</option><option value="ollama">Ollama</option><option value="jan">Jan</option><option value="custom">Custom OpenAI-compatible</option><option value="openai">OpenAI</option><option value="google">Google Gemini</option><option value="openrouter">OpenRouter</option></select><div id="indexEmbeddingDetectedWrap"><label>Detected embedding model</label><select id="indexEmbeddingModelSelect"><option value="">Auto / no detected model</option></select></div><div id="indexEmbeddingManualWrap"><label>Embedding model</label><input id="indexEmbeddingModel" placeholder="Enter embedding model id"></div><div id="indexEmbeddingEndpointWrap"><label>Embedding endpoint</label><input id="indexEmbeddingEndpoint" placeholder="Blank = selected embedding provider endpoint"></div><div class="row" id="refreshEmbeddingModelsWrap"><button class="secondary" id="refreshEmbeddingModels">Refresh embedding models</button></div><div class="field-row"><div><label>Embedding batch size</label><input id="indexEmbeddingBatchSize" type="number" min="1" max="64" step="1"></div><div><label>Semantic ranking weight</label><input id="indexEmbeddingWeight" type="number" min="5" max="80" step="1"></div></div><label>Embedding API key</label><input id="indexEmbeddingApiKey" type="password" placeholder="Optional separate embedding key"><div class="toggle-row"><input id="clearIndexEmbeddingApiKey" type="checkbox"><label for="clearIndexEmbeddingApiKey">Clear saved embedding key</label></div><div id="embeddingApiStatus" class="api-status"></div><div class="hint">Hybrid/vector indexing waits for a real embedding model. Switch Ranking mode to Lexical only if you want indexing without embeddings.</div></div><div class="section"><h2>Index control</h2><div class="toggle-row"><input id="indexEnabled" type="checkbox"><label for="indexEnabled">Enable workspace index</label></div><div class="toggle-row"><input id="indexAutoRefresh" type="checkbox"><label for="indexAutoRefresh">Auto index when stale, files change, or settings change</label></div><label>Index storage</label><select id="indexStorageMode"><option value="folder-json-vectors">.ai-index folder with chunks + vectors</option><option value="folder-json">.ai-index folder JSON</option><option value="memory-only">Memory only</option></select><label>Ranking mode</label><select id="indexRankingMode"><option value="hybrid">Hybrid lexical + vector</option><option value="lexical">Lexical only</option><option value="vector">Vector first</option></select><div class="row"><button class="secondary" id="refreshIndexNow">Refresh index now</button></div><div class="hint">The durable repo cache is .ai-index/ in the workspace root. It stores manifest.json, repo-map.json, chunks.json, and vectors.json when embeddings are available.</div></div><div class="section"><h2>File selection</h2><label>Include glob</label><input id="indexIncludeGlobs" placeholder="Blank = built-in source file defaults"><label>Exclude glob</label><input id="indexExcludeGlobs" placeholder="Blank = generated folders excluded"><div class="field-row"><div><label>Max files</label><input id="indexMaxFiles" type="number" min="50" max="100000" step="50"></div><div><label>Max file size KB</label><input id="indexMaxFileSizeKb" type="number" min="8" max="8192" step="8"></div></div></div><div class="section"><h2>Chunking and freshness</h2><div class="field-row"><div><label>Chunk size chars</label><input id="indexChunkChars" type="number" min="500" max="12000" step="100"></div><div><label>Chunk overlap chars</label><input id="indexChunkOverlap" type="number" min="0" max="2000" step="25"></div></div><div class="field-row"><div><label>Default result count</label><input id="indexMaxResults" type="number" min="1" max="50" step="1"></div><div><label>Index stale ms</label><input id="indexStaleMs" type="number" min="15000" step="5000"></div></div></div></div></section>
    <section id="tooling" class="page"><div class="hero"><div class="title">Tooling</div><div class="sub">Customize which tools the agent can see. Turning a tool off removes it from the model tool schema and blocks execution.</div></div><div class="panel"><div class="section"><h2>Tool calling</h2><div class="toggle-row"><input id="nativeToolCallingEnabled" type="checkbox" role="switch"><label for="nativeToolCallingEnabled">Native tool calling</label><div class="hint"><span data-app-name>SOREX</span> falls back to text tool calls for models that handle native tools poorly.</div></div></div><div class="section"><h2>Workspace tools</h2><div class="tool-grid"><div class="toggle-row"><input id="toolListDirEnabled" type="checkbox"><label for="toolListDirEnabled">list_dir</label></div><div class="toggle-row"><input id="toolFileSearchEnabled" type="checkbox"><label for="toolFileSearchEnabled">file_search</label></div><div class="toggle-row"><input id="toolGrepSearchEnabled" type="checkbox"><label for="toolGrepSearchEnabled">grep_search</label></div><div class="toggle-row"><input id="toolReadFileEnabled" type="checkbox"><label for="toolReadFileEnabled">read_file</label></div><div class="toggle-row"><input id="toolDiagnosticsEnabled" type="checkbox"><label for="toolDiagnosticsEnabled">get_errors</label></div><div class="toggle-row"><input id="toolTerminalEnabled" type="checkbox"><label for="toolTerminalEnabled">run_in_terminal</label></div><div class="toggle-row"><input id="toolEditFilesEnabled" type="checkbox"><label for="toolEditFilesEnabled">file edit/write tools</label></div></div></div><div class="section"><h2>Index tools</h2><div class="tool-grid"><div class="toggle-row"><input id="toolWorkspaceIndexSearchEnabled" type="checkbox"><label for="toolWorkspaceIndexSearchEnabled">workspace_index_search</label></div><div class="toggle-row"><input id="toolWorkspaceIndexRefreshEnabled" type="checkbox"><label for="toolWorkspaceIndexRefreshEnabled">workspace_index_refresh</label></div></div></div><div class="section"><h2>Web tools</h2><div class="tool-grid"><div class="toggle-row"><input id="toolWebSearchEnabled" type="checkbox"><label for="toolWebSearchEnabled">web_search</label></div><div class="toggle-row"><input id="toolWebFetchEnabled" type="checkbox"><label for="toolWebFetchEnabled">web_fetch</label></div></div><label>Search result count</label><input id="webSearchMaxResults" type="number" min="1" max="10" step="1"><label>Fetch max chars</label><input id="webFetchMaxChars" type="number" min="1000" max="40000" step="1000"><div class="hint">Uses DuckDuckGo HTML search and direct fetch. No paid key. Use it only for current public coding docs/errors.</div></div></div></section>
    <section id="agent" class="page"><div class="hero"><div class="title">Agent</div><div class="sub">Controls model sampling and the model/tool loop.</div></div><div class="panel"><div class="section"><h2>Generation</h2><label>Temperature</label><input id="temperature" type="number" min="0" max="2" step="0.05"><div class="toggle-row"><input id="preferLocalModels" type="checkbox"><label for="preferLocalModels">Prefer local models</label></div></div><div class="section"><h2>Tool loop</h2><label>Max tool rounds</label><input id="maxToolRounds" type="number" min="1" max="24" step="1"><div class="toggle-row"><input id="conservativeToolCalling" type="checkbox"><label for="conservativeToolCalling">Conservative tool calling</label></div><div class="hint">Reduces tool calls and pauses earlier.</div></div></div></section>
    <div id="savebar" class="savebar"><span class="dirty">Unsaved settings</span><div class="row"><button class="secondary" id="discard">Discard</button><button class="primary" id="save">Save settings</button></div></div>
  </main>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ids = ['providerMode','endpoint','model','maxInputTokens','maxOutputTokens','temperature','compactAtPercent','autoCompactEnabled','maxUserMessageChars','preferLocalModels','maxToolRounds','nativeToolCallingEnabled','conservativeToolCalling','openaiEndpoint','openaiModel','anthropicEndpoint','anthropicModel','googleEndpoint','googleModel','openrouterEndpoint','openrouterModel','indexEnabled','indexAutoRefresh','indexStorageMode','indexRankingMode','indexIncludeGlobs','indexExcludeGlobs','indexMaxFiles','indexMaxFileSizeKb','indexChunkChars','indexChunkOverlap','indexMaxResults','indexStaleMs','indexEmbeddingEnabled','indexEmbeddingProvider','indexEmbeddingAutoSelect','indexEmbeddingEndpoint','indexEmbeddingModel','indexEmbeddingBatchSize','indexEmbeddingWeight','includeToolSchemaInContextBudget','contextSafetyTokens','webSearchMaxResults','webFetchMaxChars','toolListDirEnabled','toolFileSearchEnabled','toolGrepSearchEnabled','toolReadFileEnabled','toolDiagnosticsEnabled','toolWorkspaceIndexSearchEnabled','toolWorkspaceIndexRefreshEnabled','toolEditFilesEnabled','toolTerminalEnabled','toolWebSearchEnabled','toolWebFetchEnabled'];
let baseline = {};
let cloudModels = {openai:[],anthropic:[],google:[],openrouter:[]};
let localModels = [];
let embeddingModels = [];
let apiKeys = {openai:false,anthropic:false,google:false,openrouter:false,indexEmbedding:false};
let apiKeyValues = {openai:'',anthropic:'',google:'',openrouter:''};
let providerEditMode = false;
let providerValues = {};
let appName = 'SOREX';
let savedState = vscode.getState() || {};
let activePage = savedState.activePage || 'providers';
let scrollByPage = savedState.scrollByPage || {};
let userPageTouchedAt = 0;
function el(id){return document.getElementById(id)}
function setAppName(name){appName=String(name||'SOREX').trim()||'SOREX';document.title=appName+' Settings';document.querySelectorAll('[data-app-name]').forEach(x=>x.textContent=appName);}
function persistState(){vscode.setState({activePage,scrollByPage})}
function providerName(v){return ({lmstudio:'LM Studio',ollama:'Ollama',jan:'Jan',custom:'OpenAI-compatible',openai:'OpenAI',anthropic:'Anthropic',google:'Google',openrouter:'OpenRouter'})[v]||'Provider'}
function defaultEndpoint(v){return ({openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',google:'https://generativelanguage.googleapis.com/v1beta/openai',openrouter:'https://openrouter.ai/api/v1'})[v]||''}
function isCloud(v){return ['openai','anthropic','google','openrouter'].includes(v)}
function embeddingProviderMode(){const p=String(el('indexEmbeddingProvider')?.value||'active');return p==='active'?String(el('providerMode')?.value||'lmstudio'):p}
function embeddingProviderIsCloud(){return isCloud(embeddingProviderMode())}
function modelKey(p){return p+'Model'}
function endpointKey(p){return p+'Endpoint'}
function getVal(id){const x=el(id);if(!x)return '';if(x.type==='checkbox')return !!x.checked;if(x.type==='hidden'&&id==='clearApiKey')return x.value==='true';return x.value}
function setVal(id,v){const x=el(id);if(!x)return;if(x.type==='checkbox')x.checked=!!v;else if(x.type==='hidden'&&id==='clearApiKey')x.value=v?'true':'';else x.value=v??''}
function providerFieldsLocked(){const p=el('providerMode')?.value||'lmstudio';return isCloud(p)&&apiKeys[p]&&!providerEditMode}
function setProviderEditMode(on){providerEditMode=!!on;const locked=providerFieldsLocked();['cloudEndpoint','cloudModelSelect','cloudModelCustom'].forEach(id=>{const x=el(id);if(x){x.disabled=false;x.classList.remove('field-disabled');}});const key=el('apiKey');if(key){key.disabled=locked;key.classList.toggle('field-disabled',locked);}if(el('cloudProviderFields'))el('cloudProviderFields').classList.toggle('provider-editing',!locked);if(el('changeProviderInfo'))el('changeProviderInfo').textContent=locked?'Change':'Done';}
function collect(){const s={...providerValues};for(const id of ids)if(el(id))s[id]=getVal(id);const p=s.providerMode||'lmstudio';if(isCloud(p)){s[endpointKey(p)]=el('cloudEndpoint').value||defaultEndpoint(p);s[modelKey(p)]=p==='openrouter'?el('cloudModelCustom').value.trim():(el('cloudModelCustom').value.trim()||el('cloudModelSelect').value);providerValues[endpointKey(p)]=s[endpointKey(p)];providerValues[modelKey(p)]=s[modelKey(p)];s.apiKey=el('apiKey').value;s.clearApiKey=getVal('clearApiKey');}if(embeddingProviderIsCloud()){s.indexEmbeddingModel=String(el('indexEmbeddingModel')?.value||'').trim();s.indexEmbeddingEndpoint='';}else{s.indexEmbeddingModel=el('indexEmbeddingModelSelect')?.value||'';}s.indexEmbeddingApiKey=el('indexEmbeddingApiKey')?.value||'';s.clearIndexEmbeddingApiKey=!!el('clearIndexEmbeddingApiKey')?.checked;return s}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function stripTransient(s){const c={...s};delete c.apiKey;delete c.clearApiKey;delete c.indexEmbeddingApiKey;delete c.clearIndexEmbeddingApiKey;return c}
function markDirty(){const now=collect();const p=now.providerMode||'lmstudio';const apiChanged=isCloud(p)&&providerEditMode&&String(now.apiKey||'')!==String(apiKeyValues[p]||'');const dirty=!equal(stripTransient(now),stripTransient(baseline))||apiChanged||!!getVal('clearApiKey')||!!el('indexEmbeddingApiKey')?.value||!!el('clearIndexEmbeddingApiKey')?.checked;el('savebar').classList.toggle('visible',dirty)}
function focusPage(page, explicit=false){scrollByPage[activePage]=window.scrollY;const target=el(page)||el(activePage)||el('providers');activePage=target.id;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.page===activePage));document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p===target));persistState();requestAnimationFrame(()=>{window.scrollTo(0, explicit?0:(scrollByPage[activePage]||0));});}
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{userPageTouchedAt=Date.now();focusPage(btn.dataset.page,false);});
window.addEventListener('scroll',()=>{scrollByPage[activePage]=window.scrollY;persistState()},{passive:true});
function applyProviderContextTokens(tokens){const n=Number(tokens||0);if(!Number.isFinite(n)||n<2048)return false;const input=el('maxInputTokens');if(!input)return false;const next=String(Math.round(n));if(String(input.value||'')!==next){input.value=next;markDirty();return true;}return false;}
function updateEmbeddingProviderFields(){const cloud=embeddingProviderIsCloud();[['indexEmbeddingAutoRow',!cloud],['indexEmbeddingDetectedWrap',!cloud],['indexEmbeddingEndpointWrap',!cloud],['refreshEmbeddingModelsWrap',!cloud],['indexEmbeddingManualWrap',cloud]].forEach(([id,on])=>{const x=el(id);if(x)x.style.display=on?'':'none';});const auto=el('indexEmbeddingAutoSelect');if(auto)auto.disabled=cloud;const detected=el('indexEmbeddingModelSelect');if(detected)detected.disabled=cloud;const manual=el('indexEmbeddingModel');if(manual)manual.disabled=!cloud;const endpoint=el('indexEmbeddingEndpoint');if(endpoint)endpoint.disabled=cloud;}
function updateEmbeddingModelSelect(selected){const sel=el('indexEmbeddingModelSelect');if(!sel)return;sel.textContent='';const empty=document.createElement('option');empty.value='';empty.textContent='Auto / no detected model';sel.appendChild(empty);for(const m of embeddingModels||[]){const o=document.createElement('option');o.value=m.id;o.textContent=m.name||m.id;sel.appendChild(o);}const current=String(selected||getVal('indexEmbeddingModel')||'').trim();if(current&&![...sel.options].some(o=>o.value===current)){const o=document.createElement('option');o.value=current;o.textContent=current+' (saved)';sel.appendChild(o);}sel.value=current&&[...sel.options].some(o=>o.value===current)?current:'';}
function modelSignature(models){return (Array.isArray(models)?models:[]).map(m=>String((m&&(m.id||m.name))||'').trim()).filter(Boolean).sort().join('\\n')}
function updateLocalModelSelect(models, selected){const select=el('model');if(!select)return;localModels=Array.isArray(models)?models:[];select.textContent='';const list=localModels;const current=String(selected||'').trim();if(!list.length){const o=document.createElement('option');o.value=current;o.textContent=current?current+' (saved)':'No local models detected';select.appendChild(o);select.disabled=!current;return;}select.disabled=false;for(const m of list){const id=String(m.id||m.name||'').trim();if(!id)continue;const o=document.createElement('option');o.value=id;o.textContent=m.name||id;select.appendChild(o);}if(current&&![...select.options].some(o=>o.value===current)){const o=document.createElement('option');o.value=current;o.textContent=current+' (saved)';select.appendChild(o);}if(current)select.value=current;}
function refreshLocalModelsIfChanged(models){if(modelSignature(models)===modelSignature(localModels))return;updateLocalModelSelect(models,getVal('model'));markDirty();}
function updateProviderFields(){const p=el('providerMode')?.value||'lmstudio';const cloud=isCloud(p);el('localProviderFields').classList.toggle('active',!cloud);el('cloudProviderFields').classList.toggle('active',cloud);const hint=el('providerHint');hint.textContent=cloud?('Configure '+providerName(p)+' API key, endpoint, and model.'):(appName+' will call the selected local OpenAI-compatible endpoint.');if(!cloud){markDirty();return;}el('cloudTitle').textContent=providerName(p);el('cloudEndpointLabel').textContent=providerName(p)+' endpoint';el('apiKeyLabel').textContent=providerName(p)+' API key';el('cloudModelLabel').textContent=providerName(p)+' model';el('cloudEndpoint').value=providerValues[endpointKey(p)]||getVal(endpointKey(p))||defaultEndpoint(p);const selected=providerValues[modelKey(p)]||getVal(modelKey(p));const select=el('cloudModelSelect');const custom=el('cloudModelCustom');const customLabel=custom?.previousElementSibling;const typedOnly=p==='openrouter';if(select){select.hidden=typedOnly;select.style.display=typedOnly?'none':'';}if(el('cloudModelLabel'))el('cloudModelLabel').style.display=typedOnly?'none':'';if(customLabel)customLabel.textContent=typedOnly?(providerName(p)+' model'):'Custom model override';select.textContent='';for(const id of (typedOnly?[]:(cloudModels[p]||[]))){const o=document.createElement('option');o.value=id;o.textContent=id;select.appendChild(o);}if(typedOnly){custom.value=selected||'';}else if(selected && [...select.options].some(o=>o.value===selected)){select.value=selected;custom.value='';}else{if(select.options.length)select.selectedIndex=0;custom.value=selected||'';}el('apiKey').value=apiKeyValues[p]||'';el('apiKey').type='password';setVal('clearApiKey',false);el('apiStatus')?.classList.remove('ok');if(apiKeys[p]&&!providerEditMode)providerEditMode=false;if(!apiKeys[p])providerEditMode=true;setProviderEditMode(providerEditMode);el('apiStatus').textContent=apiKeys[p]?'Saved provider info is loaded. Click Change to edit it.':'No API key saved yet.';markDirty();}
function setState(data){const y=window.scrollY;const pageBefore=activePage;setAppName(data.appName);const s=data.settings||{};providerValues={...s};cloudModels=data.cloudModels||cloudModels;embeddingModels=data.embeddingModels||embeddingModels;apiKeys=data.apiKeys||apiKeys;apiKeyValues=data.apiKeyValues||apiKeyValues;for(const id of ids)setVal(id,s[id]);setVal('clearApiKey',false);updateLocalModelSelect(data.models||[],s.model);updateProviderFields();updateEmbeddingModelSelect(s.indexEmbeddingModel);updateEmbeddingProviderFields();if(el('indexEmbeddingApiKey'))el('indexEmbeddingApiKey').value='';if(el('clearIndexEmbeddingApiKey'))el('clearIndexEmbeddingApiKey').checked=false;el('embeddingApiStatus').textContent=apiKeys.indexEmbedding?'Embedding API key saved. Paste a new key only to replace it.':'No separate embedding key saved. '+appName+' will use the provider key/local endpoint when possible.';baseline=stripTransient(collect());el('savebar').classList.remove('visible');focusPage(pageBefore,false);requestAnimationFrame(()=>window.scrollTo(0,y));}
function save(){vscode.postMessage({type:'save',settings:collect()});}
el('save').onclick=save;el('changeProviderInfo')?.addEventListener('click',()=>{setProviderEditMode(providerFieldsLocked());markDirty();});el('clearApiKeyButton')?.addEventListener('click',()=>{setVal('clearApiKey',true);if(el('apiKey'))el('apiKey').value='';const p=el('providerMode')?.value||'lmstudio';const status=el('apiStatus');if(status){status.classList.add('ok');status.textContent=providerName(p)+' API key will be cleared when you save.';}markDirty();});el('toggleApiKeyVisible')?.addEventListener('click',()=>{const input=el('apiKey');if(!input)return;input.type=input.type==='password'?'text':'password';});el('discard').onclick=()=>vscode.postMessage({type:'load'});el('openUserSettingsJson')?.addEventListener('click',()=>vscode.postMessage({type:'openUserSettingsJson'}));el('refreshIndexNow')?.addEventListener('click',()=>vscode.postMessage({type:'refreshIndex'}));el('refreshEmbeddingModels')?.addEventListener('click',()=>{if(!embeddingProviderIsCloud())vscode.postMessage({type:'refreshEmbeddingModels',settings:collect()});});
let embeddingRefreshTimer=0;function scheduleEmbeddingRefresh(){if(embeddingProviderIsCloud())return;clearTimeout(embeddingRefreshTimer);embeddingRefreshTimer=setTimeout(()=>vscode.postMessage({type:'refreshEmbeddingModels',settings:collect()}),350)}
for(const id of ids){el(id)?.addEventListener('input',()=>{if(id==='providerMode'){updateProviderFields();updateEmbeddingProviderFields();}else markDirty();if(id==='indexEmbeddingProvider'){updateEmbeddingProviderFields();markDirty();}if(id==='indexEmbeddingProvider'||id==='indexEmbeddingEndpoint')scheduleEmbeddingRefresh();});el(id)?.addEventListener('change',()=>{if(id==='providerMode'){updateProviderFields();updateEmbeddingProviderFields();}else markDirty();if(id==='indexEmbeddingProvider'){updateEmbeddingProviderFields();markDirty();}if(id==='indexEmbeddingProvider'||id==='indexEmbeddingEndpoint')scheduleEmbeddingRefresh();});}
['cloudEndpoint','cloudModelSelect','cloudModelCustom','apiKey','clearApiKey','changeProviderInfo','toggleApiKeyVisible','indexEmbeddingModelSelect','indexEmbeddingApiKey','clearIndexEmbeddingApiKey'].forEach(id=>{el(id)?.addEventListener('input',()=>{const p=el('providerMode')?.value||'lmstudio';if(id==='cloudEndpoint')providerValues[endpointKey(p)]=el('cloudEndpoint').value;if(id==='cloudModelCustom'||id==='cloudModelSelect')providerValues[modelKey(p)]=p==='openrouter'?el('cloudModelCustom').value.trim():(el('cloudModelCustom').value.trim()||el('cloudModelSelect').value);markDirty();});el(id)?.addEventListener('change',()=>{const p=el('providerMode')?.value||'lmstudio';if(id==='cloudEndpoint')providerValues[endpointKey(p)]=el('cloudEndpoint').value;if(id==='cloudModelCustom'||id==='cloudModelSelect')providerValues[modelKey(p)]=p==='openrouter'?el('cloudModelCustom').value.trim():(el('cloudModelCustom').value.trim()||el('cloudModelSelect').value);markDirty();});});
window.addEventListener('message',e=>{if(e.data.type==='state')setState(e.data);if(e.data.type==='modelsOnly'){refreshLocalModelsIfChanged(e.data.models||[]);applyProviderContextTokens(e.data.providerContextTokens);}if(e.data.type==='focusPage'){if(e.data.explicit&&Date.now()-userPageTouchedAt<900)return;focusPage(e.data.page||activePage,!!e.data.explicit);}});
setInterval(()=>{if(!document.hidden&&!isCloud(el('providerMode')?.value||'lmstudio'))vscode.postMessage({type:'pollModels'});},4500);
focusPage(activePage,false);
vscode.postMessage({type:'load'});
</script>
</body></html>`;
  }
}

function getExtensionDisplayName(context: vscode.ExtensionContext): string {
  const pkg = context.extension?.packageJSON ?? {};
  return String(pkg.displayName || pkg.name || 'SOREX').trim() || 'SOREX';
}

function activeModelFor(provider: ProviderMode, settings: any, config: SorexConfigLike): string {
  if (provider === 'openai') return String(settings.openaiModel || config.get('openaiModel', '') || settings.model || '').trim();
  if (provider === 'anthropic') return String(settings.anthropicModel || config.get('anthropicModel', '') || settings.model || '').trim();
  if (provider === 'google') return String(settings.googleModel || config.get('googleModel', '') || settings.model || '').trim();
  if (provider === 'openrouter') return normalizeOpenRouterModel(String(settings.openrouterModel || config.get('openrouterModel', '') || settings.model || '').trim());
  return String(settings.model || config.get('model', '') || '').trim();
}

function normalizeOpenRouterModel(model: string): string {
  const clean = String(model || '').trim();
  if (!clean) return '';
  const aliases: Record<string, string> = {
    'qwen3-coder:free': 'qwen/qwen3-coder:free',
    'qwen3-coder': 'qwen/qwen3-coder',
    'qwen3-coder-next': 'qwen/qwen3-coder-next',
    'qwen3-coder-flash': 'qwen/qwen3-coder-flash',
    'qwen3-coder-plus': 'qwen/qwen3-coder-plus',
    'free': 'openrouter/free'
  };
  return aliases[clean.toLowerCase()] || clean;
}

function cloudModelsFor(provider: string): string[] {
  switch (provider) {
    case 'openai': return ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'];
    case 'anthropic': return ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'];
    case 'google': return ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    case 'openrouter': return ['qwen/qwen3-coder:free', 'qwen/qwen3-coder', 'openai/gpt-4.1', 'openai/gpt-4.1-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001'];
    default: return [];
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
