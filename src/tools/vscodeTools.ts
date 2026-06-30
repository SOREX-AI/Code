import * as vscode from 'vscode';
import { getSorexConfig } from '../config/sorexConfig';
import { execFile } from 'child_process';
import { SorexToolSchema } from '../llm/lmStudioClient';
import { SorexWorkspaceIndex } from '../indexing/workspaceIndex';

export interface SorexToolResult {
  display: string;
  model: string;
}

export class SorexWorkspaceTools {
  private readonly workspaceIndex: SorexWorkspaceIndex;
  private userTerminal?: vscode.Terminal;

  constructor(context?: vscode.ExtensionContext) {
    this.workspaceIndex = new SorexWorkspaceIndex(context);
  }

  onDidChangeIndexStatus(listener: () => void): vscode.Disposable {
    return this.workspaceIndex.onDidChangeStatus(listener);
  }

  indexPromptContext(): string {
    return this.workspaceIndex.promptContext();
  }

  readonly schemas: SorexToolSchema[] = [
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List files and folders inside a workspace directory. Use this before guessing project structure.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Workspace-relative or absolute directory path. Use . for workspace root.' } },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'file_search',
        description: 'Search for files by glob pattern in the workspace. Use this to locate package.json, source files, configs, and relevant files.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Glob pattern, e.g. **/package.json or **/*.{ts,tsx,js,jsx,json}' },
            maxResults: { type: 'number', description: 'Maximum result count. Default 100.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'grep_search',
        description: 'Search text in workspace files. Use this to find symbols, package names, settings, imports, or code paths.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Plain text or regex pattern to search for.' },
            isRegexp: { type: 'boolean', description: 'Whether query is a regular expression.' },
            includePattern: { type: 'string', description: 'Optional glob include pattern, e.g. **/*.{ts,tsx,js,json}' },
            maxResults: { type: 'number', description: 'Maximum results. Default 50.' }
          },
          required: ['query', 'isRegexp']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a workspace file. Always read relevant files before answering detailed code questions or editing.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Workspace-relative or absolute file path.' },
            startLine: { type: 'number', description: '1-based start line. Optional.' },
            endLine: { type: 'number', description: '1-based inclusive end line. Optional.' }
          },
          required: ['filePath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_string_in_file',
        description: 'Edit a file by replacing exact existing text. Use after read_file. This actually modifies the workspace file.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Workspace-relative or absolute file path.' },
            oldString: { type: 'string', description: 'Exact existing text to replace. Must match exactly once.' },
            newString: { type: 'string', description: 'Replacement text.' }
          },
          required: ['filePath', 'oldString', 'newString']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_range_in_file',
        description: 'Edit a file by replacing an inclusive 1-based line range. Use when exact-string replacement is awkward. This actually modifies the workspace file.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Workspace-relative or absolute file path.' },
            startLine: { type: 'number', description: '1-based start line to replace.' },
            endLine: { type: 'number', description: '1-based inclusive end line to replace.' },
            newText: { type: 'string', description: 'Replacement text for the line range.' }
          },
          required: ['filePath', 'startLine', 'endLine', 'newText']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insert_text_in_file',
        description: 'Insert text before a 1-based line number in an existing file. Use this for small additions/imports/options. This actually modifies the workspace file.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Workspace-relative or absolute file path.' },
            line: { type: 'number', description: '1-based line number to insert before. Use lineCount + 1 to append.' },
            text: { type: 'string', description: 'Text to insert.' }
          },
          required: ['filePath', 'line', 'text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a workspace file with full content. Use for new files or deliberate full-file rewrites. This actually modifies the workspace.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Workspace-relative or absolute file path.' },
            content: { type: 'string', description: 'Complete file content to write.' }
          },
          required: ['filePath', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a workspace file. Use only when the user explicitly asks to remove a file or cleanup generated files.',
        parameters: {
          type: 'object',
          properties: { filePath: { type: 'string', description: 'Workspace-relative or absolute file path.' } },
          required: ['filePath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_directory',
        description: 'Create a workspace directory, including parent directories when needed.',
        parameters: {
          type: 'object',
          properties: { dirPath: { type: 'string', description: 'Workspace-relative or absolute directory path.' } },
          required: ['dirPath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'git_diff',
        description: 'Read current git changes without using the user terminal. Use this for diff inspection, reviewing edits, and understanding changed files. Do not use run_in_terminal for git diff.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Optional workspace-relative file path to diff.' },
            staged: { type: 'boolean', description: 'Whether to show staged changes instead of unstaged changes.' },
            maxChars: { type: 'number', description: 'Maximum characters to return. Default 20000.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_errors',
        description: 'Read VS Code diagnostics/errors. Use after edits or when user asks about errors.',
        parameters: {
          type: 'object',
          properties: { filePaths: { type: 'array', items: { type: 'string' }, description: 'Optional file paths to filter diagnostics.' } }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_index_search',
        description: "Search SOREX's workspace index for semantic/code-relevant chunks before broad manual grep. Best for fast repo recall, symbols, concepts, components, routes, and files related to a task.",
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural-language or symbol query to search the workspace index.' },
            maxResults: { type: 'number', description: 'Maximum indexed chunks to return. Default comes from SOREX Indexing settings.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_index_refresh',
        description: "Refresh/rebuild SOREX's workspace index after major file changes or when search results look stale.",
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Free web search for current public coding documentation or errors. Uses a no-key DuckDuckGo HTML search when enabled in SOREX settings. Use only when current external information is needed.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query.' },
            maxResults: { type: 'number', description: 'Maximum search results. Default 5.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch a public web page by URL and return readable text. Use after web_search when exact public docs are needed. No paid API required.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Public http/https URL to fetch.' },
            maxChars: { type: 'number', description: 'Maximum characters to return. Default from settings.' }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_in_terminal',
        description: 'Run a command in the user-visible SOREX VS Code terminal from the workspace root after approval, monitor its output when VS Code shell integration is available, and return the transcript. Before calling this for project commands, inspect package.json/task/config/README files and use an actually discovered script. Use for builds, tests, git/package commands, dev servers, and focused verification. Do not use for file/source discovery.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to run.' },
            explanation: { type: 'string', description: 'One sentence explaining why this command is needed.' },
            goal: { type: 'string', description: 'Short goal label.' }
          },
          required: ['command', 'explanation', 'goal']
        }
      }
    }
  ];

  indexStatus(): { state: string; label: string; detail: string; indexedFiles: number; chunks: number; skippedFiles: number; indexedAt: number; diskPath?: string; persisted?: boolean; repoRoot?: string } {
    return this.workspaceIndex.snapshot();
  }

  async refreshIndex(): Promise<void> {
    await this.workspaceIndex.refresh();
  }

  async ensureIndexFresh(autoOnly = false): Promise<void> {
    await this.workspaceIndex.ensureFresh(autoOnly);
  }

  enabledSchemas(): SorexToolSchema[] {
    return this.schemas.filter(tool => this.isToolEnabled(tool.function.name));
  }

  isToolEnabled(name: string): boolean {
    const c = getSorexConfig();
    switch (name) {
      case 'list_dir': return Boolean(c.get('toolListDirEnabled', true));
      case 'file_search': return Boolean(c.get('toolFileSearchEnabled', true));
      case 'grep_search': return Boolean(c.get('toolGrepSearchEnabled', true));
      case 'read_file': return Boolean(c.get('toolReadFileEnabled', true));
      case 'git_diff': return true;
      case 'get_errors': return Boolean(c.get('toolDiagnosticsEnabled', true));
      case 'workspace_index_search': return Boolean(c.get('indexEnabled', false)) && Boolean(c.get('toolWorkspaceIndexSearchEnabled', true));
      case 'workspace_index_refresh': return Boolean(c.get('indexEnabled', false)) && Boolean(c.get('toolWorkspaceIndexRefreshEnabled', true));
      case 'web_search': return Boolean(c.get('toolWebSearchEnabled', true));
      case 'web_fetch': return Boolean(c.get('toolWebFetchEnabled', true));
      case 'replace_string_in_file':
      case 'replace_range_in_file':
      case 'insert_text_in_file':
      case 'write_file':
      case 'delete_file':
      case 'create_directory':
        return Boolean(c.get('toolEditFilesEnabled', true));
      case 'run_in_terminal': return Boolean(c.get('toolTerminalEnabled', true));
      default: return true;
    }
  }

  readonly readOnlyToolNames = new Set(['list_dir', 'file_search', 'grep_search', 'read_file', 'git_diff', 'get_errors', 'workspace_index_search', 'workspace_index_refresh', 'web_search', 'web_fetch']);
  readonly mutatingToolNames = new Set(['replace_string_in_file', 'replace_range_in_file', 'insert_text_in_file', 'write_file', 'delete_file', 'create_directory']);
  readonly approvalToolNames = new Set([...this.mutatingToolNames, 'run_in_terminal']);

  async execute(name: string, args: any): Promise<SorexToolResult> {
    if (!this.isToolEnabled(name)) throw new Error(`SOREX tool disabled in Settings > Tooling: ${name}`);
    switch (name) {
      case 'list_dir': return this.listDir(String(args.path ?? '.'));
      case 'file_search': return this.fileSearch(String(args.query ?? '**/*'), Number(args.maxResults ?? 100));
      case 'grep_search': return this.grepSearch(String(args.query ?? ''), Boolean(args.isRegexp), args.includePattern ? String(args.includePattern) : undefined, Number(args.maxResults ?? 50));
      case 'read_file': return this.readFileTool(String(args.filePath ?? ''), args.startLine, args.endLine);
      case 'git_diff': return this.gitDiffTool(args.filePath ? String(args.filePath) : '', Boolean(args.staged), args.maxChars ? Number(args.maxChars) : undefined);
      case 'replace_string_in_file': return this.replaceStringInFile(String(args.filePath ?? ''), String(args.oldString ?? ''), String(args.newString ?? ''));
      case 'replace_range_in_file': return this.replaceRangeInFile(String(args.filePath ?? ''), Number(args.startLine), Number(args.endLine), String(args.newText ?? ''));
      case 'insert_text_in_file': return this.insertTextInFile(String(args.filePath ?? ''), Number(args.line), String(args.text ?? ''));
      case 'write_file': return this.writeFileTool(String(args.filePath ?? ''), String(args.content ?? ''));
      case 'delete_file': return this.deleteFileTool(String(args.filePath ?? ''));
      case 'create_directory': return this.createDirectoryTool(String(args.dirPath ?? ''));
      case 'get_errors': return this.getErrors(Array.isArray(args.filePaths) ? args.filePaths.map(String) : undefined);
      case 'workspace_index_search': return this.workspaceIndexSearch(String(args.query ?? ''), args.maxResults ? Number(args.maxResults) : undefined);
      case 'workspace_index_refresh': return this.workspaceIndexRefresh();
      case 'web_search': return this.webSearch(String(args.query ?? ''), args.maxResults ? Number(args.maxResults) : undefined);
      case 'web_fetch': return this.webFetch(String(args.url ?? ''), args.maxChars ? Number(args.maxChars) : undefined);
      case 'run_in_terminal': return this.runTerminalTool(String(args.command ?? ''), String(args.explanation ?? ''), String(args.goal ?? 'Run command'));
      default: throw new Error(`Unknown SOREX tool: ${name}`);
    }
  }

  isReadOnlyTool(name: string): boolean { return this.readOnlyToolNames.has(name); }
  isMutatingTool(name: string): boolean { return this.mutatingToolNames.has(name); }
  requiresApprovalTool(name: string): boolean { return this.approvalToolNames.has(name); }

  async searchFiles(includePattern: string, excludePattern = '**/node_modules/**', limit = 100): Promise<string[]> {
    const files = await vscode.workspace.findFiles(includePattern, excludePattern, limit);
    return files.map(uri => vscode.workspace.asRelativePath(uri));
  }

  async readFile(relativePath: string): Promise<string> {
    const uri = this.resolveWorkspacePath(relativePath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }

  async diagnostics(): Promise<string> {
    const entries = vscode.languages.getDiagnostics()
      .flatMap(([uri, diagnostics]) => diagnostics.map(d => ({ uri, d })))
      .slice(0, 150);
    if (!entries.length) return 'No diagnostics.';
    return entries.map(({ uri, d }) => `${vscode.workspace.asRelativePath(uri)}:${d.range.start.line + 1}:${d.range.start.character + 1} ${vscode.DiagnosticSeverity[d.severity]} ${d.message}`).join('\n');
  }

  private async listDir(path: string): Promise<SorexToolResult> {
    const requestedPath = String(path || '.').trim() || '.';
    const uri = this.resolveWorkspacePath(requestedPath);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const sorted = entries.sort(([a, aType], [b, bType]) => {
      const aDir = aType === vscode.FileType.Directory ? 0 : 1;
      const bDir = bType === vscode.FileType.Directory ? 0 : 1;
      return aDir - bDir || a.localeCompare(b);
    });
    const limited = sorted.slice(0, 250);
    const omitted = Math.max(0, sorted.length - limited.length);
    const rootLabel = requestedPath === '.' ? './' : `${requestedPath.replace(/\\/g, '/').replace(/\/+$/g, '')}/`;
    const lines = limited.map(([name, type], index) => {
      const isLastVisible = index === limited.length - 1 && omitted === 0;
      const marker = isLastVisible ? '└──' : '├──';
      return `${marker} ${name}${type === vscode.FileType.Directory ? '/' : ''}`;
    });
    if (omitted) lines.push(`└── … ${omitted} more entries`);
    const tree = [rootLabel, ...(lines.length ? lines : ['└── (empty directory)'])].join('\n');
    return { display: `Listed ${requestedPath}\n${tree}`, model: tree };
  }

  private async fileSearch(query: string, maxResults: number): Promise<SorexToolResult> {
    const files = await this.searchFiles(query, '**/{node_modules,.git,dist,out,build,.next,coverage}/**', Math.min(Math.max(maxResults || 100, 1), 500));
    const text = files.length ? files.join('\n') : 'No files found.';
    return { display: `Searched files: ${query} (${files.length})`, model: text };
  }

  private async grepSearch(query: string, isRegexp: boolean, includePattern?: string, maxResults = 50): Promise<SorexToolResult> {
    if (!query.trim()) throw new Error('grep_search requires a non-empty query.');
    const results: string[] = [];
    const pattern = isRegexp ? new RegExp(query, 'i') : undefined;
    const files = await vscode.workspace.findFiles(includePattern || '**/*.{ts,tsx,js,jsx,json,md,css,html,py,java,go,rs,cpp,c,h,hpp}', '**/{node_modules,.git,dist,out,build,.next,coverage}/**', 1500);
    for (const uri of files) {
      if (results.length >= maxResults) break;
      let text = '';
      try { text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const line = lines[i];
        const hit = pattern ? pattern.test(line) : line.toLowerCase().includes(query.toLowerCase());
        if (hit) results.push(`${vscode.workspace.asRelativePath(uri)}:${i + 1}: ${line.trim().slice(0, 240)}`);
      }
    }
    const text = results.length ? results.join('\n') : 'No matches found.';
    return { display: `Searched text: ${query} (${results.length})`, model: text };
  }

  private async readFileTool(filePath: string, startLine?: number, endLine?: number): Promise<SorexToolResult> {
    if (!filePath.trim()) throw new Error('read_file requires filePath.');
    const uri = this.resolveWorkspacePath(filePath);
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const lines = raw.split(/\r?\n/);
    let output = raw;
    if (typeof startLine === 'number' || typeof endLine === 'number') {
      const start = Math.max(1, Number(startLine ?? 1));
      const end = Math.min(lines.length, Number(endLine ?? Math.min(lines.length, start + 300)));
      output = lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line}`).join('\n');
    } else if (lines.length > 500) {
      output = lines.slice(0, 500).map((line, idx) => `${idx + 1}: ${line}`).join('\n') + `\n... truncated after 500 lines. Re-read with startLine/endLine for more.`;
    }
    return { display: `Read ${vscode.workspace.asRelativePath(uri)}`, model: output };
  }

  private async replaceStringInFile(filePath: string, oldString: string, newString: string): Promise<SorexToolResult> {
    if (!filePath.trim()) throw new Error('replace_string_in_file requires filePath.');
    if (!oldString) throw new Error('replace_string_in_file requires oldString.');
    const uri = this.resolveWorkspacePath(filePath);
    this.assertWritableWorkspacePath(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const first = text.indexOf(oldString);
    if (first < 0) throw new Error('oldString was not found in file. Read the file and use exact text, or use replace_range_in_file.');
    if (text.indexOf(oldString, first + oldString.length) >= 0) throw new Error('oldString appears more than once. Use a more specific exact string or replace_range_in_file.');

    const preview = vscode.workspace.asRelativePath(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(first), document.positionAt(first + oldString.length)), newString);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) throw new Error(`VS Code rejected workspace edit for ${preview}`);
    await this.saveDocument(uri);
    return { display: `Edited ${preview}`, model: `Applied exact string replacement in ${preview}.` };
  }

  private async replaceRangeInFile(filePath: string, startLine: number, endLine: number, newText: string): Promise<SorexToolResult> {
    if (!filePath.trim()) throw new Error('replace_range_in_file requires filePath.');
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) throw new Error('replace_range_in_file requires numeric startLine and endLine.');
    const uri = this.resolveWorkspacePath(filePath);
    this.assertWritableWorkspacePath(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const lineCount = document.lineCount;
    const start = Math.max(1, Math.min(lineCount, Math.floor(startLine)));
    const end = Math.max(start, Math.min(lineCount, Math.floor(endLine)));
    const rangeEnd = end < lineCount ? new vscode.Position(end, 0) : document.lineAt(end - 1).range.end;
    const range = new vscode.Range(new vscode.Position(start - 1, 0), rangeEnd);
    const replacement = end < lineCount && newText && !newText.endsWith('\n') ? `${newText}\n` : newText;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, replacement);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) throw new Error(`VS Code rejected range edit for ${vscode.workspace.asRelativePath(uri)}`);
    await this.saveDocument(uri);
    return { display: `Edited ${vscode.workspace.asRelativePath(uri)}:${start}-${end}`, model: `Replaced lines ${start}-${end} in ${vscode.workspace.asRelativePath(uri)}.` };
  }

  private async insertTextInFile(filePath: string, line: number, text: string): Promise<SorexToolResult> {
    if (!filePath.trim()) throw new Error('insert_text_in_file requires filePath.');
    if (!Number.isFinite(line)) throw new Error('insert_text_in_file requires numeric line.');
    const uri = this.resolveWorkspacePath(filePath);
    this.assertWritableWorkspacePath(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const target = Math.max(1, Math.min(document.lineCount + 1, Math.floor(line)));
    const position = target > document.lineCount ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(target - 1, 0);
    const prefix = target > document.lineCount && document.lineCount > 0 && !document.getText().endsWith('\n') ? '\n' : '';
    const suffix = text && !text.endsWith('\n') ? '\n' : '';
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, position, prefix + text + suffix);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) throw new Error(`VS Code rejected insert edit for ${vscode.workspace.asRelativePath(uri)}`);
    await this.saveDocument(uri);
    return { display: `Inserted text in ${vscode.workspace.asRelativePath(uri)}:${target}`, model: `Inserted text before line ${target} in ${vscode.workspace.asRelativePath(uri)}.` };
  }

  private async writeFileTool(filePath: string, content: string): Promise<SorexToolResult> {
    if (!filePath.trim()) throw new Error('write_file requires filePath.');
    const uri = this.resolveWorkspacePath(filePath);
    this.assertWritableWorkspacePath(uri);
    await this.ensureParentDirectory(uri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return { display: `Wrote ${vscode.workspace.asRelativePath(uri)}`, model: `Wrote ${content.length} characters to ${vscode.workspace.asRelativePath(uri)}.` };
  }

  private async deleteFileTool(filePath: string): Promise<SorexToolResult> {
    if (!filePath.trim()) throw new Error('delete_file requires filePath.');
    const uri = this.resolveWorkspacePath(filePath);
    this.assertWritableWorkspacePath(uri);
    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    return { display: `Deleted ${vscode.workspace.asRelativePath(uri)}`, model: `Moved ${vscode.workspace.asRelativePath(uri)} to trash.` };
  }

  private async createDirectoryTool(dirPath: string): Promise<SorexToolResult> {
    if (!dirPath.trim()) throw new Error('create_directory requires dirPath.');
    const uri = this.resolveWorkspacePath(dirPath);
    this.assertWritableWorkspacePath(uri);
    await vscode.workspace.fs.createDirectory(uri);
    return { display: `Created directory ${vscode.workspace.asRelativePath(uri)}`, model: `Created directory ${vscode.workspace.asRelativePath(uri)}.` };
  }

  private async getErrors(filePaths?: string[]): Promise<SorexToolResult> {
    const filters = new Set((filePaths ?? []).map(p => vscode.workspace.asRelativePath(this.resolveWorkspacePath(p))));
    const entries = vscode.languages.getDiagnostics()
      .flatMap(([uri, diagnostics]) => diagnostics.map(d => ({ uri, d })))
      .filter(({ uri }) => !filters.size || filters.has(vscode.workspace.asRelativePath(uri)))
      .slice(0, 150);

    if (!entries.length) return { display: 'Read diagnostics', model: 'No diagnostics.' };

    const text = entries.map(({ uri, d }) => {
      const path = vscode.workspace.asRelativePath(uri);
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      return `${path}:${line}:${col} ${vscode.DiagnosticSeverity[d.severity]} ${d.message}`;
    }).join('\n');
    return { display: `Read diagnostics (${entries.length})`, model: text };
  }

  private async gitDiffTool(filePath = '', staged = false, maxChars?: number): Promise<SorexToolResult> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) throw new Error('No workspace folder is open.');
    const limit = Math.max(1000, Math.min(Number(maxChars || 20000) || 20000, 60000));
    const args = ['diff', '--no-ext-diff', '--no-color'];
    if (staged) args.push('--cached');
    const cleanPath = String(filePath || '').replace(/\\/g, '/').trim();
    if (cleanPath) {
      const uri = this.resolveWorkspacePath(cleanPath);
      this.assertInsideWorkspace(uri);
      args.push('--', vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/'));
    }

    const result = await new Promise<{ code: number | string; stdout: string; stderr: string }>(resolve => {
      execFile('git', args, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 * 4 }, (error: any, stdout: string, stderr: string) => {
        resolve({
          code: typeof error?.code !== 'undefined' ? error.code : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        });
      });
    });

    const output = result.stdout.trim();
    const stderr = result.stderr.trim();
    if (result.code !== 0 && stderr) throw new Error(`git diff failed: ${stderr.slice(0, 800)}`);
    const target = cleanPath ? vscode.workspace.asRelativePath(this.resolveWorkspacePath(cleanPath), false) : 'workspace';
    const label = `${staged ? 'staged ' : ''}diff${cleanPath ? ` for ${target}` : ''}`;
    const body = output || `No ${label} changes.`;
    return { display: `Read ${label}`, model: body.slice(0, limit) };
  }

  private async runTerminalTool(command: string, explanation: string, goal: string): Promise<SorexToolResult> {
    const cleanCommand = command.trim();
    if (!cleanCommand) throw new Error('run_in_terminal requires command.');
    if (cleanCommand.includes('\0')) throw new Error('run_in_terminal refused a command containing a NUL byte.');
    if (cleanCommand.length > 4000) throw new Error('run_in_terminal refused an unusually long command.');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) throw new Error('No workspace folder is open.');

    const terminal = this.getUserTerminal(cwd);
    terminal.show(true);
    await this.waitForShellIntegration(terminal, 2500);

    const shellIntegration = terminal.shellIntegration;
    if (!shellIntegration) {
      terminal.sendText(cleanCommand, true);
      const body = [
        `Terminal: SOREX User Terminal (VS Code)`,
        `Mode: user-visible terminal, monitoring unavailable`,
        `Command: ${cleanCommand}`,
        `Working directory: ${cwd}`,
        `Goal: ${goal || 'Run command'}`,
        `Reason: ${explanation || 'No explanation provided.'}`,
        '',
        'SOREX sent this command to the visible terminal, but VS Code shell integration was not ready, so live output and exit code could not be captured. Check the SOREX User Terminal panel for the authoritative output.'
      ].join('\n');
      return { display: `Started user terminal: ${goal || cleanCommand}`, model: body.slice(0, 12000) };
    }

    const timeoutMs = 120000;
    const execution = shellIntegration.executeCommand(cleanCommand);
    const exitCodePromise = this.waitForShellExecutionEnd(execution, timeoutMs + 5000);
    const chunks: string[] = [];
    let timedOut = false;
    const startedAt = Date.now();

    try {
      for await (const chunk of execution.read()) {
        chunks.push(String(chunk || ''));
        if (chunks.join('').length > 1024 * 1024 * 2) {
          chunks.push('\n... output truncated after 2MB ...\n');
          break;
        }
        if (Date.now() - startedAt > timeoutMs) {
          timedOut = true;
          break;
        }
      }
    } catch (err) {
      chunks.push(`\n<terminal monitor error: ${err instanceof Error ? err.message : String(err)}>\n`);
    }

    const endedExitCode = await exitCodePromise;
    const exitCode: number | string = typeof endedExitCode === 'number' ? endedExitCode : (timedOut ? 'timeout' : 'unknown');
    const output = chunks.join('').trim();
    const body = [
      `Terminal: SOREX User Terminal (VS Code)`,
      `Mode: user-visible terminal, monitored by VS Code shell integration`,
      `Command: ${cleanCommand}`,
      `Working directory: ${cwd}`,
      `Goal: ${goal || 'Run command'}`,
      `Reason: ${explanation || 'No explanation provided.'}`,
      `Exit code: ${exitCode}`,
      output ? `terminal output:\n${output}` : 'terminal output: <empty>'
    ].join('\n\n');

    const display = exitCode === 0 ? `Ran user terminal: ${goal}` : `User terminal exited ${exitCode}: ${goal}`;
    return { display, model: body.slice(0, 12000) };
  }

  private getUserTerminal(cwd: string): vscode.Terminal {
    if (this.userTerminal && this.userTerminal.exitStatus === undefined) return this.userTerminal;
    this.userTerminal = vscode.window.createTerminal({
      name: 'SOREX User Terminal',
      cwd,
      isTransient: false
    });
    return this.userTerminal;
  }

  private waitForShellIntegration(terminal: vscode.Terminal, timeoutMs: number): Promise<void> {
    if (terminal.shellIntegration) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(done, timeoutMs);
      const disposable = vscode.window.onDidChangeTerminalShellIntegration(event => {
        if (event.terminal === terminal) done();
      });
      function done() {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
      }
    });
  }

  private waitForShellExecutionEnd(execution: vscode.TerminalShellExecution, timeoutMs: number): Promise<number | undefined> {
    return new Promise(resolve => {
      const timer = setTimeout(() => done(undefined), timeoutMs);
      const disposable = vscode.window.onDidEndTerminalShellExecution(event => {
        if (event.execution === execution) done(event.exitCode);
      });
      function done(exitCode: number | undefined) {
        clearTimeout(timer);
        disposable.dispose();
        resolve(exitCode);
      }
    });
  }


  private async workspaceIndexSearch(query: string, maxResults?: number): Promise<SorexToolResult> {
    const rows = await this.workspaceIndex.search(query, maxResults);
    if (!rows.length) return { display: `Index search: ${query} (0)`, model: 'No indexed matches found.' };
    const body = rows.map((r, i) => [
      `${i + 1}. ${r.file}:${r.startLine}-${r.endLine} score ${r.score}`,
      r.preview
    ].join('\n')).join('\n\n---\n\n');
    return { display: `Index search: ${query} (${rows.length})`, model: body.slice(0, 16000) };
  }

  private async workspaceIndexRefresh(): Promise<SorexToolResult> {
    await this.workspaceIndex.refresh();
    return { display: 'Workspace index refreshed', model: this.workspaceIndex.status() };
  }

  private async webSearch(query: string, maxResults?: number): Promise<SorexToolResult> {
    const config = getSorexConfig();
    if (!query.trim()) throw new Error('web_search requires query.');
    const limit = Math.max(1, Math.min(Number(maxResults || config.get('webSearchMaxResults', 5)) || 5, 10));
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { 'user-agent': 'SOREX Code/0.1 (+VS Code extension)' } });
    if (!response.ok) throw new Error(`web_search failed: ${response.status} ${response.statusText}`);
    const html = await response.text();
    const results = parseDuckDuckGoResults(html).slice(0, limit);
    const body = results.length ? results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n') : 'No web results found.';
    return { display: `Web search: ${query} (${results.length})`, model: body.slice(0, 12000) };
  }

  private async webFetch(url: string, maxChars?: number): Promise<SorexToolResult> {
    const config = getSorexConfig();
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('web_fetch requires an http/https URL.');
    const limit = Math.max(1000, Math.min(Number(maxChars || config.get('webFetchMaxChars', 12000)) || 12000, 40000));
    const response = await fetch(target, { headers: { 'user-agent': 'SOREX Code/0.1 (+VS Code extension)' } });
    if (!response.ok) throw new Error(`web_fetch failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    const text = contentType.includes('html') ? htmlToText(raw) : raw;
    return { display: `Fetched ${target}`, model: text.replace(/\n{3,}/g, '\n\n').trim().slice(0, limit) };
  }

  private async saveDocument(uri: vscode.Uri): Promise<void> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (doc) await doc.save();
  }

  private assertWritableWorkspacePath(uri: vscode.Uri): void {
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    if (/^\.vscode\/settings\.json$/i.test(rel)) {
      throw new Error('SOREX will not edit workspace .vscode/settings.json. SOREX settings are saved to the dedicated per-user SOREX/settings.json file instead.');
    }
  }

  private assertInsideWorkspace(uri: vscode.Uri): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('No workspace folder is open.');
    const root = folders[0].uri.fsPath.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
    const target = uri.fsPath.replace(/\\/g, '/').toLowerCase();
    if (target !== root && !target.startsWith(`${root}/`)) {
      throw new Error('SOREX refused to diff a path outside the workspace.');
    }
  }

  private async ensureParentDirectory(uri: vscode.Uri): Promise<void> {
    const parent = vscode.Uri.joinPath(uri, '..');
    try { await vscode.workspace.fs.createDirectory(parent); } catch {}
  }

  private resolveWorkspacePath(path: string): vscode.Uri {
    const trimmed = (path || '.').trim();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('No workspace folder is open.');
    if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/')) return vscode.Uri.file(trimmed);
    const clean = trimmed === '.' ? '' : trimmed.replace(/^\.\//, '');
    return vscode.Uri.joinPath(folders[0].uri, clean);
  }
}

function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = String(html || '').split(/<div class="result[\s\S]*?result__body[\s\S]*?>/i).slice(1);
  for (const block of blocks) {
    const link = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) || block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const rawUrl = decodeHtml(link[1]);
    const url = unwrapDuckDuckGoUrl(rawUrl);
    const title = decodeHtml(stripTags(link[2])).trim();
    if (!title || !url) continue;
    results.push({ title, url, snippet: decodeHtml(stripTags(snippet?.[1] || '')).trim() });
  }
  return results;
}

function unwrapDuckDuckGoUrl(raw: string): string {
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const uddg = url.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return raw;
  }
}

function htmlToText(html: string): string {
  return decodeHtml(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|section|article|h\d|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n'));
}

function stripTags(value: string): string {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
