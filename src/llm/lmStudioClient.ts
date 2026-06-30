import * as vscode from 'vscode';
import { getSorexConfig } from '../config/sorexConfig';
import { CLOUD_PROVIDER_MODES, ProviderMode, PROVIDERS, isProviderMode, providerDefinition } from './providerRegistry';

export interface SorexMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: SorexToolCall[];
}

export interface SorexToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface SorexToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface SorexChatOptions {
  messages: SorexMessage[];
  tools?: SorexToolSchema[];
  signal?: AbortSignal;
}

export interface SorexChatResult {
  content: string;
  toolCalls: SorexToolCall[];
}

export interface SorexModelInfo {
  id: string;
  name: string;
  provider: 'local' | 'cloud' | 'custom';
}

const CLOUD_PROVIDERS = new Set<ProviderMode>(CLOUD_PROVIDER_MODES);

export class LmStudioClient {
  constructor(private readonly context?: vscode.ExtensionContext) {}

  private get config() {
    return getSorexConfig();
  }

  get providerMode(): ProviderMode {
    const raw = String(this.config.get('providerMode', 'lmstudio')).toLowerCase();
    if (isProviderMode(raw)) return raw;
    return 'lmstudio';
  }

  get endpoint(): string {
    return this.endpointFor(this.providerMode).replace(/\/$/, '');
  }

  get model(): string {
    return this.modelFor(this.providerMode);
  }

  isCloudProvider(mode = this.providerMode): boolean {
    return CLOUD_PROVIDERS.has(mode as ProviderMode);
  }

  providerLabel(mode = this.providerMode): string {
    return PROVIDERS[mode as ProviderMode]?.label ?? 'Provider';
  }

  endpointFor(mode: ProviderMode): string {
    const provider = providerDefinition(mode);
    return String(this.config.get(provider.endpointConfigKey, provider.defaultEndpoint) || provider.defaultEndpoint);
  }

  modelFor(mode: ProviderMode): string {
    const provider = providerDefinition(mode);
    const model = String(this.config.get(provider.modelConfigKey, '') || this.config.get('model', '')).trim();
    return mode === 'openrouter' ? normalizeOpenRouterModel(model) : model;
  }

  async listLocalModels(): Promise<SorexModelInfo[]> {
    try {
      const response = await fetch(`${String(this.config.get('endpoint', 'http://localhost:1234/v1')).replace(/\/$/, '')}/models`, { method: 'GET' });
      if (!response.ok) return [];
      const json = await response.json() as any;
      const data = Array.isArray(json?.data) ? json.data : [];
      return data
        .map((item: any) => String(item?.id ?? item?.name ?? '').trim())
        .filter(Boolean)
        .map((id: string) => ({ id, name: id, provider: 'local' as const }));
    } catch {
      return [];
    }
  }

  async providerContextTokens(mode = this.providerMode, model = this.modelFor(mode)): Promise<number | undefined> {
    const cleanModel = String(model || '').trim();
    if (!cleanModel) return undefined;
    try {
      const endpoint = this.endpointFor(mode).replace(/\/$/, '');
      if (mode === 'lmstudio') {
        const tokens = await this.lmStudioContextTokens(endpoint, cleanModel);
        if (tokens) return tokens;
      }
      if (mode === 'ollama') {
        const tokens = await this.ollamaContextTokens(endpoint, cleanModel);
        if (tokens) return tokens;
      }
      const headers: Record<string, string> = {};
      if (this.isCloudProvider(mode)) {
        const key = await this.getCloudApiKey(mode);
        if (key) headers.Authorization = `Bearer ${key}`;
      }
      const response = await fetch(`${endpoint}/models`, { method: 'GET', headers });
      if (!response.ok) return undefined;
      const json = await response.json() as any;
      const data = Array.isArray(json?.data) ? json.data : [];
      const match = data.find((item: any) => String(item?.id ?? item?.name ?? '').trim() === cleanModel)
        || data.find((item: any) => String(item?.id ?? item?.name ?? '').trim().toLowerCase() === cleanModel.toLowerCase());
      const fromOpenAiModels = contextTokensFromModelInfo(match);
      if (fromOpenAiModels) return fromOpenAiModels;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async lmStudioContextTokens(endpoint: string, model: string): Promise<number | undefined> {
    try {
      const root = endpoint.replace(/\/v1$/i, '');
      const response = await fetch(`${root}/api/v0/models`, { method: 'GET' });
      if (!response.ok) return undefined;
      const json = await response.json() as any;
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const match = data.find((item: any) => String(item?.id ?? item?.model_key ?? item?.path ?? '').trim() === model)
        || data.find((item: any) => String(item?.id ?? item?.model_key ?? item?.path ?? '').trim().toLowerCase() === model.toLowerCase());
      return contextTokensFromModelInfo(match);
    } catch {
      return undefined;
    }
  }

  private async ollamaContextTokens(endpoint: string, model: string): Promise<number | undefined> {
    try {
      const root = endpoint.replace(/\/v1$/i, '');
      const response = await fetch(`${root}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model })
      });
      if (!response.ok) return undefined;
      const json = await response.json() as any;
      return contextTokensFromModelInfo(json);
    } catch {
      return undefined;
    }
  }

  async getCloudApiKey(mode = this.providerMode): Promise<string> {
    const keyName = secretNameForProvider(mode as ProviderMode);
    if (!keyName) return '';
    const saved = this.context ? await this.context.secrets.get(keyName) : '';
    return String(saved || '').trim();
  }

  async setCloudApiKey(mode: ProviderMode, value: string): Promise<void> {
    const keyName = secretNameForProvider(mode);
    if (!keyName) throw new Error(`${this.providerLabel(mode)} does not support API key storage.`);
    if (!this.context) throw new Error('SOREX secret storage is not available yet. Reload the extension window and try saving again.');
    const clean = String(value || '').trim();
    if (!clean) return;
    await this.context.secrets.store(keyName, clean);
    const saved = String(await this.context.secrets.get(keyName) || '').trim();
    if (saved !== clean) throw new Error(`${this.providerLabel(mode)} API key did not persist. VS Code secret storage rejected the save.`);
  }

  async clearCloudApiKey(mode: ProviderMode): Promise<void> {
    const keyName = secretNameForProvider(mode);
    if (!keyName || !this.context) return;
    await this.context.secrets.delete(keyName);
  }

  async hasCloudApiKey(mode: ProviderMode): Promise<boolean> {
    return Boolean(await this.getCloudApiKey(mode));
  }


  async setIndexEmbeddingApiKey(value: string): Promise<void> {
    if (!this.context) throw new Error('SOREX secret storage is not available yet. Reload the extension window and try saving again.');
    const clean = String(value || '').trim();
    if (!clean) return;
    await this.context.secrets.store('sorex.indexEmbeddingApiKey', clean);
    const saved = String(await this.context.secrets.get('sorex.indexEmbeddingApiKey') || '').trim();
    if (saved !== clean) throw new Error('Embedding API key did not persist. VS Code secret storage rejected the save.');
  }

  async clearIndexEmbeddingApiKey(): Promise<void> {
    if (!this.context) return;
    await this.context.secrets.delete('sorex.indexEmbeddingApiKey');
  }

  async hasIndexEmbeddingApiKey(): Promise<boolean> {
    if (!this.context) return false;
    return Boolean((await this.context.secrets.get('sorex.indexEmbeddingApiKey')) || '');
  }


  embeddingEndpointFor(rawProvider?: string): string {
    const provider = String(rawProvider || this.config.get('indexEmbeddingProvider', 'active') || 'active').toLowerCase();
    const mode = provider === 'active' ? this.providerMode : provider as ProviderMode;
    const custom = String(this.config.get('indexEmbeddingEndpoint', '') || '').trim();
    if (custom) return custom.replace(/\/$/, '');
    if (['lmstudio', 'ollama', 'jan', 'custom', 'openai', 'google', 'openrouter'].includes(mode)) return this.endpointFor(mode).replace(/\/$/, '');
    return this.endpoint.replace(/\/$/, '');
  }

  embeddingProviderMode(rawProvider?: string): ProviderMode | 'active' {
    const provider = String(rawProvider || this.config.get('indexEmbeddingProvider', 'active') || 'active').toLowerCase();
    if (provider === 'active') return 'active';
    if (['lmstudio', 'ollama', 'jan', 'custom', 'openai', 'anthropic', 'google', 'openrouter'].includes(provider)) return provider as ProviderMode;
    return 'active';
  }

  async listEmbeddingModels(options?: { provider?: string; endpoint?: string; apiKey?: string }): Promise<SorexModelInfo[]> {
    const selectedProvider = this.embeddingProviderMode(options?.provider);
    const mode = selectedProvider === 'active' ? this.providerMode : selectedProvider;

    if (mode === 'anthropic') return [];
    if (mode === 'openai') {
      return ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002']
        .map(id => ({ id, name: id, provider: 'cloud' as const }));
    }
    if (mode === 'google') {
      return ['text-embedding-004', 'gemini-embedding-001']
        .map(id => ({ id, name: id, provider: 'cloud' as const }));
    }
    if (mode === 'openrouter') {
      return ['openai/text-embedding-3-large', 'openai/text-embedding-3-small', 'openai/text-embedding-ada-002']
        .map(id => ({ id, name: id, provider: 'cloud' as const }));
    }

    const endpoint = String(options?.endpoint || this.config.get('indexEmbeddingEndpoint', '') || this.endpointFor(mode)).replace(/\/$/, '');
    try {
      const headers: Record<string, string> = {};
      const key = String(options?.apiKey || '').trim() || (this.context ? String(await this.context.secrets.get('sorex.indexEmbeddingApiKey') || '').trim() : '');
      if (key) headers.Authorization = `Bearer ${key}`;
      const response = await fetch(`${endpoint}/models`, { method: 'GET', headers });
      if (!response.ok) return [];
      const json = await response.json() as any;
      const data = Array.isArray(json?.data) ? json.data : [];
      const models = data
        .map((item: any) => ({
          id: String(item?.id ?? item?.name ?? '').trim(),
          raw: `${item?.id ?? ''} ${item?.name ?? ''} ${item?.type ?? ''} ${item?.family ?? ''} ${item?.owned_by ?? ''}`
        }))
        .filter((item: { id: string; raw: string }) => Boolean(item.id));
      const embedLike = models.filter((item: { id: string; raw: string }) => /embed|embedding|nomic|bge|e5|gte|jina|minilm|snowflake|arctic/i.test(item.raw));
      return embedLike.map((item: { id: string }) => ({ id: item.id, name: item.id, provider: this.isCloudProvider(mode) ? 'cloud' as const : 'local' as const }));
    } catch {
      return [];
    }
  }

  async resolveEmbeddingModel(options?: { provider?: string; endpoint?: string; model?: string; apiKey?: string }): Promise<string> {
    const explicit = String(options?.model || this.config.get('indexEmbeddingModel', '') || '').trim();
    if (explicit) return explicit;
    if (!Boolean(this.config.get('indexEmbeddingAutoSelect', true))) return '';
    const models = await this.listEmbeddingModels(options);
    return models[0]?.id || '';
  }

  async embedTexts(inputs: string[], options?: { provider?: string; endpoint?: string; model?: string; apiKey?: string; signal?: AbortSignal }): Promise<number[][]> {
    const cleanInputs = inputs.map(value => String(value || '')).filter(value => value.trim());
    if (!cleanInputs.length) return [];

    const selectedProvider = this.embeddingProviderMode(options?.provider);
    const mode = selectedProvider === 'active' ? this.providerMode : selectedProvider;
    if (mode === 'anthropic') throw new Error('Anthropic does not provide an OpenAI-compatible embeddings endpoint. Select LM Studio, OpenAI, Google, or Custom for index embeddings.');
    const endpoint = String(options?.endpoint || this.config.get('indexEmbeddingEndpoint', '') || this.embeddingEndpointFor(selectedProvider)).replace(/\/$/, '');
    const model = await this.resolveEmbeddingModel({ provider: selectedProvider, endpoint, model: options?.model, apiKey: options?.apiKey });
    if (!model) throw new Error('No embedding model found. Select an embedding provider/model in SOREX Settings > Indexing.');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const customKey = String(options?.apiKey || '').trim() || (this.context ? String(await this.context.secrets.get('sorex.indexEmbeddingApiKey') || '').trim() : '');
    if (customKey) {
      headers.Authorization = `Bearer ${customKey}`;
    } else if (this.isCloudProvider(mode)) {
      const key = await this.getCloudApiKey(mode);
      if (key) headers.Authorization = `Bearer ${key}`;
    }

    const response = await fetch(`${endpoint}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: cleanInputs }),
      signal: options?.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding request failed: ${response.status} ${response.statusText}${text ? `\n${text.slice(0, 600)}` : ''}`);
    }

    const json = await response.json() as any;
    const data = Array.isArray(json?.data) ? json.data : [];
    const vectors = data
      .sort((a: any, b: any) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
      .map((item: any) => Array.isArray(item?.embedding) ? item.embedding.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : []);
    if (vectors.length !== cleanInputs.length || vectors.some((v: number[]) => !v.length)) {
      throw new Error('Embedding endpoint returned missing or invalid vectors.');
    }
    return vectors;
  }

  async chat(options: SorexChatOptions): Promise<SorexChatResult> {
    const mode = this.providerMode;
    if (mode === 'anthropic') return this.chatAnthropic(options);
    return this.chatOpenAiCompatible(options, mode);
  }

  private async chatOpenAiCompatible(options: SorexChatOptions, mode: ProviderMode): Promise<SorexChatResult> {
    const maxTokens = Number(this.config.get('maxOutputTokens', 4096));
    const temperature = Number(this.config.get('temperature', 0.1));
    const model = this.modelFor(mode);

    if (!model) {
      throw new Error(`No SOREX model selected. Set a ${this.providerLabel(mode)} model in SOREX Settings.`);
    }

    const body: Record<string, unknown> = {
      model,
      messages: options.messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };

    const nativeToolsEnabled = supportsNativeTools(mode, model);
    if (nativeToolsEnabled && options.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = 'auto';
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.isCloudProvider(mode)) {
      const key = await this.getCloudApiKey(mode);
      if (!key) throw new Error(`${this.providerLabel(mode)} API key is missing. Add it in SOREX Settings > Providers.`);
      headers.Authorization = `Bearer ${key}`;
      if (mode === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/sorex-code/sorex-code';
        headers['X-Title'] = 'SOREX Code';
      }
    }

    const endpoint = `${this.endpointFor(mode).replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(formatProviderHttpError(this.providerLabel(mode), response.status, response.statusText, text, model));
    }

    return this.parseOpenAiCompatibleChatResponse(model, await response.json(), options);
  }

  private parseOpenAiCompatibleChatResponse(model: string, json: any, options: SorexChatOptions): SorexChatResult {
    const message = json?.choices?.[0]?.message ?? {};
    const rawContent = typeof message.content === 'string' ? message.content : '';
    const nativeToolCalls = normalizeOpenAiToolCalls(message);
    if (nativeToolCalls.length) return { content: rawContent, toolCalls: nativeToolCalls };

    if (options.tools?.length) {
      const parsed = extractTextToolCalls(rawContent);
      return { content: parsed.content, toolCalls: parsed.toolCalls };
    }
    return { content: rawContent.trim(), toolCalls: [] };
  }

  private async chatAnthropic(options: SorexChatOptions): Promise<SorexChatResult> {
    const mode: ProviderMode = 'anthropic';
    const model = this.modelFor(mode);
    const key = await this.getCloudApiKey(mode);
    if (!model) throw new Error('No Anthropic model selected. Set it in SOREX Settings > Providers.');
    if (!key) throw new Error('Anthropic API key is missing. Add it in SOREX Settings > Providers.');

    const { system, messages } = convertToAnthropicMessages(options.messages);
    const body: Record<string, unknown> = {
      model,
      max_tokens: Number(this.config.get('maxOutputTokens', 4096)),
      temperature: Number(this.config.get('temperature', 0.1)),
      messages
    };
    if (system) body.system = system;
    if (options.tools?.length) {
      body.tools = options.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters
      }));
    }

    const response = await fetch(`${this.endpointFor(mode).replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: options.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(formatProviderHttpError('Anthropic', response.status, response.statusText, text, model));
    }

    const json = await response.json() as any;
    const blocks = Array.isArray(json?.content) ? json.content : [];
    const rawContent = blocks.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text || '')).join('\n').trim();
    const nativeToolCalls = blocks
      .filter((b: any) => b?.type === 'tool_use' && b?.name)
      .map((b: any) => ({
        id: String(b.id || makeToolCallId()),
        type: 'function' as const,
        function: { name: String(b.name), arguments: JSON.stringify(b.input || {}) }
      }));
    if (nativeToolCalls.length) return { content: rawContent, toolCalls: nativeToolCalls };

    if (options.tools?.length) {
      const parsed = extractTextToolCalls(rawContent);
      return { content: parsed.content, toolCalls: parsed.toolCalls };
    }
    return { content: rawContent.trim(), toolCalls: [] };
  }
}

function formatProviderHttpError(provider: string, status: number, statusText: string, rawBody: string, model?: string): string {
  const body = String(rawBody || '').trim();
  const lower = body.toLowerCase();
  let providerMessage = '';
  try {
    const parsed = JSON.parse(body);
    providerMessage = String(parsed?.error?.message || parsed?.message || parsed?.error || '').trim();
  } catch {
    providerMessage = body.replace(/\s+/g, ' ').slice(0, 500);
  }

  const text = `${status} ${statusText} ${lower}`;
  const label = String(provider || 'Provider');
  const modelHint = model ? ` Model: ${model}.` : '';
  if (/no provider|provider returned|provider error|no endpoints?|model not found|not found|unavailable|unsupported|requires.*provider|provider.*unavailable/.test(text)) {
    return `${label} provider/model error.${modelHint} ${providerMessage || 'The selected model is unavailable through the provider right now. Check the exact model id and try another model if needed.'}`;
  }
  if (status === 429 || /rate.?limit|too many requests|quota|exceed|exceeded|insufficient_quota|capacity/.test(text)) {
    return `${label} API limit reached. ${providerMessage || 'The provider reported a rate limit, quota limit, billing limit, or temporary capacity limit.'}`;
  }
  if (/credits?|billing/.test(text)) {
    return `${label} billing or credits issue. ${providerMessage || 'The provider reported a billing or credits requirement for this request.'}`;
  }
  if (status === 401 || /invalid api key|unauthorized|authentication/.test(text)) {
    return `${label} API key was rejected. Check the key saved in SOREX Settings > Providers. ${providerMessage}`.trim();
  }
  if (status === 403 || /permission|forbidden|not authorized/.test(text)) {
    return `${label} API access was blocked. The key may not have permission for this model or endpoint. ${providerMessage}`.trim();
  }
  return `SOREX ${label} request failed: ${status} ${statusText}${providerMessage ? `\n${providerMessage}` : ''}`;
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

function supportsNativeTools(mode: ProviderMode, model: string): boolean {
  if (!Boolean(getSorexConfig().get('nativeToolCallingEnabled', true))) return false;
  const id = String(model || '').trim().toLowerCase();
  if (mode === 'openrouter' && /(^|:)free$/i.test(id)) return false;
  if (mode === 'openrouter' && /(laguna|north|mini-code|qwen3-coder|coder.*free)/i.test(id)) return false;
  return true;
}


const KNOWN_TOOL_NAMES = new Set([
  'list_dir',
  'file_search',
  'grep_search',
  'read_file',
  'replace_string_in_file',
  'replace_range_in_file',
  'insert_text_in_file',
  'write_file',
  'delete_file',
  'create_directory',
  'git_diff',
  'get_errors',
  'workspace_index_search',
  'workspace_index_refresh',
  'web_search',
  'web_fetch',
  'run_in_terminal'
]);

function makeToolCallId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function extractTextToolCalls(rawContent: string): { content: string; toolCalls: SorexToolCall[] } {
  const content = String(rawContent || '');
  const toolCalls: SorexToolCall[] = [];
  let cleaned = content;

  const consumeJsonCandidate = (candidate: string): boolean => {
    const parsed = parseJsonCandidate(candidate);
    if (typeof parsed === 'undefined') return false;
    const calls = toolCallsFromParsedValue(parsed);
    if (!calls.length) return false;
    toolCalls.push(...calls);
    return true;
  };

  cleaned = cleaned.replace(/```(?:sorex_tool|tool_call|tools?|json)\s*\n([\s\S]*?)```/gi, (full, body) => {
    return consumeJsonCandidate(body) ? '' : full;
  });

  cleaned = cleaned.replace(/<(?:sorex_tool|tool_call|tool)>\s*([\s\S]*?)\s*<\/(?:sorex_tool|tool_call|tool)>/gi, (full, body) => {
    return consumeJsonCandidate(body) ? '' : full;
  });

  cleaned = cleaned.replace(/<tool_call>\s*([a-z_][a-z0-9_]*)\s*>?\s*([\s\S]*?)(?:<\/tool_call>|$)/gi, (full, name, body) => {
    const call = toolCallFromLegacyXmlish(String(name), String(body || ''));
    if (!call) return full;
    toolCalls.push(call);
    return '';
  });

  cleaned = cleaned.replace(/(?:^|\n)\s*(list_dir|file_search|grep_search|read_file|git_diff|replace_string_in_file|replace_range_in_file|insert_text_in_file|write_file|delete_file|create_directory|get_errors|workspace_index_search|workspace_index_refresh|web_search|web_fetch|run_in_terminal)\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*(?=\n|$)/g, (full, name, body) => {
    const parsedArgs = parseJsonCandidate(body);
    if (typeof parsedArgs === 'undefined' || Array.isArray(parsedArgs) || parsedArgs === null || typeof parsedArgs !== 'object') return full;
    toolCalls.push({
      id: makeToolCallId(),
      type: 'function',
      function: { name: String(name), arguments: JSON.stringify(parsedArgs) }
    });
    return '';
  });

  if (!toolCalls.length && consumeJsonCandidate(cleaned.trim())) cleaned = '';

  return { content: cleaned.trim(), toolCalls };
}

function toolCallFromLegacyXmlish(rawName: string, body: string): SorexToolCall | undefined {
  const name = String(rawName || '').replace(/[^a-z0-9_]/gi, '').trim();
  if (!KNOWN_TOOL_NAMES.has(name)) return undefined;

  const args: Record<string, string> = {};
  const text = String(body || '');
  const pairPattern = /<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  let pair: RegExpExecArray | null;
  while ((pair = pairPattern.exec(text))) {
    const key = String(pair[1] || '').trim();
    if (!key) continue;
    args[key] = stripToolTextValue(pair[2]);
  }

  const looseKey = /<arg_key>\s*([^<]+?)\s*<\/arg_key>/i.exec(text);
  const looseValue = /<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/i.exec(text);
  if (!Object.keys(args).length && looseKey?.[1]) {
    args[String(looseKey[1]).trim()] = looseValue ? stripToolTextValue(looseValue[1]) : '';
  }

  return {
    id: makeToolCallId(),
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  };
}

function stripToolTextValue(value: string): string {
  return String(value || '')
    .replace(/<\/?arg_key>/gi, '')
    .replace(/<\/?arg_value>/gi, '')
    .replace(/<\/?tool_call>/gi, '')
    .trim();
}

function parseJsonCandidate(candidate: string): any | undefined {
  const text = String(candidate || '').trim();
  if (!text) return undefined;

  const attempts = new Set<string>();
  attempts.add(text);

  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) attempts.add(text.slice(firstObject, lastObject + 1));

  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) attempts.add(text.slice(firstArray, lastArray + 1));

  for (const raw of attempts) {
    try { return JSON.parse(raw); } catch {}
    try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }

  return undefined;
}

function toolCallsFromParsedValue(value: any): SorexToolCall[] {
  const items = Array.isArray(value) ? value : [value];
  const calls: SorexToolCall[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const fn = item.function && typeof item.function === 'object' ? item.function : undefined;
    const name = String(item.name || item.tool || item.tool_name || fn?.name || '').trim();
    if (!KNOWN_TOOL_NAMES.has(name)) continue;

    let args = item.arguments ?? item.args ?? item.input ?? item.parameters ?? fn?.arguments ?? {};
    if (typeof args === 'string') {
      const parsedArgs = parseJsonCandidate(args);
      args = typeof parsedArgs === 'undefined' ? {} : parsedArgs;
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};

    calls.push({
      id: String(item.id || makeToolCallId()),
      type: 'function',
      function: { name, arguments: JSON.stringify(args) }
    });
  }

  return calls;
}

function normalizeOpenAiToolCalls(message: any): SorexToolCall[] {
  const normalized: SorexToolCall[] = [];
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    const fn = call?.function ?? {};
    const name = String(fn.name || call?.name || '').trim();
    if (!name) continue;
    const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {});
    normalized.push({
      id: String(call.id || makeToolCallId()),
      type: 'function',
      function: { name, arguments: args }
    });
  }

  if (!normalized.length && message?.function_call?.name) {
    const fn = message.function_call;
    normalized.push({
      id: String(fn.id || makeToolCallId()),
      type: 'function',
      function: {
        name: String(fn.name),
        arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {})
      }
    });
  }

  return normalized;
}

function defaultLocalEndpoint(mode: ProviderMode): string {
  return providerDefinition(mode).defaultEndpoint;
}

function secretNameForProvider(mode: ProviderMode): string | undefined {
  return providerDefinition(mode).secretKey;
}

function convertToAnthropicMessages(messages: SorexMessage[]): { system: string; messages: any[] } {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const converted: any[] = [];

  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      converted.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.tool_call_id || 'tool', content: message.content || '' }]
      });
      continue;
    }
    if (message.role === 'assistant') {
      const content: any[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          let input: any = {};
          try { input = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { input = {}; }
          content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
        }
      }
      converted.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }] });
      continue;
    }
    converted.push({ role: 'user', content: message.content || '' });
  }

  return { system, messages: converted };
}


function contextTokensFromModelInfo(item: any): number | undefined {
  if (!item || typeof item !== 'object') return undefined;
  return firstTokenCandidate([
    item.loaded_context_length,
    item.loadedContextLength,
    item.loaded_context_window,
    item.loadedContextWindow,
    item.runtime_context_length,
    item.runtimeContextLength,
    item.active_context_length,
    item.activeContextLength,
    item.context_length,
    item.contextLength,
    item.context_window,
    item.contextWindow,
    item.num_ctx,
    item.numCtx,
    item.n_ctx,
    item.parameters?.num_ctx,
    item.parameters?.numCtx,
    item.options?.num_ctx,
    item.options?.numCtx,
    contextTokensFromNestedModelInfo(item, /^(loaded|runtime|active|current)?(context|ctx|contextwindow|contextlength|numctx|nctx)$/i)
  ]) ?? firstTokenCandidate([
    item.max_context_length,
    item.maxContextLength,
    item.max_context_window,
    item.maxContextWindow,
    item.max_input_tokens,
    item.maxInputTokens,
    item?.top_provider?.context_length,
    item?.architecture?.context_length,
    item?.pricing?.context_length,
    contextTokensFromNestedModelInfo(item, /(max.*(context|ctx|window|tokens|input)|(context|ctx).*max)/i)
  ]);
}

function firstTokenCandidate(values: unknown[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 2048 && n <= 10000000) return Math.floor(n);
  }
  return undefined;
}

function contextTokensFromNestedModelInfo(item: any, keyPattern: RegExp, seen = new Set<any>()): number | undefined {
  if (!item || typeof item !== 'object' || seen.has(item)) return undefined;
  seen.add(item);
  for (const [key, value] of Object.entries(item)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (keyPattern.test(normalized)) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 2048 && n <= 10000000) return Math.floor(n);
    }
    if (value && typeof value === 'object') {
      const nested = contextTokensFromNestedModelInfo(value, keyPattern, seen);
      if (nested) return nested;
    }
  }
  return undefined;
}
