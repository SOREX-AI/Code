import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

type SettingValue = string | number | boolean;
type SettingsBag = Record<string, SettingValue>;

const DEFAULTS: SettingsBag = {
  endpoint: 'http://localhost:1234/v1',
  model: '',
  maxInputTokens: 32768,
  useProviderContext: false,
  maxOutputTokens: 4096,
  temperature: 0.15,
  compactAtPercent: 90,
  autoCompactEnabled: true,
  maxUserMessageChars: 24000,
  providerMode: 'lmstudio',
  openaiEndpoint: 'https://api.openai.com/v1',
  openaiModel: '',
  anthropicEndpoint: 'https://api.anthropic.com/v1',
  anthropicModel: '',
  googleEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  googleModel: '',
  openrouterEndpoint: 'https://openrouter.ai/api/v1',
  openrouterModel: '',
  preferLocalModels: true,
  cloudApiKeyStorage: 'secretStorage',
  maxToolRounds: 8,
  nativeToolCallingEnabled: true,
  conservativeToolCalling: false,
  indexEnabled: false,
  indexAutoRefresh: false,
  indexStorageMode: 'folder-json-vectors',
  indexRankingMode: 'hybrid',
  indexEmbeddingProvider: 'active',
  indexEmbeddingAutoSelect: true,
  indexIncludeGlobs: '',
  indexExcludeGlobs: '',
  indexMaxFiles: 6000,
  indexMaxFileSizeKb: 384,
  indexChunkChars: 2200,
  indexChunkOverlap: 220,
  indexMaxResults: 16,
  indexStaleMs: 120000,
  indexEmbeddingEnabled: true,
  indexEmbeddingEndpoint: '',
  indexEmbeddingModel: '',
  indexEmbeddingBatchSize: 12,
  indexEmbeddingWeight: 32,
  includeToolSchemaInContextBudget: true,
  contextSafetyTokens: 1024,
  webSearchMaxResults: 5,
  webFetchMaxChars: 12000,
  toolListDirEnabled: true,
  toolFileSearchEnabled: true,
  toolGrepSearchEnabled: true,
  toolReadFileEnabled: true,
  toolDiagnosticsEnabled: true,
  toolWorkspaceIndexSearchEnabled: true,
  toolWorkspaceIndexRefreshEnabled: true,
  toolEditFilesEnabled: true,
  toolTerminalEnabled: true,
  toolWebSearchEnabled: true,
  toolWebFetchEnabled: true
};

const SETTING_KEYS = Object.keys(DEFAULTS);

let extensionContext: vscode.ExtensionContext | undefined;
let cachedSettings: SettingsBag | undefined;
let cachedMtimeMs = -1;
let cachedSettingsPath = '';

export interface SorexConfigLike {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: SettingValue | undefined): Thenable<void>;
  all(): SettingsBag;
  settingsPath(): string;
  settingsDir(): string;
}

export function initializeSorexConfig(context: vscode.ExtensionContext): void {
  extensionContext = context;
  cachedSettingsPath = getSorexSettingsPath(context);
  ensureSettingsFile();
  migrateLegacyVsCodeSettings(context).catch(err => {
    console.warn('SOREX legacy settings migration failed', err);
  });
}

export function getSorexConfig(context?: vscode.ExtensionContext): SorexConfigLike {
  if (context && !extensionContext) initializeSorexConfig(context);
  if (!extensionContext) throw new Error('SOREX settings store has not been initialized.');
  return sorexConfig;
}

export function getSorexSettingsDir(context = extensionContext): string {
  if (!context) return path.join(os.homedir(), 'SOREX');
  return path.join(os.homedir(), getSorexProductFolderName(context));
}

export function getSorexSettingsPath(context = extensionContext): string {
  return path.join(getSorexSettingsDir(context), 'settings.json');
}

export async function openSorexSettingsJson(context?: vscode.ExtensionContext): Promise<void> {
  const ctx = context ?? extensionContext;
  if (!ctx) throw new Error('SOREX settings store has not been initialized.');
  const filePath = getSorexSettingsPath(ctx);
  ensureSettingsFile(ctx);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

export function getSorexProductFolderName(context: vscode.ExtensionContext): string {
  const pkg = context.extension?.packageJSON ?? {};
  const displayName = String(pkg.displayName || '').trim();
  const packageName = String(pkg.name || '').trim();
  const source = displayName || packageName || 'SOREX';

  
  
  
  if (/^SOREX\b/i.test(source)) return 'SOREX';

  const clean = source
    .replace(/[^a-z0-9._ -]+/gi, '-')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return clean || 'SOREX';
}

const sorexConfig: SorexConfigLike = {
  get<T>(key: string, defaultValue?: T): T {
    const bag = readSettings();
    if (Object.prototype.hasOwnProperty.call(bag, key)) return coerceForDefault(bag[key], defaultValue) as T;
    if (typeof defaultValue !== 'undefined') return defaultValue;
    return DEFAULTS[key] as T;
  },
  async update(key: string, value: SettingValue | undefined): Promise<void> {
    const bag = readSettings();
    if (typeof value === 'undefined') delete bag[key];
    else bag[key] = sanitizeValue(value);
    writeSettings(bag);
  },
  all(): SettingsBag {
    return { ...DEFAULTS, ...readSettings() };
  },
  settingsPath(): string {
    if (!extensionContext) throw new Error('SOREX settings store has not been initialized.');
    return getSorexSettingsPath(extensionContext);
  },
  settingsDir(): string {
    if (!extensionContext) throw new Error('SOREX settings store has not been initialized.');
    return getSorexSettingsDir(extensionContext);
  }
};

function ensureSettingsFile(context = extensionContext): void {
  if (!context) return;
  const filePath = getSorexSettingsPath(context);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ ...DEFAULTS }, null, 2) + '\n', 'utf8');
  }
}

function readSettings(): SettingsBag {
  if (!extensionContext) return { ...DEFAULTS };
  const filePath = getSorexSettingsPath(extensionContext);
  ensureSettingsFile(extensionContext);
  try {
    const stat = fs.statSync(filePath);
    if (cachedSettings && cachedSettingsPath === filePath && cachedMtimeMs === stat.mtimeMs) return cachedSettings;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
    const clean: SettingsBag = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isSettingValue(value)) clean[key] = value;
    }
    if (Number(clean.compactAtPercent) === 62) {
      clean.compactAtPercent = DEFAULTS.compactAtPercent;
      fs.writeFileSync(filePath, JSON.stringify({ ...DEFAULTS, ...clean }, null, 2) + '\n', 'utf8');
    }
    cachedSettings = { ...DEFAULTS, ...clean };
    cachedMtimeMs = stat.mtimeMs;
    cachedSettingsPath = filePath;
    return cachedSettings;
  } catch (err) {
    console.warn('SOREX settings read failed; using defaults', err);
    cachedSettings = { ...DEFAULTS };
    cachedMtimeMs = -1;
    return cachedSettings;
  }
}

function writeSettings(settings: SettingsBag): void {
  if (!extensionContext) return;
  const filePath = getSorexSettingsPath(extensionContext);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const ordered: SettingsBag = {};
  for (const key of SETTING_KEYS) ordered[key] = sanitizeValue(settings[key] ?? DEFAULTS[key]);
  for (const [key, value] of Object.entries(settings)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key) && isSettingValue(value)) ordered[key] = value;
  }
  fs.writeFileSync(filePath, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
  const stat = fs.statSync(filePath);
  cachedSettings = { ...DEFAULTS, ...ordered };
  cachedMtimeMs = stat.mtimeMs;
  cachedSettingsPath = filePath;
}

async function migrateLegacyVsCodeSettings(context: vscode.ExtensionContext): Promise<void> {
  const legacy = vscode.workspace.getConfiguration('sorex');
  const current = readSettings();
  let changed = false;
  for (const key of SETTING_KEYS) {
    const inspected = legacy.inspect(key);
    if (typeof inspected?.globalValue !== 'undefined') {
      current[key] = sanitizeValue(inspected.globalValue as SettingValue);
      changed = true;
      
      
      await legacy.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
  }
  if (Number(current.compactAtPercent) === 62) {
    current.compactAtPercent = DEFAULTS.compactAtPercent;
    changed = true;
  }
  if (changed) writeSettings(current);
}

function sanitizeValue(value: unknown): SettingValue {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  return String(value ?? '');
}

function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function coerceForDefault(value: SettingValue, defaultValue: unknown): SettingValue {
  if (typeof defaultValue === 'boolean') return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
  if (typeof defaultValue === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : defaultValue;
  }
  if (typeof defaultValue === 'string') return String(value ?? '');
  return value;
}
