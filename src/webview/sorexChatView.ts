import * as vscode from 'vscode';
import { getSorexConfig } from '../config/sorexConfig';
import { LmStudioClient, SorexMessage } from '../llm/lmStudioClient';
import { SorexWorkspaceTools } from '../tools/vscodeTools';
import { SOREX_SYSTEM_PROMPT } from '../prompts/sorexbrain';
import { SOREX_ASK_PROMPT, SOREX_EDIT_PROMPT, SOREX_EXPLORE_PROMPT, SOREX_PLAN_PROMPT } from '../prompts/sorexAgentModes';
import { getHtml } from './webviewHtml';

interface EditSnapshot {
  editId: string;
  filePath: string;
  uri: string;
  title: string;
  beforeExists: boolean;
  afterExists: boolean;
  beforeText: string;
  afterText: string;
  added: number;
  removed: number;
}

interface EditSession {
  id: string;
  createdAt: number;
  snapshots: EditSnapshot[];
  undone?: boolean;
}

export class SorexChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'sorex.chatView';
  private view?: vscode.WebviewView;
  private readonly client: LmStudioClient;
  private readonly messages: SorexMessage[] = [{ role: 'system', content: SOREX_SYSTEM_PROMPT }];
  private mode: 'agent' | 'ask' | 'edit' | 'plan' | 'explore' = 'agent';
  private permissionMode: 'ask' | 'auto' | 'autonomous' | 'manual' = 'ask';
  private pendingToolApprovals = new Map<string, (allowed: boolean) => void>();
  private pendingUiSpeech = new Map<string, () => void>();
  private activeAbort?: AbortController;
  private stopRequested = false;
  private lastAutoCompactSignature = '';
  private lastAutoCompactAt = 0;
  private lastRuntimeTokensPerSecond = 0;
  private providerContextTokens?: number;
  private providerContextSignature = '';
  private compactPromise?: Promise<boolean>;
  private activeRunPromise?: Promise<void>;
  private responseFeedback: string[] = [];
  private editSessions = new Map<string, EditSession>();
  private activeSessionId = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly tools: SorexWorkspaceTools,
    private readonly context: vscode.ExtensionContext
  ) {
    this.client = new LmStudioClient(context);
    this.restoreRepoChatSettings();
    this.restoreResponseFeedback();
    this.context.subscriptions.push(this.tools.onDidChangeIndexStatus(() => this.postIndexStatus()));
  }

  private repoStateKey(): string {
    const folders = vscode.workspace.workspaceFolders || [];
    const root = folders.map(folder => folder.uri.toString()).join('|') || 'no-workspace';
    return `sorex.chatSettings:${root}`;
  }

  private repoSessionStateKey(): string {
    const folders = vscode.workspace.workspaceFolders || [];
    const root = folders.map(folder => folder.uri.toString()).join('|') || 'no-workspace';
    return `sorex.chatServerSessions:${root}`;
  }

  private repoFeedbackStateKey(): string {
    const folders = vscode.workspace.workspaceFolders || [];
    const root = folders.map(folder => folder.uri.toString()).join('|') || 'no-workspace';
    return `sorex.responseFeedback:${root}`;
  }

  private restoreRepoChatSettings(): void {
    const saved = this.context.workspaceState.get<{ mode?: string; permissionMode?: string }>(this.repoStateKey());
    if (saved?.mode && ['agent', 'ask', 'edit', 'plan', 'explore'].includes(saved.mode)) this.mode = saved.mode as any;
    if (saved?.permissionMode && ['ask', 'auto', 'autonomous', 'manual'].includes(saved.permissionMode)) this.permissionMode = saved.permissionMode as any;
  }

  private saveRepoChatSettings(): void {
    void this.context.workspaceState.update(this.repoStateKey(), { mode: this.mode, permissionMode: this.permissionMode });
  }

  private restoreResponseFeedback(): void {
    const saved = this.context.workspaceState.get<string[]>(this.repoFeedbackStateKey(), []);
    this.responseFeedback = Array.isArray(saved) ? saved.filter(item => typeof item === 'string').slice(-4) : [];
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = getHtml(webviewView.webview, this.extensionUri);
    void this.postIndexStatus();
    void this.autoRefreshIndexIfConfigured();
    this.post('mode', this.mode);
    this.post('permission', this.permissionMode);

    webviewView.webview.onDidReceiveMessage(async msg => {
      try {
        if (msg.type === 'send') {
          this.activateSession(String(msg.sessionId || ''), []);
          const run = this.handleUserMessage(String(msg.text ?? ''));
          const trackedRun = run.finally(() => {
            if (this.activeRunPromise === trackedRun) this.activeRunPromise = undefined;
          });
          this.activeRunPromise = trackedRun;
          await this.activeRunPromise;
        } else if (msg.type === 'stop') {
          this.stopActiveRun();
        } else if (msg.type === 'restoreVisible') {
          this.restoreSession(String(msg.sessionId || ''), Array.isArray(msg.transcript) ? msg.transcript : []);
        } else if (msg.type === 'tool.search') {
          const files = await this.tools.searchFiles(String(msg.pattern ?? '**/*'), undefined, 100);
          this.post('tool', `Search results:\n${files.join('\n')}`);
        } else if (msg.type === 'tool.diagnostics') {
          this.post('tool', await this.tools.diagnostics());
        } else if (msg.type === 'compact') {
          await this.compactWhenSafe();
        } else if (msg.type === 'newSession') {
          this.startNewSession(String(msg.sessionId || ''));
        } else if (msg.type === 'clearServer') {
          this.clear();
        } else if (msg.type === 'openFile') {
          await this.openWorkspaceFile(String(msg.path || ''), Number(msg.line || 0));
        } else if (msg.type === 'openSettings') {
          await vscode.commands.executeCommand('sorex.openSettings');
        } else if (msg.type === 'openIndexingSettings') {
          await vscode.commands.executeCommand('sorex.openIndexingSettings');
        } else if (msg.type === 'getModels') {
          await this.postModels();
          this.postIndexStatus();
        } else if (msg.type === 'ready') {
          await this.postModels();
          await this.refreshProviderContext();
          this.postIndexStatus();
          this.post('mode', this.mode);
          this.post('permission', this.permissionMode);
          this.postContext();
        } else if (msg.type === 'showModelPicker') {
          await this.showModelPicker();
        } else if (msg.type === 'showModePicker') {
          await this.showModePicker();
        } else if (msg.type === 'showPermissionPicker') {
          await this.showPermissionPicker();
        } else if (msg.type === 'setMode') {
          const mode = String(msg.mode ?? 'agent') as typeof this.mode;
          if (['agent', 'ask', 'edit', 'plan', 'explore'].includes(mode)) {
            this.mode = mode;
            this.saveRepoChatSettings();
            this.post('mode', mode);
            this.post('status', `Mode: ${mode}`);
          }
        } else if (msg.type === 'setPermissionMode') {
          const mode = String(msg.mode ?? 'ask') as typeof this.permissionMode;
          if (['ask', 'auto', 'autonomous', 'manual'].includes(mode)) {
            this.permissionMode = mode;
            this.saveRepoChatSettings();
            this.post('permission', mode);
            this.post('status', `Permissions: ${mode}`);
          }
        } else if (msg.type === 'approveTool') {
          const resolver = this.pendingToolApprovals.get(String(msg.id));
          if (resolver) { this.pendingToolApprovals.delete(String(msg.id)); resolver(true); }
        } else if (msg.type === 'rejectTool') {
          const resolver = this.pendingToolApprovals.get(String(msg.id));
          if (resolver) { this.pendingToolApprovals.delete(String(msg.id)); resolver(false); }
        } else if (msg.type === 'uiSpeechDone') {
          const id = String(msg.id ?? '');
          const resolver = this.pendingUiSpeech.get(id);
          if (resolver) { this.pendingUiSpeech.delete(id); resolver(); }
        } else if (msg.type === 'assistantFeedback') {
          this.recordAssistantFeedback(String(msg.rating || ''), String(msg.text || ''));
        } else if (msg.type === 'openAssistantResponse') {
          await this.openAssistantResponsePanel(String(msg.text || ''));
        } else if (msg.type === 'reviewEdits') {
          await this.openEditReviewPanel(String(msg.editSessionId || ''), String(msg.filePath || ''));
        } else if (msg.type === 'toggleEditUndo') {
          await this.toggleEditSessionUndo(String(msg.editSessionId || ''));
        } else if (msg.type === 'selectModel') {
          const rawModel = String(msg.model ?? '').trim();
          const providerMode = String(msg.providerMode || getSorexConfig().get('providerMode', 'lmstudio'));
          const model = providerMode === 'openrouter' ? normalizeOpenRouterModel(rawModel) : rawModel;
          if (model) {
            const config = getSorexConfig();
            if (providerMode === 'openai') await config.update('openaiModel', model);
            if (providerMode === 'anthropic') await config.update('anthropicModel', model);
            if (providerMode === 'google') await config.update('googleModel', model);
            if (providerMode === 'openrouter') await config.update('openrouterModel', model);
            await config.update('providerMode', providerMode as any);
            await config.update('model', model);
            this.post('status', `Selected model: ${model}`);
            await this.postModels();
            await this.refreshProviderContext();
          }
        }
      } catch (err) {
        if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) {
          this.post('status', 'Stopped.');
          return;
        }
        this.post('error', err instanceof Error ? err.message : String(err));
      }
    });
  }


  private async openWorkspaceFile(filePath: string, line = 0): Promise<void> {
    const clean = String(filePath || '').replace(/\\/g, '/').trim();
    if (!clean || clean.includes('\0')) return;

    try {
      let uri: vscode.Uri | undefined;
      if (/^file:\/\//i.test(clean)) {
        uri = vscode.Uri.parse(clean);
      } else {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
          await vscode.window.showWarningMessage('SOREX cannot open that file because no workspace folder is open.');
          return;
        }

        const relative = clean.replace(/^\.?\//, '');
        const parts = relative.split('/').filter(Boolean);
        if (!parts.length || parts.some(part => part === '..')) {
          await vscode.window.showWarningMessage(`SOREX refused to open an unsafe path: ${clean}`);
          return;
        }

        uri = vscode.Uri.joinPath(folders[0].uri, ...parts);
      }

      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      const requestedLine = Math.max(0, Math.floor(Number(line || 0)) - 1);
      if (Number.isFinite(requestedLine) && requestedLine >= 0 && doc.lineCount > 0) {
        const pos = new vscode.Position(Math.min(requestedLine, doc.lineCount - 1), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await vscode.window.showWarningMessage(`SOREX could not open ${clean}: ${message}`);
    }
  }

  private postIndexStatus(forceState?: string): void {
    const status = this.tools.indexStatus();
    const config = getSorexConfig();
    const state = forceState || status.state;
    const autoRefresh = Boolean(config.get('indexAutoRefresh', false));
    const enabled = Boolean(config.get('indexEnabled', false));
    this.view?.webview.postMessage({
      type: 'indexStatus',
      state,
      label: this.indexStatusLabel(state, status.label),
      detail: this.indexStatusLabel(state, status.detail),
      indexedFiles: status.indexedFiles,
      chunks: status.chunks,
      skippedFiles: status.skippedFiles,
      indexedAt: status.indexedAt,
      diskPath: status.diskPath,
      persisted: status.persisted,
      repoRoot: status.repoRoot,
      autoRefresh,
      enabled
    });
  }

  private indexStatusLabel(state: string, fallback = ''): string {
    if (state === 'checking') return 'Checking index...';
    if (state === 'indexing') return 'Indexing...';
    if (state === 'complete' || state === 'ready' || state === 'success') return 'Index is up to date';
    if (state === 'disabled') return 'Indexing off';
    if (state === 'error') return 'Index error';
    return String(fallback || 'Index not built').trim();
  }

  async refreshWorkspaceIndex(silent = false): Promise<void> {
    try {
      this.postIndexStatus('indexing');
      await this.tools.refreshIndex();
      this.postIndexStatus('complete');
      if (!silent) await vscode.window.showInformationMessage('SOREX workspace index refreshed.');
    } catch (err) {
      this.postIndexStatus('error');
      if (!silent) await vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async autoRefreshIndexIfConfigured(): Promise<void> {
    const config = getSorexConfig();
    if (!Boolean(config.get('indexEnabled', false)) || !Boolean(config.get('indexAutoRefresh', false))) {
      this.postIndexStatus();
      return;
    }
    try {
      this.postIndexStatus('checking');
      await this.tools.ensureIndexFresh(true);
      this.postIndexStatus('complete');
    } catch {
      this.postIndexStatus('error');
    }
  }

  private stopActiveRun(): void {
    this.stopRequested = true;
    this.activeAbort?.abort();
    for (const [, resolve] of this.pendingToolApprovals) resolve(false);
    this.pendingToolApprovals.clear();
    for (const [, resolve] of this.pendingUiSpeech) resolve();
    this.pendingUiSpeech.clear();
    this.view?.webview.postMessage({ type: 'stopped' });
  }

  clear(): void {
    this.stopActiveRun();
    this.deleteActiveSessionSnapshot();
    this.activeSessionId = '';
    this.messages.splice(1);
    this.lastAutoCompactSignature = '';
    this.view?.webview.postMessage({ type: 'clear' });
    this.post('status', 'Session cleared.');
  }

  private async handleUserMessage(text: string): Promise<void> {
    if (!text.trim()) return;
    const selectedModel = this.client.model.trim();
    if (!selectedModel) {
      this.post('error', 'Select a model before sending. Use the SOREX model picker or SOREX Settings > Providers.');
      return;
    }

    const messageLimitError = this.userMessageLimitError(text);
    if (messageLimitError) {
      this.post('error', messageLimitError);
      this.postContext();
      return;
    }

    this.stopRequested = false;
    this.activeAbort = new AbortController();
    this.messages.push({ role: 'user', content: this.wrapUserText(text) });
    try {
      await this.fitContextBeforeModelRequest();
    } catch (err) {
      this.removeLatestUserMessageFromContext();
      this.postContext();
      throw err;
    }
    const config = getSorexConfig();
    if (Boolean(config.get('indexEnabled', false)) && Boolean(config.get('indexAutoRefresh', false))) {
      this.postIndexStatus('checking');
      await this.tools.ensureIndexFresh(true).catch(() => undefined);
    }
    this.postIndexStatus();
    this.postContext();
    this.post('thinking', '');

    const conservative = Boolean(config.get('conservativeToolCalling', false));
    const configuredMaxTurns = Number(config.get('maxToolRounds', 8));
    const maxTurns = conservative
      ? Math.max(1, Math.min(configuredMaxTurns || 8, 12))
      : Math.max(32, Math.min(Math.max(configuredMaxTurns || 8, 64), 96));
    let final = '';
    const process: Array<{ name: string; title: string; detail: string; args?: any; added?: number; removed?: number; filePath?: string; editId?: string }> = [];
    const editSessionId = `edit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const editSnapshots: EditSnapshot[] = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      await this.fitContextBeforeModelRequest();
      const requestStartedAt = Date.now();
      const result = await this.client.chat({
        messages: this.messagesForCurrentMode(),
        tools: this.toolsForCurrentMode(),
        signal: this.activeAbort.signal
      });
      this.postModelSpeed(requestStartedAt, result);
      await this.waitForCompactionIdle();

      if (this.stopRequested) return;
      if (result.toolCalls.length) {
        const callsThisTurn = [result.toolCalls[0]];
        this.messages.push({ role: 'assistant', content: result.content || '', tool_calls: callsThisTurn });
        const allowedToolNames = new Set(this.toolsForCurrentMode().map(tool => tool.function.name));

        for (const call of callsThisTurn) {
          await this.waitForCompactionIdle();
          if (!call.id) call.id = `tool-call-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const name = String(call.function?.name ?? 'unknown');
          const rawArgs = call.function?.arguments ?? '{}';
          const args = this.parseToolArguments(rawArgs);
          const presentation = await this.toolPresentation(name, args);
          const title = this.describeTool(name, args, false, presentation);
          const modelStep = String(result.content || '').trim();
          const reasonStep = this.assistantLeadForTool(name, args, presentation);
          const stepText = modelStep ? `${modelStep}\n${reasonStep}` : reasonStep;
          const stepDetail = stepText.slice(0, 240);
          process.push({ name: 'assistant_step', title: 'Reasoning', detail: stepDetail });
          const stepWait = this.postAssistantStep(stepText);
          await this.postToolThinkingAndWait(call.id, name, stepWait);
          await this.postToolStartAndWait(name, title, args, call.id, presentation);
          if (this.stopRequested) return;

          if (!allowedToolNames.has(name)) {
            const blocked = `${name} is not available in ${this.mode} mode.`;
            await this.postToolResultAndWait(name, `Unavailable ${name}`, args, blocked, call.id);
            this.messages.push({ role: 'tool', tool_call_id: call.id, content: blocked });
            process.push({ name, title: `Unavailable ${name}`, detail: blocked });
            continue;
          }

          if (this.requiresApproval(name)) {
            const allowed = await this.requestToolApproval(name, args, title);
            if (!allowed) {
              const blocked = `${name} blocked by user.`;
              await this.postToolResultAndWait(name, `Blocked ${name}`, args, blocked, call.id);
              this.messages.push({ role: 'tool', tool_call_id: call.id, content: blocked });
              process.push({ name, title: `Blocked ${name}`, detail: blocked });
              continue;
            }
          }

          if (this.stopRequested) return;
          try {
            if (name === 'workspace_index_search' || name === 'workspace_index_refresh') this.postIndexStatus('indexing');
            const editBefore = await this.captureEditBefore(name, args);
            const toolResult = await this.tools.execute(name, args);
            if (name === 'workspace_index_search' || name === 'workspace_index_refresh') this.postIndexStatus('complete');
            const doneTitle = this.describeTool(name, args, true, presentation);
            const editSnapshot = editBefore ? await this.captureEditAfter(editBefore, doneTitle) : undefined;
            if (editSnapshot) editSnapshots.push(editSnapshot);
            const summaryDetail = String(toolResult.display || toolResult.model || '').split('\n')[0].slice(0, 240);
            const uiDetail = this.toolResultDetailForUi(name, toolResult);
            process.push({ name, title: doneTitle, detail: summaryDetail, ...this.editProcessMetadata(name, args, editSnapshot, presentation) });
            await this.postToolResultAndWait(name, doneTitle, args, uiDetail, call.id, presentation);
            this.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: toolResult.model.slice(0, 12000)
            });
          } catch (err) {
            if (name === 'workspace_index_search' || name === 'workspace_index_refresh') this.postIndexStatus('error');
            const detail = err instanceof Error ? err.message : String(err);
            const failed = `Tool ${name} failed: ${detail}`;
            await this.postToolResultAndWait(name, `Failed ${name}`, args, failed.slice(0, 240), call.id);
            process.push({ name, title: `Failed ${name}`, detail: failed.slice(0, 240) });
            this.messages.push({ role: 'tool', tool_call_id: call.id, content: failed });
          }
          this.postContext();
        }
        await this.autoCompactIfNeeded();
        await this.waitForCompactionIdle();
        await this.waitForToolUiBeat(720);
        continue;
      }

      if (this.stopRequested) return;
      final = result.content || '(No response content.)';
      this.messages.push({ role: 'assistant', content: final });
      await this.autoCompactIfNeeded();
      await this.waitForCompactionIdle();
      this.saveActiveSessionSnapshot();
      const postedEditSessionId = this.storeEditSession(editSessionId, editSnapshots);
      this.view?.webview.postMessage({ type: 'assistantAnimated', text: final, process, editSessionId: postedEditSessionId });
      this.postContext();
      return;
    }

    final = conservative
      ? 'I paused because conservative tool calling reached its tool budget. Ask me to continue if you want a deeper pass.'
      : 'I paused to avoid an endless tool loop. The useful progress from this pass is shown above; ask me to continue and I will pick up from there.';
    this.messages.push({ role: 'assistant', content: final });
    await this.autoCompactIfNeeded();
    await this.waitForCompactionIdle();
    this.saveActiveSessionSnapshot();
    const postedEditSessionId = this.storeEditSession(editSessionId, editSnapshots);
    this.view?.webview.postMessage({ type: 'assistantAnimated', text: final, process, editSessionId: postedEditSessionId });
    this.postContext();
  }


  private messagesForCurrentMode(): SorexMessage[] {
    const system = this.messages[0];
    const modePrompt = this.modePrompt();
    const indexContext = this.tools.indexPromptContext();
    const feedbackContext = this.feedbackPromptContext();
    return [{ ...system, content: `${system.content}

${modePrompt}

${feedbackContext}

${indexContext}` }, ...this.messages.slice(1)];
  }

  private recordAssistantFeedback(rating: string, text: string): void {
    const cleanRating = rating === 'up' ? 'positive' : rating === 'down' ? 'negative' : '';
    if (!cleanRating) return;
    const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 420);
    const note = cleanRating === 'positive'
      ? `User liked the previous answer style/content. Continue that pattern when relevant.`
      : `User disliked the previous answer. Improve the next answer by being more directly useful, better aligned with the request, and less repetitive. Previous answer excerpt: ${cleanText}`;
    this.responseFeedback.push(note);
    this.responseFeedback = this.responseFeedback.slice(-4);
    void this.context.workspaceState.update(this.repoFeedbackStateKey(), this.responseFeedback);
  }

  private feedbackPromptContext(): string {
    if (!this.responseFeedback.length) return '';
    return `Recent user feedback to adapt future answers:\n${this.responseFeedback.map(item => `- ${item}`).join('\n')}`;
  }

  private modePrompt(): string {
    switch (this.mode) {
      case 'ask': return SOREX_ASK_PROMPT;
      case 'edit': return SOREX_EDIT_PROMPT;
      case 'plan': return SOREX_PLAN_PROMPT;
      case 'explore': return SOREX_EXPLORE_PROMPT;
      default:
        return `SOREX Agent mode:
- Use workspace tools to inspect before answering repo-specific requests.
- Use workspace_index_search first for broad codebase recall when the request spans unknown files.
- Use web_search/web_fetch only when current public coding docs or current error references are needed.
- For code-change requests, search/read the workspace first, then call edit/file tools.
- Make concise, stable tool choices. Emit exactly one tool call per assistant response; wait for that result before deciding the next tool. If a tool is needed, briefly say what you are about to inspect or change, then call the tool. Do not narrate hidden chain-of-thought; keep tool rationale operational and short.
- Do not use terminal commands for discovery or diff inspection. Use git_diff for diffs. Read project command files first, then use terminal only for verification/build/test commands that actually exist and help.
- Ask for approval before writes and terminal commands unless autonomous permission mode is selected.`;
    }
  }

  private toolsForCurrentMode() {
    const enabled = this.tools.enabledSchemas();
    if (this.mode === 'ask' || this.mode === 'plan' || this.mode === 'explore') {
      return enabled.filter(tool => this.tools.isReadOnlyTool(tool.function.name));
    }
    return enabled;
  }

  private progressLabel(): string {
    switch (this.mode) {
      case 'ask': return 'Inspecting';
      case 'plan': return 'Planning';
      case 'explore': return 'Exploring';
      case 'edit': return 'Preparing edits';
      default: return 'Thinking';
    }
  }

  private requiresApproval(name: string): boolean {
    if (this.mode === 'ask' || this.mode === 'plan' || this.mode === 'explore') return false;
    if (this.permissionMode === 'autonomous') return false;
    if (this.permissionMode === 'manual') return true;
    return this.tools.requiresApprovalTool(name);
  }


  private explainToolIntent(name: string, args: any): string {
    const clip = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 120);
    switch (String(name || '')) {
      case 'list_dir': return `I need to inspect the folder layout before choosing the next file${args?.path ? `: ${clip(args.path)}` : '.'}`;
      case 'file_search': return `I need to search the workspace for the relevant code path${args?.query ? `: ${clip(args.query)}` : '.'}`;
      case 'grep_search': return `I need to find exact symbol or text matches before touching code${args?.query ? `: ${clip(args.query)}` : '.'}`;
      case 'read_file': return `I need to read the file before making a grounded change${args?.filePath ? `: ${clip(args.filePath)}` : '.'}`;
      case 'git_diff': return args?.filePath ? `Let me inspect the diff for ${clip(args.filePath)} without using the terminal.` : 'Let me inspect the current diff without using the terminal.';
      case 'get_errors': return 'I need to check diagnostics before deciding whether the current changes are clean.';
      case 'workspace_index_search': return `I need to query the workspace index to find the relevant code area${args?.query ? `: ${clip(args.query)}` : '.'}`;
      case 'workspace_index_refresh': return 'I need to refresh the workspace index before trusting indexed recall.';
      case 'web_search': return `I need current public coding information from the web${args?.query ? `: ${clip(args.query)}` : '.'}`;
      case 'web_fetch': return `I need to fetch the public documentation page before using it${args?.url ? `: ${clip(args.url)}` : '.'}`;
      case 'run_in_terminal': return `I need to verify the result with a command${args?.goal ? `: ${clip(args.goal)}` : '.'}`;
      default: return `I need to run ${String(name || 'this tool')} before the next step.`;
    }
  }

  private uiSpeechDelayMs(text: string): number {
    const chars = String(text || '').length;
    if (!chars) return 360;
    const measuredOrEstimatedTps = this.lastRuntimeTokensPerSecond || this.estimatedRuntimeTokensPerSecond();
    const charsPerSecond = Math.max(12, Math.min(86, measuredOrEstimatedTps * 3.05));
    return Math.max(680, Math.min(6200, Math.ceil((chars / charsPerSecond) * 1000) + 420));
  }

  private waitForUiSpeechAck(id: string, fallbackMs: number): Promise<void> {
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingUiSpeech.delete(id);
        resolve();
      };
      const timer = setTimeout(finish, fallbackMs);
      this.pendingUiSpeech.set(id, finish);
    });
  }

  private async postAssistantStep(text: string): Promise<void> {
    await this.waitForCompactionIdle();
    const clean = String(text || '').trim();
    if (!clean || !this.view) return Promise.resolve();
    const id = `speech-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const fallbackMs = this.uiSpeechDelayMs(clean) + 900;
    const wait = this.waitForUiSpeechAck(id, fallbackMs);
    this.view.webview.postMessage({ type: 'assistantStep', text: clean, id });
    return wait;
  }

  private async postAssistantStepAndWait(text: string): Promise<void> {
    await this.postAssistantStep(text);
  }

  private postToolThinking(toolId = '', name = ''): void {
    if (!this.view) return;
    const uiToolId = String(toolId || `thinking-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    this.view.webview.postMessage({ type: 'toolThinking', name, toolId: uiToolId });
  }

  private async postToolThinkingAndWait(toolId = '', name = '', preToolWait?: Promise<void>): Promise<void> {
    await this.waitForCompactionIdle();
    if (!this.view) return;
    const id = `thinking-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const uiToolId = String(toolId || id);
    const wait = this.waitForUiSpeechAck(id, 1400);
    this.view.webview.postMessage({ type: 'toolThinking', name, id, toolId: uiToolId });
    if (preToolWait) await preToolWait;
    await wait;
    await this.waitForToolUiBeat(120);
  }

  private async postToolStartAndWait(name: string, title: string, args: any, toolId = '', presentation: { writeKind?: 'create' | 'overwrite'; fileExisted?: boolean } = {}): Promise<void> {
    await this.waitForCompactionIdle();
    if (!this.view) return;
    const id = `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const uiToolId = String(toolId || id);

    const wait = this.waitForUiSpeechAck(id, this.uiSpeechDelayMs(title) + 1100);
    this.view.webview.postMessage({ type: 'toolStart', name, title, args, id, toolId: uiToolId, writeKind: presentation.writeKind || '', fileExisted: presentation.fileExisted });
    await wait;
    await this.waitForToolUiBeat(Math.max(180, Math.min(720, this.uiSpeechDelayMs(title) * 0.12)));
  }

  private async postToolResultAndWait(name: string, title: string, args: any, detail: string, toolId = '', presentation: { writeKind?: 'create' | 'overwrite'; fileExisted?: boolean } = {}): Promise<void> {
    await this.waitForCompactionIdle();
    if (!this.view) return;
    const id = `tool-result-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const uiToolId = String(toolId || id);
    const wait = this.waitForUiSpeechAck(id, 950);
    this.view.webview.postMessage({ type: 'tool', name, title, args, detail, id, toolId: uiToolId, writeKind: presentation.writeKind || '', fileExisted: presentation.fileExisted });
    await wait;
    await this.waitForToolUiBeat(520);
  }


  private toolResultDetailForUi(name: string, toolResult: { display?: string; model?: string }): string {
    const n = String(name || '').toLowerCase();
    const display = String(toolResult.display || '').trim();
    const model = String(toolResult.model || '').trim();

    if (n === 'list_dir') {
      const tree = display.includes('\n') ? display.replace(/^Listed[^\n]*\n/, '').trim() : model;
      return String(tree || display || model || 'No directory entries.').slice(0, 12000);
    }

    return String(display || model || '').split('\n')[0].slice(0, 240);
  }

  private waitForToolUiBeat(ms = 620): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private estimatedRuntimeTokensPerSecond(): number {
    if (this.lastRuntimeTokensPerSecond > 0) return this.lastRuntimeTokensPerSecond;
    const name = this.client.model.toLowerCase();
    if (!name) return 18;
    if (/\b(1\.5b|3b|4b|mini|small|flash|haiku)\b/.test(name)) return 42;
    if (/\b(7b|8b|9b)\b/.test(name)) return 28;
    if (/\b(13b|14b|15b)\b/.test(name)) return 18;
    if (/\b(20b|22b|24b|30b|32b|34b)\b/.test(name)) return 10;
    if (/\b(70b|72b|90b|110b|120b)\b/.test(name)) return 5;
    if (/gpt|claude|gemini|openai|anthropic|google|openrouter/.test(name)) return 36;
    return 18;
  }

  private parseToolArguments(rawArgs: unknown): any {
    if (!rawArgs) return {};
    if (typeof rawArgs !== 'string') return rawArgs && typeof rawArgs === 'object' ? rawArgs : {};

    const text = rawArgs.trim();
    if (!text) return {};

    const attempts = new Set<string>();
    attempts.add(text);
    const firstObject = text.indexOf('{');
    const lastObject = text.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) attempts.add(text.slice(firstObject, lastObject + 1));

    for (const attempt of attempts) {
      try {
        const parsed = JSON.parse(attempt);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        try {
          const parsed = JSON.parse(attempt.replace(/,\s*([}\]])/g, '$1'));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {}
      }
    }

    return {};
  }

  private requestToolApproval(name: string, args: any, title: string): Promise<boolean> {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.view?.webview.postMessage({ type: 'toolApproval', id, name, args, title });
    return new Promise(resolve => {
      this.pendingToolApprovals.set(id, resolve);
    });
  }

  private restoreSession(sessionId: string, transcript: Array<{ role?: string; text?: string }>): void {
    this.activateSession(sessionId, transcript);
    this.postContext();
  }

  private startNewSession(sessionId: string): void {
    this.saveActiveSessionSnapshot();
    this.activeSessionId = sessionId || '';
    this.messages.splice(1);
    this.lastAutoCompactSignature = '';
    this.lastAutoCompactAt = 0;
    this.postContext();
  }

  private activateSession(sessionId: string, transcript: Array<{ role?: string; text?: string }>): void {
    const nextId = String(sessionId || '').trim();
    if (nextId && nextId === this.activeSessionId) return;
    this.saveActiveSessionSnapshot();
    this.activeSessionId = nextId;
    const saved = nextId ? this.sessionSnapshots()[nextId] : undefined;
    if (Array.isArray(saved) && saved.length) {
      const system = this.messages[0];
      this.messages.splice(0, this.messages.length, system, ...this.cloneMessages(saved));
      this.lastAutoCompactSignature = '';
      return;
    }
    this.restoreVisibleTranscript(transcript);
  }

  private restoreVisibleTranscript(transcript: Array<{ role?: string; text?: string }>): void {
    const system = this.messages[0];
    this.messages.splice(0, this.messages.length, system);
    this.lastAutoCompactSignature = '';
    for (const item of transcript) {
      if (item.role === 'user' && item.text) {
        this.messages.push({ role: 'user', content: this.wrapUserText(item.text) });
      } else if (item.role === 'assistant' && item.text) {
        this.messages.push({ role: 'assistant', content: item.text });
      }
    }
  }

  private wrapUserText(text: string): string {
    return `<mode>${this.mode}</mode>\n<user_request>\n${text}\n</user_request>`;
  }

  private sessionSnapshots(): Record<string, SorexMessage[]> {
    const saved = this.context.workspaceState.get<Record<string, SorexMessage[]>>(this.repoSessionStateKey(), {});
    return saved && typeof saved === 'object' ? saved : {};
  }

  private saveActiveSessionSnapshot(): void {
    if (!this.activeSessionId || this.messages.length <= 1) return;
    const snapshots = this.sessionSnapshots();
    snapshots[this.activeSessionId] = this.cloneMessages(this.messages.slice(1));
    const entries = Object.entries(snapshots).slice(-40);
    void this.context.workspaceState.update(this.repoSessionStateKey(), Object.fromEntries(entries));
  }

  private deleteActiveSessionSnapshot(): void {
    if (!this.activeSessionId) return;
    const snapshots = this.sessionSnapshots();
    delete snapshots[this.activeSessionId];
    void this.context.workspaceState.update(this.repoSessionStateKey(), snapshots);
  }

  private cloneMessages(messages: SorexMessage[]): SorexMessage[] {
    return JSON.parse(JSON.stringify(messages)) as SorexMessage[];
  }


  private describeTool(name: string, args: any, done: boolean, presentation: { writeKind?: 'create' | 'overwrite' } = {}): string {
    const prefix = done ? 'Finished' : 'Running';
    const clip = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 120);
    switch (name) {
      case 'replace_string_in_file':
      case 'replace_range_in_file':
      case 'insert_text_in_file':
      case 'write_file':
        return this.describeEditTool(name, args, done, presentation);
      case 'read_file': return `${done ? 'Read' : 'Reading'} ${args?.filePath ? clip(args.filePath) : 'file'}${args?.startLine ? `:${args.startLine}-${args.endLine}` : ''}`;
      case 'file_search': return `${done ? 'Searched files' : 'Searching files'}${args?.query ? ` - ${clip(args.query)}` : ''}`;
      case 'grep_search': return `${done ? 'Searched text' : 'Searching text'}${args?.query ? ` - ${clip(args.query)}` : ''}${args?.includePattern ? ` in ${clip(args.includePattern)}` : ''}`;
      case 'list_dir': return `${done ? 'Ran' : 'Running'} list_dir${args?.path ? ` - ${clip(args.path)}` : ''}`;
      case 'delete_file': return `${prefix} delete_file${args?.filePath ? ` - ${clip(args.filePath)}` : ''}`;
      case 'create_directory': return `${prefix} create_directory${args?.dirPath ? ` - ${clip(args.dirPath)}` : ''}`;
      case 'git_diff': return `${done ? 'Read diff' : 'Reading diff'}${args?.filePath ? ` - ${clip(args.filePath)}` : args?.staged ? ' - staged' : ''}`;
      case 'get_errors': return `${done ? 'Checked diagnostics' : 'Checking diagnostics'}`;
      case 'workspace_index_search': return `${done ? 'Viewed index' : 'Viewing index'}`;
      case 'workspace_index_refresh': return `${done ? 'Refreshed index' : 'Refreshing index'}`;
      case 'web_search': return `${done ? 'Searched web' : 'Searching web'}${args?.query ? ` - ${clip(args.query)}` : ''}`;
      case 'web_fetch': return `${done ? 'Fetched page' : 'Fetching page'}${args?.url ? ` - ${clip(args.url)}` : ''}`;
      case 'run_in_terminal': return `${done ? 'Ran command' : 'Running command'}${args?.command ? ` - ${clip(args.command)}` : args?.goal ? ` - ${clip(args.goal)}` : ''}`;
      default: return `${prefix} ${name}`;
    }
  }

  private describeEditTool(name: string, args: any, done: boolean, presentation: { writeKind?: 'create' | 'overwrite'; fileExisted?: boolean } = {}): string {
    const filePath = String(args?.filePath || args?.path || '').trim();
    if (!filePath) return `${done ? 'Failed' : 'Running'} ${name}`;
    const file = this.shortPath(filePath);
    const counts = this.editLineCounts(name, args);
    const plus = counts.added ? ` +${counts.added}` : '';
    const minus = counts.removed ? ` -${counts.removed}` : '';
    const createsFile = name === 'write_file' && (presentation.writeKind === 'create' || presentation.fileExisted === false);
    const verb = createsFile ? (done ? 'Created' : 'Creating') : (done ? 'Edited' : 'Editing');
    return `${verb} ${file}${plus}${minus}`;
  }


  private assistantLeadForTool(name: string, args: any, presentation: { writeKind?: 'create' | 'overwrite'; fileExisted?: boolean } = {}): string {
    const clip = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const rawFile = String(args?.filePath || args?.path || '').trim();
    const file = rawFile ? this.shortPath(rawFile) : '';
    switch (name) {
      case 'read_file': return `Let me read ${file || 'that file'} first so I can base the next step on the actual contents.`;
      case 'file_search': return args?.query ? `Let me search for ${clip(args.query)} so I can find the right file before touching anything.` : 'Let me search the workspace so I can find the right file before touching anything.';
      case 'grep_search': return args?.query ? `Let me scan for ${clip(args.query)} so I can find the exact code path instead of guessing.` : 'Let me scan the codebase so I can find the exact code path instead of guessing.';
      case 'list_dir': return args?.path ? `Let me inspect ${clip(args.path)} so I can understand what exists there first.` : 'Let me inspect the workspace structure so I can choose the right path.';
      case 'get_errors': return 'Let me check diagnostics so I can verify whether anything is already broken.';
      case 'git_diff': return args?.filePath ? `Let me inspect the diff for ${clip(args.filePath)} without using the terminal.` : 'Let me inspect the current diff without using the terminal.';
      case 'workspace_index_search': return 'Let me search the workspace index so I can use repo context quickly.';
      case 'workspace_index_refresh': return 'Let me refresh the workspace index so repo recall is current.';
      case 'web_search': return args?.query ? `Let me search the web for ${clip(args.query)} so I can use current information.` : 'Let me search the web so I can use current information.';
      case 'web_fetch': return args?.url ? `Let me open ${clip(args.url)} so I can inspect the source directly.` : 'Let me fetch that page so I can inspect the source directly.';
      case 'run_in_terminal': return args?.goal ? `Let me run a quick command to ${clip(args.goal)} so I can verify the result.` : 'Let me run a quick verification command so I can check the result.';
      case 'create_directory': return args?.dirPath ? `Let me create ${clip(args.dirPath)} because the requested file/work needs that folder to exist.` : 'Let me create that directory because the requested work needs it to exist.';
      case 'write_file':
        if (!file) return 'Let me prepare that file.';
        return (presentation.writeKind === 'create' || presentation.fileExisted === false)
          ? `Let me create ${file} because it does not exist yet and the request needs a new file.`
          : `Let me update ${file} because the requested change belongs in that existing file.`;
      case 'replace_string_in_file':
      case 'replace_range_in_file':
      case 'insert_text_in_file':
        if (!file) return 'Let me update the file.';
        return `Let me update ${file} because that is the file that needs the requested change.`;
      case 'delete_file': return file ? `Let me remove ${file} because it is no longer needed for the requested state.` : 'Let me remove the file because it is no longer needed.';
      default: return `Let me ${this.describeTool(name, args, false, presentation).replace(/^Running\s+/i, '').replace(/^Searching\s+/i, 'search ').replace(/^Checking\s+/i, 'check ').replace(/^Viewing\s+/i, 'view ').replace(/^Refreshing\s+/i, 'refresh ').toLowerCase()}.`;
    }
  }

  private async toolPresentation(name: string, args: any): Promise<{ writeKind?: 'create' | 'overwrite'; fileExisted?: boolean }> {
    if (name !== 'write_file') return {};
    if (!String(args?.filePath || '').trim()) return {};
    const exists = await this.workspaceFileExists(args?.filePath);
    return { writeKind: exists ? 'overwrite' : 'create', fileExisted: exists };
  }

  private async workspaceFileExists(filePath: unknown): Promise<boolean> {
    const uri = this.workspaceFileUri(filePath);
    if (!uri) return false;
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private workspaceFileUri(filePath: unknown): vscode.Uri | undefined {
    const raw = String(filePath ?? '').replace(/\\/g, '/').trim();
    if (!raw || raw.includes('\0')) return undefined;
    if (/^file:\/\//i.test(raw)) return vscode.Uri.parse(raw);
    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/')) return vscode.Uri.file(raw);
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return undefined;
    const relative = raw.replace(/^\.?\//, '');
    const parts = relative.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '..')) return undefined;
    return vscode.Uri.joinPath(folders[0].uri, ...parts);
  }

  private async readTextIfExists(uri: vscode.Uri): Promise<{ exists: boolean; text: string }> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return { exists: true, text: new TextDecoder().decode(bytes) };
    } catch {
      return { exists: false, text: '' };
    }
  }

  private shortPath(value: unknown): string {
    const clean = String(value || '').replace(/\\/g, '/');
    return clean.split('/').filter(Boolean).pop() || clean || 'file';
  }

  private editLineCounts(name: string, args: any): { added: number; removed: number } {
    const countLines = (value: unknown): number => {
      const text = String(value ?? '');
      if (!text) return 0;
      return text.replace(/\n$/, '').split(/\r?\n/).length;
    };
    if (name === 'replace_string_in_file') return { added: countLines(args?.newString), removed: countLines(args?.oldString) };
    if (name === 'replace_range_in_file') return { added: countLines(args?.newText), removed: Math.max(0, Number(args?.endLine ?? 0) - Number(args?.startLine ?? 0) + 1) || 0 };
    if (name === 'insert_text_in_file') return { added: countLines(args?.text), removed: 0 };
    if (name === 'write_file') return { added: countLines(args?.content), removed: 0 };
    return { added: 0, removed: 0 };
  }

  private async captureEditBefore(name: string, args: any): Promise<{ name: string; args: any; filePath: string; uri: vscode.Uri; beforeExists: boolean; beforeText: string } | undefined> {
    const n = String(name || '').toLowerCase();
    if (!['replace_string_in_file', 'replace_range_in_file', 'insert_text_in_file', 'write_file', 'delete_file'].includes(n)) return undefined;
    const filePath = String(args?.filePath || '').replace(/\\/g, '/').trim();
    const uri = this.workspaceFileUri(filePath);
    if (!uri) return undefined;
    const before = await this.readTextIfExists(uri);
    return { name: n, args, filePath, uri, beforeExists: before.exists, beforeText: before.text };
  }

  private async captureEditAfter(before: { name: string; args: any; filePath: string; uri: vscode.Uri; beforeExists: boolean; beforeText: string }, title: string): Promise<EditSnapshot | undefined> {
    const after = await this.readTextIfExists(before.uri);
    if (after.exists === before.beforeExists && after.text === before.beforeText) return undefined;
    const counts = this.diffLineCounts(before.beforeText, after.text, before.beforeExists, after.exists);
    return {
      editId: `snap-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      filePath: before.filePath,
      uri: before.uri.toString(),
      title,
      beforeExists: before.beforeExists,
      afterExists: after.exists,
      beforeText: before.beforeText,
      afterText: after.text,
      added: counts.added,
      removed: counts.removed
    };
  }

  private diffLineCounts(beforeText: string, afterText: string, beforeExists = true, afterExists = true): { added: number; removed: number } {
    const beforeLines = beforeExists && beforeText ? beforeText.replace(/\n$/, '').split(/\r?\n/) : [];
    const afterLines = afterExists && afterText ? afterText.replace(/\n$/, '').split(/\r?\n/) : [];
    let prefix = 0;
    while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix + prefix < beforeLines.length &&
      suffix + prefix < afterLines.length &&
      beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
    ) suffix++;
    return {
      added: Math.max(0, afterLines.length - prefix - suffix),
      removed: Math.max(0, beforeLines.length - prefix - suffix)
    };
  }

  private storeEditSession(id: string, snapshots: EditSnapshot[]): string {
    if (!snapshots.length) return '';
    this.editSessions.set(id, { id, createdAt: Date.now(), snapshots });
    const entries = Array.from(this.editSessions.entries()).sort((a, b) => b[1].createdAt - a[1].createdAt);
    for (const [key] of entries.slice(30)) this.editSessions.delete(key);
    return id;
  }

  private editProcessMetadata(name: string, args: any, snapshot?: EditSnapshot, presentation: { writeKind?: 'create' | 'overwrite' } = {}): Record<string, unknown> {
    const n = String(name || '').toLowerCase();
    if (!['replace_string_in_file', 'replace_range_in_file', 'insert_text_in_file', 'write_file', 'delete_file'].includes(n)) return {};
    const counts = snapshot ? { added: snapshot.added, removed: snapshot.removed } : this.editLineCounts(n, args);
    return {
      args,
      filePath: snapshot?.filePath || String(args?.filePath || ''),
      editId: snapshot?.editId || '',
      writeKind: snapshot && !snapshot.beforeExists && snapshot.afterExists ? 'create' : (presentation.writeKind || ''),
      added: counts.added,
      removed: n === 'delete_file' && counts.removed === 0 ? 1 : counts.removed
    };
  }

  private async toggleEditSessionUndo(editSessionId: string): Promise<void> {
    const session = this.editSessions.get(editSessionId);
    if (!session?.snapshots.length) {
      this.view?.webview.postMessage({ type: 'editSessionState', editSessionId, undone: false });
      await vscode.window.showWarningMessage('SOREX could not find edits to undo for that response.');
      return;
    }
    const reapply = session.undone === true;
    const snapshots = reapply ? session.snapshots : [...session.snapshots].reverse();
    for (const snapshot of snapshots) {
      const uri = vscode.Uri.parse(snapshot.uri);
      await this.restoreEditSnapshotState(uri, reapply ? snapshot.afterExists : snapshot.beforeExists, reapply ? snapshot.afterText : snapshot.beforeText);
    }
    session.undone = !reapply;
    this.view?.webview.postMessage({ type: 'editSessionState', editSessionId, undone: session.undone });
    await vscode.window.showInformationMessage(`SOREX ${session.undone ? 'undone' : 'reapplied'} ${session.snapshots.length} edited ${session.snapshots.length === 1 ? 'file' : 'files'}.`);
  }

  private async restoreEditSnapshotState(uri: vscode.Uri, shouldExist: boolean, text: string): Promise<void> {
    if (shouldExist) {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
      return;
    }
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
    } catch {
      // The file may already be gone; the target state is still satisfied.
    }
  }

  private async openEditReviewPanel(editSessionId: string, filePath = ''): Promise<void> {
    const session = this.editSessions.get(editSessionId);
    if (!session?.snapshots.length) {
      await vscode.window.showWarningMessage('SOREX could not find edits to review for that response.');
      return;
    }
    const cleanFile = filePath.replace(/\\/g, '/').trim();
    const snapshots = cleanFile
      ? session.snapshots.filter(item => item.filePath.replace(/\\/g, '/') === cleanFile)
      : session.snapshots;
    const shown = snapshots.length ? snapshots : session.snapshots;
    const panel = vscode.window.createWebviewPanel(
      'sorexEditReview',
      cleanFile ? `Reviewing ${this.shortPath(cleanFile)}` : 'Changes I Made',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.webview.html = this.editReviewHtml(shown, session.undone === true);
  }

  private async openAssistantResponsePanel(text: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'sorexResponseReview',
      'SOREX Response',
      vscode.ViewColumn.One,
      { enableScripts: false }
    );
    panel.webview.html = this.basicPanelHtml('SOREX Response', `<pre>${this.escapeHtml(text)}</pre>`);
  }

  private editReviewHtml(snapshots: EditSnapshot[], undone: boolean): string {
    const files = snapshots.map(snapshot => {
      const diff = this.renderUnifiedDiff(snapshot.beforeText, snapshot.afterText, snapshot.beforeExists, snapshot.afterExists);
      return `<section class="file"><h2>${this.escapeHtml(snapshot.filePath)}</h2><div class="meta">${this.escapeHtml(snapshot.title)} · <span class="plus">+${snapshot.added}</span> <span class="minus">-${snapshot.removed}</span>${undone ? ' · undone' : ''}</div><pre>${diff}</pre></section>`;
    }).join('');
    return this.basicPanelHtml('Changes I Made', files || '<p>No file edits recorded.</p>');
  }

  private basicPanelHtml(title: string, body: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>
body{margin:0;padding:24px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}
h1{font-size:24px;margin:0 0 18px}h2{font-size:16px;margin:0 0 6px}.file{border:1px solid var(--vscode-panel-border);border-radius:10px;margin:0 0 18px;padding:14px;background:color-mix(in srgb,var(--vscode-sideBar-background) 80%,transparent)}
.meta{color:var(--vscode-descriptionForeground);margin-bottom:12px}.plus{color:var(--vscode-gitDecoration-addedResourceForeground,#3fb950)}.minus{color:var(--vscode-gitDecoration-deletedResourceForeground,#f85149)}
pre{white-space:pre-wrap;overflow:auto;margin:0;padding:12px;border-radius:8px;background:var(--vscode-textCodeBlock-background);line-height:1.45}.add{color:var(--vscode-gitDecoration-addedResourceForeground,#3fb950)}.del{color:var(--vscode-gitDecoration-deletedResourceForeground,#f85149)}.ctx{color:var(--vscode-descriptionForeground)}
</style><title>${this.escapeHtml(title)}</title></head><body><h1>${this.escapeHtml(title)}</h1>${body}</body></html>`;
  }

  private renderUnifiedDiff(beforeText: string, afterText: string, beforeExists: boolean, afterExists: boolean): string {
    const beforeLines = beforeExists && beforeText ? beforeText.replace(/\n$/, '').split(/\r?\n/) : [];
    const afterLines = afterExists && afterText ? afterText.replace(/\n$/, '').split(/\r?\n/) : [];
    let prefix = 0;
    while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix + prefix < beforeLines.length &&
      suffix + prefix < afterLines.length &&
      beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
    ) suffix++;
    const start = Math.max(0, prefix - 3);
    const beforeEnd = beforeLines.length - suffix;
    const afterEnd = afterLines.length - suffix;
    const endContextBefore = Math.min(beforeLines.length, beforeEnd + 3);
    const endContextAfter = Math.min(afterLines.length, afterEnd + 3);
    const out: string[] = [];
    out.push(`<span class="ctx">--- before</span>`);
    out.push(`<span class="ctx">+++ after</span>`);
    for (let i = start; i < prefix; i++) out.push(`<span class="ctx"> ${this.escapeHtml(beforeLines[i] ?? '')}</span>`);
    for (let i = prefix; i < beforeEnd; i++) out.push(`<span class="del">-${this.escapeHtml(beforeLines[i] ?? '')}</span>`);
    for (let i = prefix; i < afterEnd; i++) out.push(`<span class="add">+${this.escapeHtml(afterLines[i] ?? '')}</span>`);
    const contextSource = afterLines.length ? afterLines : beforeLines;
    const contextEnd = afterLines.length ? endContextAfter : endContextBefore;
    for (let i = afterEnd; i < contextEnd; i++) out.push(`<span class="ctx"> ${this.escapeHtml(contextSource[i] ?? '')}</span>`);
    return out.join('\n');
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private contextStats(): {
    percent: number;
    approx: number;
    max: number;
    available: number;
    compactAt: number;
    windowMax: number;
    outputReserve: number;
    safetyReserve: number;
    toolOverhead: number;
    requestApprox: number;
    requestPercent: number;
    usableMax: number;
    hiddenPromptApprox: number;
    contextUsed: number;
    contextLimit: number;
    contextPercent: number;
    contextSource: string;
  } {
    const config = getSorexConfig();
    const manualWindowMax = Math.max(2048, Number(config.get('maxInputTokens', 32768)) || 32768);
    const usingProviderContext = Boolean(this.providerContextTokens);
    const providerWindowMax = usingProviderContext ? this.providerContextTokens || 0 : 0;
    const windowMax = Math.max(2048, providerWindowMax || manualWindowMax);
    const contextSource = usingProviderContext ? 'provider' : 'manual';
    const outputReserve = Math.max(0, Number(config.get('maxOutputTokens', 4096)) || 4096);
    const safetyReserve = Math.max(0, Number(config.get('contextSafetyTokens', 1024)) || 1024);
    const compactAt = this.compactThresholdPercent();

    const visibleMessages = this.messages.slice(1);
    const usableMax = Math.max(1024, windowMax - outputReserve - safetyReserve);
    if (!visibleMessages.length) {
      return {
        percent: 0,
        approx: 0,
        max: windowMax,
        available: usableMax,
        compactAt,
        windowMax,
        outputReserve,
        safetyReserve,
        toolOverhead: 0,
        requestApprox: 0,
        requestPercent: 0,
        usableMax,
        hiddenPromptApprox: 0,
        contextUsed: 0,
        contextLimit: windowMax,
        contextPercent: 0,
        contextSource
      };
    }

    const visibleApprox = visibleMessages.reduce((sum, message) => sum + this.estimateMessageTokens(message), 0);
    const requestMessages = this.messagesForCurrentMode();
    const promptApprox = requestMessages.reduce((sum, message) => sum + this.estimateMessageTokens(message), 0);
    const hiddenPromptApprox = Math.max(0, promptApprox - visibleApprox);
    const toolOverhead = this.estimateToolSchemaTokens();
    const requestApprox = promptApprox + toolOverhead;
    const totalContextApprox = requestApprox + outputReserve + safetyReserve;
    const requestPercent = this.percentFromBudget(requestApprox, windowMax);
    const percent = requestPercent;
    const approx = requestApprox;
    const available = Math.max(0, usableMax - requestApprox);
    const contextUsed = requestApprox;
    const contextLimit = windowMax;
    const contextPercent = this.percentFromBudget(contextUsed, contextLimit);

    return { percent, approx, max: windowMax, available, compactAt, windowMax, outputReserve, safetyReserve, toolOverhead, requestApprox, requestPercent, usableMax, hiddenPromptApprox, contextUsed, contextLimit, contextPercent, contextSource };
  }

  private estimateMessageTokens(message: SorexMessage): number {
    let total = this.estimateTextTokens(message.content || '');
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        total += this.estimateTextTokens(call.function?.name || '');
        total += this.estimateTextTokens(call.function?.arguments || '');
      }
    }
    return total + 4;
  }

  private estimateTextTokens(text: string): number {
    const value = String(text || '');
    if (!value) return 0;
    const pieces = value.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0;
    const charEstimate = Math.ceil(value.length / 4.15);
    const pieceEstimate = Math.ceil(pieces * 0.56);
    return Math.max(1, Math.max(charEstimate, pieceEstimate));
  }

  private estimateToolSchemaTokens(): number {
    const config = getSorexConfig();
    const enabled = Boolean(config.get('includeToolSchemaInContextBudget', true));
    if (!enabled) return 0;
    return this.estimateTextTokens(JSON.stringify(this.toolsForCurrentMode()));
  }

  private percentFromBudget(approx: number, max: number): number {
    const percent = (approx / Math.max(1, max)) * 100;
    return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
  }

  private compactThresholdPercent(): number {
    const configured = Number(getSorexConfig().get('compactAtPercent', 90));
    if (!Number.isFinite(configured)) return 90;
    return Math.max(35, Math.min(95, configured));
  }

  private postContext(): void {
    const stats = this.contextStats();
    this.view?.webview.postMessage({ type: 'context', ...stats });
  }

  private compactDonePayload(id: string, text: string, ackId = ''): Record<string, unknown> {
    return { type: 'compactDone', id, text, ackId, context: this.contextStats() };
  }

  private async postCompactDoneAndWait(id: string, text: string): Promise<void> {
    if (!this.view) return;
    const ackId = `compact-done-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const wait = this.waitForUiSpeechAck(ackId, 1800);
    this.view.webview.postMessage(this.compactDonePayload(id, text, ackId));
    await wait;
  }

  private async postCompactLineAndWait(id: string, text: string): Promise<void> {
    if (!this.view) return;
    const ackId = `compact-start-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const wait = this.waitForUiSpeechAck(ackId, 1200);
    this.view.webview.postMessage({ type: 'compactLine', id, text, ackId });
    await wait;
  }

  private async waitForCompactionIdle(): Promise<void> {
    const pending = this.compactPromise;
    if (pending) await pending;
    this.postContext();
  }

  private async compactWhenSafe(): Promise<void> {
    const activeRun = this.activeRunPromise;
    if (activeRun) {
      this.post('status', 'Compaction queued until the current tool step finishes.');
      await activeRun.catch(() => undefined);
    }
    await this.compactVisibleContext(false);
    await this.waitForCompactionIdle();
  }

  private async autoCompactIfNeeded(): Promise<boolean> {
    if (!Boolean(getSorexConfig().get('autoCompactEnabled', true))) return false;
    const stats = this.contextStats();
    const triggerPromptLimit = this.compactTriggerPromptLimit(stats);

    if (stats.requestApprox < triggerPromptLimit && stats.requestPercent < stats.compactAt) return false;
    if (!this.hasCompactableOlderMessages(true)) return false;

    const signature = `${this.messages.length}:${Math.floor(stats.requestApprox / 256)}:${stats.compactAt}`;
    if (signature === this.lastAutoCompactSignature) return false;

    this.lastAutoCompactSignature = signature;
    return this.compactVisibleContext(true);
  }

  private compactTriggerPromptLimit(stats = this.contextStats()): number {
    const configuredWindowBudget = Math.floor(stats.windowMax * (stats.compactAt / 100));
    return Math.max(1024, configuredWindowBudget - stats.outputReserve - stats.safetyReserve);
  }

  private compactionTailCount(stats: { windowMax: number; usableMax: number; compactAt: number; outputReserve: number; safetyReserve: number }, auto = true): number {
    const base = auto ? 10 : 14;
    const extra = stats.windowMax >= 48000 ? 4 : stats.windowMax >= 32000 ? 2 : 0;
    return Math.max(4, Math.min(auto ? 16 : 22, base + extra));
  }

  private compactionSummaryBudget(stats: { windowMax: number; usableMax: number; compactAt: number; outputReserve: number; safetyReserve: number }, auto = true): number {
    const targetTokens = auto
      ? Math.max(1800, Math.min(4200, Math.floor(stats.usableMax * 0.18)))
      : Math.max(2600, Math.min(6500, Math.floor(stats.usableMax * 0.24)));
    return Math.max(auto ? 7200 : 10400, targetTokens * 4);
  }

  private hasCompactableOlderMessages(auto = true): boolean {
    const stats = this.contextStats();
    const tailCount = this.compactionTailCount(stats, auto);
    return this.messages.slice(1, -tailCount).some(message => String(message.content || '').trim() || Array.isArray(message.tool_calls));
  }

  private async fitContextBeforeModelRequest(): Promise<void> {
    await this.waitForCompactionIdle();
    for (let attempt = 0; attempt < 6; attempt++) {
      const stats = this.contextStats();
      const compactPromptLimit = this.compactTriggerPromptLimit(stats);
      const hardPromptLimit = Math.floor(stats.usableMax * 0.98);
      const comfortablyFits = stats.requestApprox <= compactPromptLimit && stats.requestApprox <= Math.floor(stats.usableMax * 0.94);
      if (comfortablyFits) {
        this.postContext();
        return;
      }

      let changed = false;
      if (stats.requestApprox > compactPromptLimit && this.hasCompactableOlderMessages(true)) {
        changed = await this.compactVisibleContext(true);
        await this.waitForCompactionIdle();
      }
      if (!changed && stats.requestApprox > compactPromptLimit) {
        changed = this.trimOversizedContextPayload(compactPromptLimit, { targetIsPromptBudget: true, allowLatestUserTrim: false });
      }
      if (!changed && stats.requestApprox > hardPromptLimit) {
        changed = this.trimOversizedContextPayload(stats.usableMax);
      }
      if (!changed) break;
    }

    const after = this.contextStats();
    if (after.requestApprox > after.usableMax) {
      this.trimOversizedContextPayload(after.usableMax);
    }
    const finalStats = this.contextStats();
    if (finalStats.requestApprox > finalStats.usableMax) {
      const message = `Context is too large (${finalStats.requestApprox.toLocaleString()} / ${finalStats.usableMax.toLocaleString()} prompt tokens). Shorten the latest input or raise the model context window.`;
      this.post('status', message);
      this.postContext();
      throw new Error(message);
    }
    this.postContext();
  }

  private maxUserMessageChars(): number {
    const configured = Number(getSorexConfig().get('maxUserMessageChars', 24000));
    if (!Number.isFinite(configured) || configured <= 0) return 24000;
    return Math.max(4000, Math.min(200000, Math.floor(configured)));
  }

  private userMessageLimitError(text: string): string | undefined {
    const value = String(text || '');
    const maxChars = this.maxUserMessageChars();
    if (value.length <= maxChars) return undefined;
    return `Message is too large (${value.length.toLocaleString()} / ${maxChars.toLocaleString()} characters). Split it into smaller messages, attach the content as files, or raise Max single message chars in SOREX Settings > Context.`;
  }

  private removeLatestUserMessageFromContext(): void {
    const index = this.findLatestUserMessageIndex();
    if (index > 0) this.messages.splice(index, 1);
  }

  private trimOversizedContextPayload(
    usableMaxOrPromptBudget: number,
    options: { targetIsPromptBudget?: boolean; allowLatestUserTrim?: boolean } = {}
  ): boolean {
    let changed = false;
    const targetPromptTokens = options.targetIsPromptBudget
      ? Math.max(1200, Math.floor(usableMaxOrPromptBudget))
      : Math.max(1200, Math.floor(usableMaxOrPromptBudget * 0.82));
    const allowLatestUserTrim = options.allowLatestUserTrim !== false;

    for (let i = 1; i < this.messages.length; i++) {
      const message = this.messages[i];
      const limit = message.role === 'tool' ? 6500 : message.role === 'assistant' ? 9000 : 0;
      if (limit > 0 && String(message.content || '').length > limit) {
        message.content = this.trimTextPreservingEnds(message.content, limit, `${message.role} payload trimmed before model request`);
        changed = true;
      }
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          const args = String(call.function?.arguments || '');
          if (args.length > 8000) {
            call.function.arguments = this.trimTextPreservingEnds(args, 8000, 'tool arguments trimmed before model request');
            changed = true;
          }
        }
      }
    }

    let stats = this.contextStats();
    if (stats.requestApprox <= targetPromptTokens) return changed;

    while (this.messages.length > 4 && stats.requestApprox > targetPromptTokens) {
      this.messages.splice(1, 1);
      changed = true;
      stats = this.contextStats();
    }

    if (stats.requestApprox <= targetPromptTokens) return changed;

    if (allowLatestUserTrim) {
      const latestUserIndex = this.findLatestUserMessageIndex();
      if (latestUserIndex > 0) {
        const latest = this.messages[latestUserIndex];
        const overheadWithoutLatest = stats.requestApprox - this.estimateMessageTokens(latest);
        const allowedLatestTokens = Math.max(320, targetPromptTokens - overheadWithoutLatest);
        const allowedChars = Math.max(1200, Math.floor(allowedLatestTokens * 3.75));
        if (String(latest.content || '').length > allowedChars) {
          latest.content = this.trimWrappedUserText(latest.content, allowedChars);
          changed = true;
        }
      }
    }

    return changed;
  }

  private findLatestUserMessageIndex(): number {
    for (let i = this.messages.length - 1; i >= 1; i--) {
      if (this.messages[i].role === 'user') return i;
    }
    return -1;
  }

  private trimWrappedUserText(content: string, maxChars: number): string {
    const text = String(content || '');
    const match = text.match(/^(<user_request>\n)([\s\S]*?)(\n<\/user_request>\n\n<mode>[\s\S]*<\/mode>)$/);
    if (match) {
      return `${match[1]}${this.trimTextPreservingEnds(match[2], maxChars, 'latest user input trimmed before model request')}${match[3]}`;
    }
    return this.trimTextPreservingEnds(text, maxChars, 'message trimmed before model request');
  }

  private trimTextPreservingEnds(text: string, maxChars: number, reason: string): string {
    const value = String(text || '');
    if (value.length <= maxChars) return value;
    const marker = `

[SOREX: ${reason}; omitted ${(value.length - maxChars).toLocaleString()} characters from the middle.]

`;
    const keep = Math.max(200, maxChars - marker.length);
    const head = Math.ceil(keep * 0.62);
    const tail = Math.max(120, keep - head);
    return `${value.slice(0, head).trimEnd()}${marker}${value.slice(-tail).trimStart()}`;
  }


  private async showModePicker(): Promise<void> {
    const items: Array<vscode.QuickPickItem & { mode: 'agent' | 'ask' | 'edit' | 'plan' | 'explore' }> = [
      { label: '$(sparkle) Agent', description: 'Use tools automatically', detail: 'Best for coding tasks, repo exploration, edits, and verification.', mode: 'agent' },
      { label: '$(question) Ask', description: 'Inspect/read only', detail: 'Can search and read files, but cannot edit files or run terminal commands.', mode: 'ask' },
      { label: '$(edit) Edit', description: 'Change files with approval', detail: 'Allows edit/search/read tools but keeps destructive work gated.', mode: 'edit' },
      { label: '$(search) Explore', description: 'Investigate only', detail: 'Search/read/diagnostics only. Good for tracing code behavior.', mode: 'explore' },
      { label: '$(checklist) Plan', description: 'Plan with repo inspection', detail: 'Can inspect files and diagnostics but cannot edit.', mode: 'plan' }
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'SOREX Mode',
      placeHolder: 'Choose how SOREX should behave'
    });
    if (!picked) return;
    this.mode = picked.mode;
    this.saveRepoChatSettings();
    this.view?.webview.postMessage({ type: 'mode', text: this.mode });
  }

  private async showPermissionPicker(): Promise<void> {
    const items: Array<vscode.QuickPickItem & { permission: 'ask' | 'auto' | 'autonomous' | 'manual' }> = [
      { label: '$(hand) Ask', description: 'Confirm terminal and edits', detail: 'Read/search tools can run; edits and terminal commands ask inline.', permission: 'ask' },
      { label: '$(zap) Auto tools', description: 'Read/search automatically', detail: 'Safe inspection runs without prompts; edits and terminal commands ask.', permission: 'auto' },
      { label: '$(play) Autonomous', description: 'Run agent loop freely', detail: 'Allows tool execution without approval. Use only in trusted repos.', permission: 'autonomous' },
      { label: '$(circle-slash) Manual', description: 'Ask before every tool', detail: 'Every tool call requires inline approval.', permission: 'manual' }
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'SOREX Permissions',
      placeHolder: 'Choose what the model is allowed to do'
    });
    if (!picked) return;
    this.permissionMode = picked.permission;
    this.saveRepoChatSettings();
    this.view?.webview.postMessage({ type: 'permission', text: this.permissionMode });
  }

  private async showModelPicker(): Promise<void> {
    const local = await this.client.listLocalModels();
    const selected = String(getSorexConfig().get('model', ''));
    const items: Array<vscode.QuickPickItem & { model?: string; openSettings?: boolean }> = [];
    items.push({ label: '$(server) Auto', description: 'Local first', detail: 'Use the configured/default local model when available.', model: local[0]?.id || selected });
    for (const model of local) {
      items.push({
        label: `$(chip) ${model.name || model.id}`,
        description: model.id === selected ? 'selected - local' : 'local',
        detail: model.id,
        model: model.id,
        picked: model.id === selected
      });
    }
    if (!local.length) {
      items.push({ label: '$(warning) No local models detected', description: 'Start LM Studio server', detail: 'SOREX could not read /v1/models from your configured endpoint.' });
    }
    const providerMode = String(getSorexConfig().get('providerMode', 'lmstudio'));
    const providerLabel = this.providerModeLabel(providerMode);
    if (['openai', 'anthropic', 'google', 'openrouter'].includes(providerMode)) {
      items.push({ label: `$(cloud) ${providerLabel} cloud model`, description: selected ? 'selected in settings' : 'set in settings', detail: selected || `Open SOREX Settings to set an exact ${providerLabel} model id.`, openSettings: true });
    } else {
      items.push({ label: '$(gear) Provider settings', description: providerLabel, detail: 'Cloud providers and exact model ids are configured in SOREX settings.', openSettings: true });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'SOREX Model',
      placeHolder: 'Local models are listed first',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (picked?.openSettings) {
      await vscode.commands.executeCommand('sorex.openSettings');
      return;
    }
    if (!picked?.model) return;
    await getSorexConfig().update('model', picked.model);
    await this.postModels();
  }


  private providerModeLabel(mode: string): string {
    const labels: Record<string, string> = {
      lmstudio: 'LM Studio',
      ollama: 'Ollama',
      jan: 'Jan',
      custom: 'OpenAI-compatible',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      google: 'Google',
      openrouter: 'OpenRouter'
    };
    return labels[mode] ?? 'Provider';
  }

  private async postModels(): Promise<void> {
    const models = await this.client.listLocalModels();
    const config = getSorexConfig();
    const providerMode = String(config.get('providerMode', 'lmstudio'));
    const model = this.client.modelFor(providerMode as any) || String(config.get('model', ''));
    const cloudModels = {
      openai: cloudModelsFor('openai'),
      anthropic: cloudModelsFor('anthropic'),
      google: cloudModelsFor('google'),
      openrouter: cloudModelsFor('openrouter')
    };
    const cloudApiKeys = {
      openai: await this.client.hasCloudApiKey('openai'),
      anthropic: await this.client.hasCloudApiKey('anthropic'),
      google: await this.client.hasCloudApiKey('google'),
      openrouter: await this.client.hasCloudApiKey('openrouter')
    };
    this.view?.webview.postMessage({ type: 'models', models, model, providerMode, cloudModels, cloudApiKeys });
    await this.refreshProviderContext();
  }

  private async refreshProviderContext(force = false): Promise<void> {
    const config = getSorexConfig();
    const providerMode = String(config.get('providerMode', 'lmstudio')) as any;
    const model = this.client.modelFor(providerMode);
    const endpoint = this.client.endpointFor(providerMode);
    const signature = [providerMode, model, endpoint, 'provider-context-auto'].join('\\n');
    if (!force && signature === this.providerContextSignature) {
      this.postContext();
      return;
    }
    this.providerContextSignature = signature;
    this.providerContextTokens = await this.client.providerContextTokens(providerMode, model);
    if (this.providerContextTokens && Number(config.get('maxInputTokens', 32768)) !== this.providerContextTokens) {
      await config.update('maxInputTokens', this.providerContextTokens);
    }
    this.postContext();
  }

  async refreshModels(): Promise<void> {
    await this.refreshProviderContext(true);
    await this.postModels();
  }

  private async compactVisibleContext(auto = false): Promise<boolean> {
    if (this.compactPromise) return this.compactPromise;
    this.compactPromise = this.runCompactVisibleContext(auto).finally(() => { this.compactPromise = undefined; });
    return this.compactPromise;
  }

  private async runCompactVisibleContext(auto = false): Promise<boolean> {
    const statsBefore = this.contextStats();
    if (this.messages.length <= 3) {
      if (statsBefore.requestApprox > Math.floor(statsBefore.usableMax * 0.72)) {
        const compactId = `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await this.postCompactLineAndWait(compactId, 'Trimming Oversized Input');
        const changed = this.trimOversizedContextPayload(statsBefore.usableMax);
        await this.postCompactDoneAndWait(compactId, changed ? 'Oversized Input Trimmed' : 'Compaction Stopped');
        await this.waitForToolUiBeat(120);
        return changed;
      }
      if (!auto) {
        const compactId = `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await this.postCompactLineAndWait(compactId, 'Checking Conversation');
        await this.postCompactDoneAndWait(compactId, 'Nothing To Compact');
        await this.waitForToolUiBeat(120);
      }
      return false;
    }

    const system = this.messages[0];
    const tailCount = this.compactionTailCount(statsBefore, auto);
    const keepTail = this.messages.slice(-tailCount);
    const older = this.messages.slice(1, -tailCount);
    if (!older.length) {
      if (statsBefore.requestApprox > Math.floor(statsBefore.usableMax * 0.72)) {
        const compactId = `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await this.postCompactLineAndWait(compactId, 'Trimming Oversized Context');
        const changed = this.trimOversizedContextPayload(statsBefore.usableMax);
        await this.postCompactDoneAndWait(compactId, changed ? 'Oversized Context Trimmed' : 'Compaction Stopped');
        await this.waitForToolUiBeat(120);
        return changed;
      }
      if (!auto) {
        const compactId = `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await this.postCompactLineAndWait(compactId, 'Checking Conversation');
        await this.postCompactDoneAndWait(compactId, 'Nothing To Compact');
        await this.waitForToolUiBeat(120);
      }
      return false;
    }

    const compactId = `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await this.postCompactLineAndWait(compactId, 'Compacting Conversation');

    const summaryBudget = this.compactionSummaryBudget(statsBefore, auto);
    let summary = '';
    try {
      summary = await this.summarizeMessagesWithModel(older, summaryBudget, keepTail);
    } catch {
      summary = this.compactMessagesToText(older, summaryBudget);
    }

    if (this.stopRequested) {
      await this.postCompactDoneAndWait(compactId, 'Compaction Stopped');
      return false;
    }

    this.messages.splice(0, this.messages.length, system, {
      role: 'user',
      content: `<compacted_history>
Previous conversation compacted by the active model. Preserve these facts and continue from the current request.
${summary}
</compacted_history>`
    }, ...keepTail);

    const after = this.contextStats();
    this.lastAutoCompactAt = Date.now();
    this.lastAutoCompactSignature = `${this.messages.length}:${Math.floor(after.requestApprox / 256)}:${after.compactAt}`;
    await this.postCompactDoneAndWait(compactId, 'Conversation Compacted');
    await this.waitForToolUiBeat(120);
    return true;
  }


  private async summarizeMessagesWithModel(messages: SorexMessage[], maxChars: number, recentTail: SorexMessage[] = []): Promise<string> {
    const raw = this.compactMessagesToText(messages, Math.max(maxChars * 3, 12000));
    const recent = recentTail.length ? this.compactMessagesToText(recentTail, 9000) : '(no recent tail provided)';
    const targetChars = Math.max(1200, maxChars);
    const result = await this.client.chat({
      messages: [
        {
          role: 'system',
          content: [
            'You are SOREX context compactor. Produce dense continuation memory for a coding agent.',
            'This is lossy compression, so preserve operational facts aggressively.',
            'Use structured sections: Objective, User preferences, Files/commands/tools, Decisions made, Current state, Open next steps, Do-not-forget.',
            'Use the recent active conversation only as continuity context so the compacted memory does not contradict what remains uncompressed.',
            'Do not call tools. Do not add commentary about compaction.'
          ].join(' ')
        },
        {
          role: 'user',
          content: `Compress OLD history into at most ${targetChars} characters. The RECENT ACTIVE TAIL below will remain raw in context, so summarize old history in a way that makes continuation feel seamless without duplicating every recent line.\n\n<recent_active_tail_kept_raw>\n${recent}\n</recent_active_tail_kept_raw>\n\n<old_history_to_compact>\n${raw}\n</old_history_to_compact>`
        }
      ],
      signal: this.activeAbort?.signal
    });
    const summary = String(result.content || '').trim();
    if (!summary) return this.compactMessagesToText(messages, maxChars);
    return summary.length > maxChars ? `${summary.slice(0, maxChars - 32).trim()}\n...` : summary;
  }

  private compactMessagesToText(messages: SorexMessage[], maxChars: number): string {
    const lines: string[] = [];
    let used = 0;

    for (const message of messages) {
      const content = String(message.content || '')
        .replace(/<user_request>|<\/user_request>|<mode>.*?<\/mode>/gs, '')
        .replace(/\s+/g, ' ')
        .trim();
      const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls.map(call => `${call.function?.name || 'tool'} ${String(call.function?.arguments || '').slice(0, 520)}`).join(' | ')
        : '';
      const merged = [content, toolCalls ? `tool_calls: ${toolCalls}` : ''].filter(Boolean).join(' ');
      if (!merged) continue;
      const line = `${message.role}: ${merged.slice(0, 900)}`;
      if (used + line.length + 2 > maxChars) {
        lines.push(`... omitted ${Math.max(0, messages.length - lines.length)} older messages during compaction ...`);
        break;
      }
      lines.push(line);
      used += line.length + 2;
    }

    return lines.length ? lines.join('\n') : '(no older content kept)';
  }

  private contextNotice(): string {
    const stats = this.contextStats();
    if (stats.requestPercent >= stats.compactAt) return `Total context approx ${stats.requestPercent}% â€” compact soon or raise context.`;
    return `Total context approx ${stats.requestPercent}%`;
  }

  private postModelSpeed(startedAt: number, result: { content: string; toolCalls: Array<{ function?: { arguments?: string } }> }): void {
    const elapsedSeconds = Math.max(0.25, (Date.now() - startedAt) / 1000);
    let produced = this.estimateTextTokens(result.content || '');
    for (const call of result.toolCalls || []) {
      produced += this.estimateTextTokens(call.function?.arguments || '');
    }
    const tokensPerSecond = Math.max(0.1, produced / elapsedSeconds);
    this.lastRuntimeTokensPerSecond = tokensPerSecond;
    this.view?.webview.postMessage({ type: 'modelSpeed', tokensPerSecond, elapsedMs: Date.now() - startedAt });
  }

  private post(type: string, text: string): void {
    this.view?.webview.postMessage({ type, text });
  }
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


