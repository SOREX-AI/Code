import * as vscode from 'vscode';
import { getSorexConfig } from '../config/sorexConfig';
import * as crypto from 'crypto';
import { LmStudioClient } from '../llm/lmStudioClient';

export interface SorexIndexStatus {
  state: 'disabled' | 'indexing' | 'empty' | 'ready' | 'error';
  label: string;
  detail: string;
  indexedFiles: number;
  chunks: number;
  skippedFiles: number;
  indexedAt: number;
  diskPath?: string;
  persisted?: boolean;
  repoRoot?: string;
}

export interface SorexIndexSearchResult {
  file: string;
  startLine: number;
  endLine: number;
  score: number;
  preview: string;
}

interface SerializedChunk {
  startLine: number;
  endLine: number;
  text: string;
  vector?: number[];
}

interface IndexedChunk extends SerializedChunk {
  file: string;
  lower: string;
  pathLower: string;
}

interface IndexedFileRecord {
  file: string;
  mtime: number;
  size: number;
  hash: string;
  chunks: IndexedChunk[];
}

interface IndexSettings {
  enabled: boolean;
  include: string;
  exclude: string;
  maxFiles: number;
  maxFileSizeBytes: number;
  chunkChars: number;
  overlapChars: number;
  indexType: 'hybrid' | 'lexical' | 'vector';
  storageMode: 'folder-json' | 'folder-json-vectors' | 'memory-only';
  embeddingEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingEndpoint: string;
  embeddingAutoSelect: boolean;
  embeddingBatchSize: number;
  embeddingWeight: number;
}

interface PersistedManifest {
  version: number;
  kind: 'sorex.ai-index.folder';
  repoRoot: string;
  repoId: string;
  settingsSignature: string;
  createdAt: number;
  updatedAt: number;
  indexType: string;
  storageMode: string;
  indexedFiles: number;
  skippedFiles: number;
  embeddedChunks: number;
  files: Array<{
    file: string;
    mtime: number;
    size: number;
    hash: string;
    chunkCount: number;
  }>;
}

interface PersistedChunks {
  version: number;
  kind: 'sorex.ai-index.chunks';
  files: Array<{
    file: string;
    chunks: Array<{ startLine: number; endLine: number; text: string }>;
  }>;
}

interface PersistedVectors {
  version: number;
  kind: 'sorex.ai-index.vectors';
  vectors: Array<{ file: string; startLine: number; endLine: number; vector: number[] }>;
}

interface RepoMap {
  version: number;
  kind: 'sorex.ai-index.repo-map';
  updatedAt: number;
  root: string;
  fileCount: number;
  chunkCount: number;
  topDirectories: Array<{ path: string; files: number }>;
  extensions: Array<{ ext: string; files: number }>;
}

const INDEX_VERSION = 3;
const INDEX_DIR_NAME = '.ai-index';
const MANIFEST_FILE = 'manifest.json';
const CHUNKS_FILE = 'chunks.json';
const VECTORS_FILE = 'vectors.json';
const REPO_MAP_FILE = 'repo-map.json';
const DEFAULT_INCLUDE = '**/*.{ts,tsx,js,jsx,json,md,css,scss,sass,less,html,vue,svelte,py,java,go,rs,cpp,c,cc,cxx,h,hpp,hh,cs,rb,php,yml,yaml,toml,xml,sh,ps1,bat,cmd,sql,graphql,proto}';
const DEFAULT_EXCLUDE = '**/{node_modules,.git,.ai-index,dist,out,build,.next,.nuxt,coverage,vendor,target,.turbo,.cache,.venv,venv,__pycache__}/**';

export class SorexWorkspaceIndex {
  private files = new Map<string, IndexedFileRecord>();
  private chunks: IndexedChunk[] = [];
  private indexedAt = 0;
  private indexedFiles = 0;
  private skippedFiles = 0;
  private lastSignature = '';
  private lastError = '';
  private lastEmbeddingError = '';
  private lastIndexBlockedReason = '';
  private embeddedChunks = 0;
  private building?: Promise<void>;
  private loadPromise?: Promise<void>;
  private diskIndexPresent = false;
  private diskPath = '';
  private repoRoot = '';
  private repoMap?: RepoMap;
  private readonly client: LmStudioClient;
  private readonly statusEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus = this.statusEmitter.event;
  private watcher?: vscode.FileSystemWatcher;
  private pendingChangedPaths = new Set<string>();
  private pendingDeletedPaths = new Set<string>();
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly context?: vscode.ExtensionContext) {
    this.client = new LmStudioClient(context);
    this.registerWatcher();
    context?.subscriptions.push(this.statusEmitter);
  }

  async search(query: string, maxResults?: number): Promise<SorexIndexSearchResult[]> {
    const q = String(query || '').trim();
    if (!q) throw new Error('workspace_index_search requires a query.');
    await this.ensureFresh();
    const settings = this.settings();
    if (!settings.enabled) throw new Error('Workspace indexing is disabled in SOREX Settings > Indexing.');
    if (this.lastIndexBlockedReason && !this.chunks.length) throw new Error(this.lastIndexBlockedReason);

    const terms = this.terms(q);
    const phrase = q.toLowerCase();
    const useVector = settings.indexType !== 'lexical' && settings.embeddingEnabled && this.embeddedChunks > 0;
    const queryVector = useVector ? await this.tryEmbedQuery(q, settings) : undefined;
    const vectorOnly = settings.indexType === 'vector' && !!queryVector?.length;
    const scored: SorexIndexSearchResult[] = [];

    for (const chunk of this.chunks) {
      let lexical = 0;
      if (!vectorOnly) {
        if (chunk.pathLower.includes(phrase)) lexical += 18;
        if (chunk.lower.includes(phrase)) lexical += 12;
        for (const term of terms) {
          if (term.length < 2) continue;
          if (chunk.pathLower.includes(term)) lexical += 8;
          const hits = countOccurrences(chunk.lower, term);
          if (hits) lexical += Math.min(14, hits * 2.2);
        }
      }

      let semantic = 0;
      if (queryVector?.length && chunk.vector?.length) {
        const sim = cosine(queryVector, chunk.vector);
        if (Number.isFinite(sim)) semantic = Math.max(0, sim) * settings.embeddingWeight;
      }

      const score = vectorOnly ? semantic : lexical + semantic;
      if (score <= 0.01) continue;
      scored.push({
        file: chunk.file,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: Math.round(score * 10) / 10,
        preview: this.preview(chunk.text, terms)
      });
    }

    return scored
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.startLine - b.startLine)
      .slice(0, Math.max(1, Math.min(Number(maxResults || this.config().get('indexMaxResults', 16)), 100)));
  }

  async refresh(): Promise<void> {
    if (this.building) return this.building;
    this.building = this.rebuild().catch(err => {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.fireStatus();
      throw err;
    }).finally(() => {
      this.building = undefined;
      this.fireStatus();
    });
    this.fireStatus();
    return this.building;
  }

  status(): string {
    return this.snapshot().detail;
  }

  promptContext(): string {
    const snap = this.snapshot();
    if (snap.state === 'disabled') {
      return 'SOREX repository index: disabled. Use normal workspace search/read tools.';
    }
    if (snap.state === 'ready') {
      const map = this.repoMap;
      const mapLine = map ? `Repo map: ${map.fileCount} files, ${map.chunkCount} chunks, top folders: ${map.topDirectories.slice(0, 5).map(d => `${d.path}(${d.files})`).join(', ') || 'none'}.` : 'Repo map: available through the persisted index.';
      return [
        'SOREX repository index: ready.',
        `On-disk index folder: ${INDEX_DIR_NAME}${snap.persisted ? ' exists' : ' is not saved yet'}.`,
        `Indexed ${snap.indexedFiles} files into ${snap.chunks} chunks.`,
        mapLine,
        'Use workspace_index_search for repo-wide recall before broad grep, but still read exact files before editing.',
        `Never edit ${INDEX_DIR_NAME} unless the user explicitly asks to change SOREX index behavior.`
      ].join('\n');
    }
    if (snap.state === 'indexing') return `SOREX repository index: building ${INDEX_DIR_NAME}. Wait for tool results/status before trusting indexed recall.`;
    return `SOREX repository index: ${snap.label}. If the task requires repo-wide recall, call workspace_index_refresh or workspace_index_search.`;
  }

  snapshot(): SorexIndexStatus {
    const settings = this.settings();
    const base = {
      indexedFiles: this.indexedFiles,
      chunks: this.chunks.length,
      skippedFiles: this.skippedFiles,
      indexedAt: this.indexedAt,
      diskPath: this.diskPath || this.indexDirUri()?.fsPath,
      persisted: this.diskIndexPresent,
      repoRoot: this.repoRoot || this.primaryRoot()?.fsPath
    };
    if (!settings.enabled) {
      return { state: 'disabled', label: 'Indexing off', detail: 'Indexing off', ...base };
    }
    if (this.building) {
      return { state: 'indexing', label: 'Indexing...', detail: 'Indexing...', ...base };
    }
    if (this.lastError) {
      return { state: 'error', label: 'Index error', detail: `Index error: ${this.lastError}`, ...base };
    }
    if (this.lastIndexBlockedReason) {
      return { state: 'empty', label: 'Index waiting', detail: this.lastIndexBlockedReason, indexedFiles: 0, chunks: 0, skippedFiles: 0, indexedAt: 0, diskPath: base.diskPath, persisted: this.diskIndexPresent, repoRoot: base.repoRoot };
    }
    if (!this.indexedAt) {
      return { state: 'empty', label: 'Index not built', detail: 'Index not built', indexedFiles: 0, chunks: 0, skippedFiles: 0, indexedAt: 0, diskPath: base.diskPath, persisted: this.diskIndexPresent, repoRoot: base.repoRoot };
    }
    return {
      state: 'ready',
      label: 'Index is up to date',
      detail: 'Index is up to date',
      ...base,
      persisted: settings.storageMode !== 'memory-only' && this.diskIndexPresent
    };
  }

  async ensureFresh(autoOnly = false): Promise<void> {
    const settings = this.settings();
    if (!settings.enabled) return;
    await this.loadFromDisk();
    const signature = this.settingsSignature(settings);
    const staleMs = Math.max(15_000, Number(this.config().get('indexStaleMs', 120000)) || 120000);
    const autoRefresh = Boolean(this.config().get('indexAutoRefresh', false));
    if (autoOnly && !autoRefresh) return;
    const neverBuilt = !this.indexedAt || !this.chunks.length;
    const settingsChanged = signature !== this.lastSignature;
    const hasFileChanges = this.pendingChangedPaths.size > 0 || this.pendingDeletedPaths.size > 0;
    const timedOut = autoRefresh && this.indexedAt > 0 && Date.now() - this.indexedAt > staleMs;
    if (neverBuilt || settingsChanged || hasFileChanges || timedOut) await this.refresh();
  }

  private async rebuild(): Promise<void> {
    const settings = this.settings();
    if (!settings.enabled) {
      this.files.clear();
      this.chunks = [];
      this.indexedFiles = 0;
      this.skippedFiles = 0;
      this.embeddedChunks = 0;
      this.indexedAt = Date.now();
      this.lastSignature = this.settingsSignature(settings);
      return;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('No workspace folder is open. Open the repo folder before indexing.');

    await this.loadFromDisk();
    this.lastError = '';
    this.lastEmbeddingError = '';
    this.lastIndexBlockedReason = '';

    if (settings.embeddingEnabled && settings.indexType !== 'lexical') {
      const resolvedModel = await this.client.resolveEmbeddingModel({
        provider: settings.embeddingProvider,
        endpoint: settings.embeddingEndpoint,
        model: settings.embeddingModel
      });
      if (!resolvedModel) {
        this.files.clear();
        this.chunks = [];
        this.indexedFiles = 0;
        this.skippedFiles = 0;
        this.embeddedChunks = 0;
        this.indexedAt = 0;
        this.lastIndexBlockedReason = 'Auto-index is waiting for an embedding model. Select or auto-detect one in SOREX Settings > Indexing, or switch ranking mode to Lexical only.';
        this.fireStatus();
        return;
      }
      settings.embeddingModel = resolvedModel;
    }

    const signature = this.settingsSignature(settings);
    const canReuse = this.lastSignature === signature;
    const files = await this.findCandidateFiles(settings);
    if (!files.length) {
      this.files.clear();
      this.chunks = [];
      this.indexedFiles = 0;
      this.skippedFiles = 0;
      this.embeddedChunks = 0;
      this.indexedAt = 0;
      this.lastSignature = signature;
      this.lastIndexBlockedReason = 'No indexable source files were found in this workspace. Open a repo folder or adjust Include glob.';
      this.fireStatus();
      return;
    }
    const nextFiles = new Map<string, IndexedFileRecord>();
    let indexedFiles = 0;
    let skippedFiles = 0;

    if (files.length > settings.maxFiles) skippedFiles += files.length - settings.maxFiles;

    for (const uri of files.slice(0, settings.maxFiles)) {
      const file = toWorkspacePath(uri);
      try {
        if (isIndexPath(file)) continue;
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > settings.maxFileSizeBytes) { skippedFiles++; continue; }

        const previous = this.files.get(file);
        const dirty = this.pendingChangedPaths.has(file);
        const deleted = this.pendingDeletedPaths.has(file);
        if (canReuse && previous && !dirty && !deleted && previous.size === stat.size && Math.round(previous.mtime) === Math.round(stat.mtime)) {
          nextFiles.set(file, previous);
          indexedFiles++;
          continue;
        }

        const record = await this.indexOneFile(uri, file, stat, settings);
        if (!record) { skippedFiles++; continue; }
        nextFiles.set(file, record);
        indexedFiles++;
      } catch {
        skippedFiles++;
      }
    }

    this.pendingChangedPaths.clear();
    this.pendingDeletedPaths.clear();
    this.files = nextFiles;
    this.chunks = Array.from(nextFiles.values()).flatMap(file => file.chunks);
    this.indexedFiles = indexedFiles;
    this.skippedFiles = skippedFiles;
    this.embeddedChunks = this.chunks.filter(chunk => Array.isArray(chunk.vector) && chunk.vector.length).length;
    this.indexedAt = Date.now();
    this.lastSignature = signature;
    this.repoMap = makeRepoMap(this.primaryRoot()?.fsPath || '', this.files, this.chunks.length);
    if (settings.storageMode !== 'memory-only') await this.saveToDisk(signature, settings);
  }

  private async indexOneFile(uri: vscode.Uri, file: string, stat: vscode.FileStat, settings: IndexSettings): Promise<IndexedFileRecord | undefined> {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    if (!raw.trim() || looksBinary(raw)) return undefined;
    const hash = hashText(raw);
    const chunks = chunkFile(file, raw, settings.chunkChars, settings.overlapChars);
    if (settings.embeddingEnabled && settings.indexType !== 'lexical' && chunks.length) await this.embedChunks(chunks, settings);
    return { file, mtime: stat.mtime, size: stat.size, hash, chunks };
  }

  private async findCandidateFiles(settings: IndexSettings): Promise<vscode.Uri[]> {
    const files = await vscode.workspace.findFiles(settings.include, settings.exclude, settings.maxFiles + 500);
    return files.filter(uri => !isIndexPath(toWorkspacePath(uri)));
  }

  private async embedChunks(chunks: IndexedChunk[], settings: IndexSettings): Promise<void> {
    const batchSize = Math.max(1, Math.min(settings.embeddingBatchSize, 64));
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const inputs = batch.map(chunk => `${chunk.file}:${chunk.startLine}-${chunk.endLine}\n${chunk.text}`.slice(0, Math.max(500, settings.chunkChars + 600)));
      try {
        const vectors = await this.client.embedTexts(inputs, {
          provider: settings.embeddingProvider,
          endpoint: settings.embeddingEndpoint,
          model: settings.embeddingModel
        });
        for (let j = 0; j < batch.length; j++) {
          const vector = vectors[j];
          if (Array.isArray(vector) && vector.length) batch[j].vector = normalizeVector(vector);
        }
      } catch (err) {
        this.lastEmbeddingError = err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220);
        return;
      }
    }
  }

  private async tryEmbedQuery(query: string, settings: IndexSettings): Promise<number[] | undefined> {
    if (!settings.embeddingEnabled || settings.indexType === 'lexical' || !this.embeddedChunks) return undefined;
    try {
      const vectors = await this.client.embedTexts([query], {
        provider: settings.embeddingProvider,
        endpoint: settings.embeddingEndpoint,
        model: settings.embeddingModel
      });
      const vector = vectors[0];
      return Array.isArray(vector) && vector.length ? normalizeVector(vector) : undefined;
    } catch (err) {
      this.lastEmbeddingError = err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220);
      return undefined;
    }
  }

  private async loadFromDisk(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoadFromDisk().finally(() => { this.loadPromise = undefined; });
    return this.loadPromise;
  }

  private async doLoadFromDisk(): Promise<void> {
    const settings = this.settings();
    if (settings.storageMode === 'memory-only') return;
    const dir = this.indexDirUri();
    if (!dir) return;
    this.repoRoot = this.primaryRoot()?.fsPath || '';
    this.diskPath = dir.fsPath;
    try {
      const stat = await vscode.workspace.fs.stat(dir);
      if (stat.type !== vscode.FileType.Directory) {
        this.lastError = `${INDEX_DIR_NAME} exists but is not a folder. Delete the old file or rebuild the index.`;
        this.fireStatus();
        return;
      }
    } catch (err) {
      if (err instanceof vscode.FileSystemError && /FileNotFound/i.test(String(err.message))) return;
      return;
    }

    try {
      const manifest = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, MANIFEST_FILE))).toString('utf8')) as PersistedManifest;
      const chunksFile = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, CHUNKS_FILE))).toString('utf8')) as PersistedChunks;
      let vectorsFile: PersistedVectors | undefined;
      try {
        vectorsFile = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, VECTORS_FILE))).toString('utf8')) as PersistedVectors;
      } catch {}
      try {
        this.repoMap = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, REPO_MAP_FILE))).toString('utf8')) as RepoMap;
      } catch { this.repoMap = undefined; }

      if (manifest?.kind !== 'sorex.ai-index.folder' || manifest.version !== INDEX_VERSION || !Array.isArray(manifest.files)) return;
      if (chunksFile?.kind !== 'sorex.ai-index.chunks' || chunksFile.version !== INDEX_VERSION || !Array.isArray(chunksFile.files)) return;
      const repoId = this.repoId();
      if (manifest.repoId && manifest.repoId !== repoId) return;

      const vectors = new Map<string, number[]>();
      for (const item of vectorsFile?.vectors || []) {
        if (!item?.file || !Array.isArray(item.vector)) continue;
        vectors.set(vectorKey(item.file, item.startLine, item.endLine), item.vector.map(Number).filter(Number.isFinite));
      }

      const meta = new Map(manifest.files.map(file => [file.file, file]));
      const loaded = new Map<string, IndexedFileRecord>();
      for (const item of chunksFile.files) {
        if (!item?.file || isIndexPath(item.file) || !Array.isArray(item.chunks)) continue;
        const fileMeta = meta.get(item.file);
        if (!fileMeta) continue;
        const chunks = item.chunks.map(chunk => {
          const hydrated = hydrateChunk(item.file, chunk);
          if (!hydrated) return undefined;
          const vector = vectors.get(vectorKey(item.file, hydrated.startLine, hydrated.endLine));
          if (vector?.length) hydrated.vector = normalizeVector(vector);
          return hydrated;
        }).filter(Boolean) as IndexedChunk[];
        if (!chunks.length) continue;
        loaded.set(item.file, {
          file: item.file,
          mtime: Number(fileMeta.mtime) || 0,
          size: Number(fileMeta.size) || 0,
          hash: String(fileMeta.hash || ''),
          chunks
        });
      }
      this.files = loaded;
      this.chunks = Array.from(loaded.values()).flatMap(file => file.chunks);
      this.indexedFiles = Number(manifest.indexedFiles) || loaded.size;
      this.skippedFiles = Number(manifest.skippedFiles) || 0;
      this.embeddedChunks = Number(manifest.embeddedChunks) || this.chunks.filter(chunk => Array.isArray(chunk.vector) && chunk.vector.length).length;
      this.indexedAt = Number(manifest.updatedAt) || 0;
      this.lastSignature = String(manifest.settingsSignature || '');
      this.diskIndexPresent = true;
      this.lastError = '';
      this.fireStatus();
    } catch (err) {
      this.lastError = `Could not read ${INDEX_DIR_NAME}/: ${err instanceof Error ? err.message : String(err)}`;
      this.fireStatus();
    }
  }

  private async saveToDisk(signature: string, settings: IndexSettings): Promise<void> {
    const dir = this.indexDirUri();
    if (!dir) return;
    await this.ensureIndexDirectory(dir);
    const now = Date.now();
    const records = Array.from(this.files.values());
    const manifest: PersistedManifest = {
      version: INDEX_VERSION,
      kind: 'sorex.ai-index.folder',
      repoRoot: this.primaryRoot()?.fsPath || '',
      repoId: this.repoId(),
      settingsSignature: signature,
      createdAt: this.diskIndexPresent ? Math.min(this.indexedAt || now, now) : now,
      updatedAt: now,
      indexType: settings.indexType,
      storageMode: settings.storageMode,
      indexedFiles: this.indexedFiles,
      skippedFiles: this.skippedFiles,
      embeddedChunks: this.embeddedChunks,
      files: records.map(record => ({
        file: record.file,
        mtime: record.mtime,
        size: record.size,
        hash: record.hash,
        chunkCount: record.chunks.length
      }))
    };
    const chunkPayload: PersistedChunks = {
      version: INDEX_VERSION,
      kind: 'sorex.ai-index.chunks',
      files: records.map(record => ({
        file: record.file,
        chunks: record.chunks.map(chunk => ({ startLine: chunk.startLine, endLine: chunk.endLine, text: chunk.text }))
      }))
    };
    const vectorPayload: PersistedVectors = {
      version: INDEX_VERSION,
      kind: 'sorex.ai-index.vectors',
      vectors: this.chunks
        .filter(chunk => Array.isArray(chunk.vector) && chunk.vector.length)
        .map(chunk => ({ file: chunk.file, startLine: chunk.startLine, endLine: chunk.endLine, vector: chunk.vector || [] }))
    };
    this.repoMap = makeRepoMap(this.primaryRoot()?.fsPath || '', this.files, this.chunks.length);

    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, MANIFEST_FILE), Buffer.from(JSON.stringify(manifest, null, 2)));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, CHUNKS_FILE), Buffer.from(JSON.stringify(chunkPayload)));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, REPO_MAP_FILE), Buffer.from(JSON.stringify(this.repoMap, null, 2)));
    if (settings.storageMode === 'folder-json-vectors' || vectorPayload.vectors.length) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, VECTORS_FILE), Buffer.from(JSON.stringify(vectorPayload)));
    }
    this.diskPath = dir.fsPath;
    this.repoRoot = this.primaryRoot()?.fsPath || '';
    this.diskIndexPresent = true;
    this.fireStatus();
  }

  private async ensureIndexDirectory(dir: vscode.Uri): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(dir);
      if (stat.type === vscode.FileType.Directory) return;
      await vscode.workspace.fs.delete(dir, { recursive: false, useTrash: false });
    } catch {}
    await vscode.workspace.fs.createDirectory(dir);
  }

  private registerWatcher(): void {
    if (this.watcher) return;
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    const changed = (uri: vscode.Uri) => this.queueFileChange(uri, false);
    const deleted = (uri: vscode.Uri) => this.queueFileChange(uri, true);
    this.watcher.onDidCreate(changed, undefined, this.context?.subscriptions);
    this.watcher.onDidChange(changed, undefined, this.context?.subscriptions);
    this.watcher.onDidDelete(deleted, undefined, this.context?.subscriptions);
    this.context?.subscriptions.push(this.watcher);
  }

  private queueFileChange(uri: vscode.Uri, deleted: boolean): void {
    const settings = this.settings();
    if (!settings.enabled || !Boolean(this.config().get('indexAutoRefresh', false))) return;
    const file = toWorkspacePath(uri);
    if (!file || isIndexPath(file) || probablyGeneratedPath(file)) return;
    if (deleted) this.pendingDeletedPaths.add(file);
    else this.pendingChangedPaths.add(file);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh().catch(() => undefined);
    }, 1500);
  }

  private settings(): IndexSettings {
    const c = this.config();
    const includeRaw = String(c.get('indexIncludeGlobs', '') || '').trim();
    const excludeRaw = String(c.get('indexExcludeGlobs', '') || '').trim();
    const indexType = normalizeChoice(String(c.get('indexRankingMode', 'hybrid')), ['hybrid', 'lexical', 'vector'], 'hybrid') as IndexSettings['indexType'];
    const storageMode = normalizeChoice(String(c.get('indexStorageMode', 'folder-json-vectors')), ['folder-json', 'folder-json-vectors', 'memory-only'], 'folder-json') as IndexSettings['storageMode'];
    return {
      enabled: Boolean(c.get('indexEnabled', false)),
      include: includeRaw || DEFAULT_INCLUDE,
      exclude: mergeExcludeGlobs(excludeRaw || DEFAULT_EXCLUDE, `**/${INDEX_DIR_NAME}/**`),
      maxFiles: Math.max(50, Math.min(Number(c.get('indexMaxFiles', 6000)) || 6000, 100000)),
      maxFileSizeBytes: Math.max(8, Math.min(Number(c.get('indexMaxFileSizeKb', 384)) || 384, 8192)) * 1024,
      chunkChars: Math.max(500, Math.min(Number(c.get('indexChunkChars', 2200)) || 2200, 16000)),
      overlapChars: Math.max(0, Math.min(Number(c.get('indexChunkOverlap', 220)) || 220, 4000)),
      indexType,
      storageMode,
      embeddingEnabled: Boolean(c.get('indexEmbeddingEnabled', true)),
      embeddingProvider: String(c.get('indexEmbeddingProvider', 'active') || 'active').trim(),
      embeddingModel: String(c.get('indexEmbeddingModel', '') || '').trim(),
      embeddingEndpoint: String(c.get('indexEmbeddingEndpoint', '') || '').trim(),
      embeddingAutoSelect: Boolean(c.get('indexEmbeddingAutoSelect', true)),
      embeddingBatchSize: Math.max(1, Math.min(Number(c.get('indexEmbeddingBatchSize', 12)) || 12, 64)),
      embeddingWeight: Math.max(5, Math.min(Number(c.get('indexEmbeddingWeight', 32)) || 32, 100))
    };
  }

  private settingsSignature(settings: IndexSettings): string {
    return hashText(JSON.stringify({
      version: INDEX_VERSION,
      include: settings.include,
      exclude: settings.exclude,
      maxFiles: settings.maxFiles,
      maxFileSizeBytes: settings.maxFileSizeBytes,
      chunkChars: settings.chunkChars,
      overlapChars: settings.overlapChars,
      indexType: settings.indexType,
      storageMode: settings.storageMode,
      embeddingEnabled: settings.embeddingEnabled,
      embeddingProvider: settings.embeddingProvider,
      embeddingModel: settings.embeddingModel,
      embeddingEndpoint: settings.embeddingEndpoint || this.client.embeddingEndpointFor(settings.embeddingProvider)
    }));
  }

  private indexDirUri(): vscode.Uri | undefined {
    const root = this.primaryRoot();
    return root ? vscode.Uri.joinPath(root, INDEX_DIR_NAME) : undefined;
  }

  private primaryRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private repoId(): string {
    const root = this.primaryRoot()?.toString() || 'no-workspace';
    return hashText(root);
  }

  private config(): { get<T>(key: string, defaultValue?: T): T } {
    return getSorexConfig();
  }

  private terms(query: string): string[] {
    return Array.from(new Set(String(query || '').toLowerCase().match(/[a-z0-9_.$/-]{2,}/g) || []));
  }

  private preview(text: string, terms: string[]): string {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    let index = -1;
    for (const term of terms) {
      index = lower.indexOf(term.toLowerCase());
      if (index >= 0) break;
    }
    if (index < 0) index = 0;
    const start = Math.max(0, index - 120);
    const end = Math.min(raw.length, index + 360);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < raw.length ? '...' : '';
    return `${prefix}${raw.slice(start, end)}${suffix}`;
  }

  private fireStatus(): void {
    this.statusEmitter.fire();
  }
}

function chunkFile(file: string, raw: string, chunkChars: number, overlapChars: number): IndexedChunk[] {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const chunks: IndexedChunk[] = [];
  const size = Math.max(500, chunkChars);
  const overlap = Math.max(0, Math.min(overlapChars, Math.floor(size / 2)));
  let start = 0;
  let startLine = 1;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > start + Math.floor(size * 0.55)) end = newline + 1;
    }
    const part = text.slice(start, end);
    const endLine = startLine + countNewlines(part);
    const chunk = makeChunk(file, startLine, Math.max(startLine, endLine), part.trim());
    if (chunk.text) chunks.push(chunk);
    if (end >= text.length) break;
    const nextStart = Math.max(end - overlap, start + 1);
    startLine += countNewlines(text.slice(start, nextStart));
    start = nextStart;
  }
  return chunks;
}

function makeChunk(file: string, startLine: number, endLine: number, text: string): IndexedChunk {
  const clean = String(text || '');
  return {
    file,
    startLine,
    endLine,
    text: clean,
    lower: clean.toLowerCase(),
    pathLower: file.toLowerCase()
  };
}

function hydrateChunk(file: string, chunk: { startLine: number; endLine: number; text: string }): IndexedChunk | undefined {
  if (!chunk || typeof chunk.text !== 'string') return undefined;
  return makeChunk(file, Number(chunk.startLine) || 1, Number(chunk.endLine) || Number(chunk.startLine) || 1, chunk.text);
}

function countNewlines(text: string): number {
  return (String(text || '').match(/\n/g) || []).length;
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(term, index)) >= 0) {
    count += 1;
    index += Math.max(1, term.length);
  }
  return count;
}

function normalizeVector(vector: number[]): number[] {
  const values = vector.map(Number).filter(Number.isFinite);
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return length > 0 ? values.map(value => value / length) : values;
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

function vectorKey(file: string, startLine: number, endLine: number): string {
  return `${file}:${startLine}-${endLine}`;
}

function toWorkspacePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

function isIndexPath(file: string): boolean {
  const clean = String(file || '').replace(/\\/g, '/');
  return clean === INDEX_DIR_NAME || clean.startsWith(`${INDEX_DIR_NAME}/`) || clean.includes(`/${INDEX_DIR_NAME}/`);
}

function probablyGeneratedPath(file: string): boolean {
  const clean = String(file || '').replace(/\\/g, '/').toLowerCase();
  return /(^|\/)(node_modules|\.git|dist|out|build|coverage|vendor|target|\.next|\.nuxt|\.turbo|\.cache|\.venv|venv|__pycache__)(\/|$)/.test(clean);
}

function looksBinary(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 4096);
  if (sample.includes('\u0000')) return true;
  const odd = sample.match(/[\x00-\x08\x0E-\x1F]/g) || [];
  return odd.length > sample.length * 0.08;
}

function normalizeChoice(value: string, choices: string[], fallback: string): string {
  return choices.includes(value) ? value : fallback;
}

function mergeExcludeGlobs(base: string, extra: string): string {
  const clean = String(base || '').trim();
  if (!clean) return extra;
  if (clean.includes(extra)) return clean;
  return `{${clean},${extra}}`;
}

function makeRepoMap(root: string, files: Map<string, IndexedFileRecord>, chunkCount: number): RepoMap {
  const directories = new Map<string, number>();
  const extensions = new Map<string, number>();
  for (const file of files.keys()) {
    const parts = file.split('/');
    const dir = parts.length > 1 ? parts[0] : '.';
    directories.set(dir, (directories.get(dir) || 0) + 1);
    const name = parts[parts.length - 1] || file;
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '(none)';
    extensions.set(ext, (extensions.get(ext) || 0) + 1);
  }
  return {
    version: INDEX_VERSION,
    kind: 'sorex.ai-index.repo-map',
    updatedAt: Date.now(),
    root,
    fileCount: files.size,
    chunkCount,
    topDirectories: Array.from(directories.entries()).map(([path, count]) => ({ path, files: count })).sort((a, b) => b.files - a.files || a.path.localeCompare(b.path)).slice(0, 12),
    extensions: Array.from(extensions.entries()).map(([ext, count]) => ({ ext, files: count })).sort((a, b) => b.files - a.files || a.ext.localeCompare(b.ext)).slice(0, 16)
  };
}
