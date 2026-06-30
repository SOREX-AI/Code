<h1 align="center">
  <img src="media/sorex-pulse.svg" width="141" alt="SOREX Code pulsing logo" />
  <br />
  SOREX Code
</h1>

<p align="center">
  A VS Code coding agent with configurable model providers, workspace tools, repo indexing, context controls, and an integrated chat interface.
</p>

<p align="center">
  <a href="../../actions/workflows/extension.yml"><img alt="Build Extension" src="../../actions/workflows/extension.yml/badge.svg" /></a>
  <img alt="VS Code ^1.125.0" src="https://img.shields.io/badge/VS%20Code-%5E1.125.0-2f80ed?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-extension-3178c6?style=flat-square" />
  <img alt="Providers" src="https://img.shields.io/badge/providers-local%20%2B%20cloud-39c5bb?style=flat-square" />
  <img alt="License Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-dbe7f5?style=flat-square" />
</p>

---

## Overview

SOREX Code is a VS Code extension that connects a language model to the current workspace through explicit, configurable tools. It is designed for codebase questions, repository exploration, targeted edits, diagnostics, indexing, and verification workflows.

The extension is provider-flexible. It can use local OpenAI-compatible endpoints, cloud APIs, or a custom endpoint you configure. The provider is not hidden behind the UI: SOREX exposes provider, model, endpoint, API-key, context, tool, and indexing settings directly.

## What SOREX Does

SOREX gives the selected model a controlled way to work with the project:

| Area | Capability |
| --- | --- |
| Chat | Sidebar webview for asking questions, exploring code, planning, editing, and agent work. |
| Providers | LM Studio, Ollama, Jan, custom OpenAI-compatible endpoints, OpenAI, Anthropic, Google Gemini, and OpenRouter. |
| Workspace tools | Directory listing, file search, grep, file reads, diagnostics, file edits, file creation, deletes, directory creation, terminal execution. |
| Web tools | No-key `web_search` and `web_fetch` for current public coding docs or error references. |
| Indexing | Optional `.ai-index/` repository cache with lexical, vector, and hybrid ranking modes. |
| Context | Token budgeting, provider context detection, safety reserve, output reserve, and auto-compaction. |
| Tool calling | Native provider tool calling plus fallback parsing for models that produce text-form tool calls. |

## Main Features

### Provider Configuration

SOREX supports these provider modes:

| Provider | Notes |
| --- | --- |
| `lmstudio` | Local LM Studio OpenAI-compatible endpoint. |
| `ollama` | Local Ollama OpenAI-compatible endpoint. |
| `jan` | Local Jan OpenAI-compatible endpoint. |
| `custom` | Any OpenAI-compatible endpoint. |
| `openai` | OpenAI API key and model ID. |
| `anthropic` | Anthropic API key and model ID. |
| `google` | Gemini through the configured OpenAI-compatible endpoint. |
| `openrouter` | OpenRouter endpoint and model ID. |

Cloud API keys are stored with VS Code SecretStorage. SOREX does not use a ChatGPT subscription login as an API key.

### Workspace Tools

The model can call workspace tools when the current mode and permission level allow it.

| Tool | Purpose |
| --- | --- |
| `list_dir` | Inspect folders and project layout. |
| `file_search` | Locate files by glob. |
| `grep_search` | Search text, symbols, imports, settings, and UI labels. |
| `read_file` | Read exact source files before detailed answers or edits. |
| `get_errors` | Read VS Code diagnostics. |
| `replace_string_in_file` | Replace exact text in a file. |
| `replace_range_in_file` | Replace a line range. |
| `insert_text_in_file` | Insert text at a specific line. |
| `write_file` | Create or overwrite a file. |
| `delete_file` | Delete a workspace file when requested. |
| `create_directory` | Create folders. |
| `run_in_terminal` | Run build, test, package, or verification commands. |
| `workspace_index_search` | Search the SOREX workspace index. |
| `workspace_index_refresh` | Refresh the workspace index. |
| `web_search` | Search current public coding information. |
| `web_fetch` | Fetch readable text from a public URL. |

Every tool can be enabled or disabled from the Tooling settings surface.

### Tool Calling Compatibility

SOREX can send native tool schemas to providers that support function/tool calling. Some models respond better with plain text tool-call formats, especially free or smaller OpenRouter models. SOREX includes fallback parsing for those cases.

The **Native tool calling** setting controls whether SOREX attempts native provider tools. Even when enabled, SOREX can still route awkward model/provider combinations through fallback parsing.

### Workspace Indexing

The indexer can build a persistent repository cache under:

```text
.ai-index/
```

The cache can contain:

```text
manifest.json
repo-map.json
chunks.json
vectors.json
```

Indexing settings cover:

- storage mode
- ranking mode
- include and exclude globs
- file count and file size limits
- chunk size and overlap
- stale time
- embedding provider
- embedding endpoint/model
- embedding batch size
- semantic ranking weight

Ranking modes include lexical, vector, and hybrid. Embeddings are optional; lexical indexing remains available without embedding vectors.

### Context Management

SOREX tracks and budgets the context used by chat, tool results, tool schemas, reserves, and output. Context settings include:

- provider-reported context window
- manual input token budget
- output token budget
- safety token reserve
- compaction threshold
- maximum user message size
- optional tool schema budget accounting

The goal is to keep long coding sessions usable without silently overflowing the selected model's context window.

### Modes And Permissions

SOREX separates intent from authority.

| Mode | Behavior |
| --- | --- |
| Ask | Read-only answers and inspection. |
| Explore | Read-only project exploration. |
| Plan | Read-only planning. |
| Edit | Allows code changes when requested. |
| Agent | Runs the full model/tool loop subject to permissions. |

Permission modes control whether tools run automatically, require approval, or stay manual. Higher-impact actions such as file edits and terminal commands remain gated by the selected permission behavior.

## Settings

Open **SOREX Code: Open Settings** to configure the extension.

| Page | Controls |
| --- | --- |
| Providers | Active provider, endpoint, model, cloud API key management. |
| Context | Token budgets, compaction, provider context, safety reserve. |
| Indexing | Workspace indexing, ranking, embeddings, file selection, chunking. |
| Tooling | Tool visibility, native tool calling, web tool limits. |
| Agent | Temperature, tool loop limits, conservative tool calling. |

The panel also includes **Edit settings.json** for direct access to the SOREX settings file.

## Commands

| Command | Description |
| --- | --- |
| `SOREX Code: Open Local Agent` | Opens the SOREX chat view. |
| `SOREX Code: Open Settings` | Opens the settings panel. |
| `SOREX Code: Clear Chat` | Clears the current chat. |
| `SOREX Code: Test Workspace Tools` | Runs a workspace-tool smoke test. |
| `SOREX Code: Open Indexing Settings` | Opens settings focused on indexing. |
| `SOREX Code: Refresh Workspace Index` | Rebuilds or refreshes the workspace index. |

## Development

Install dependencies and compile:

```powershell
npm install
npm run compile
```

Package the extension:

```powershell
npm run package
```

Project layout:

```text
src/
  config/      Settings storage and migration.
  indexing/    Workspace index, chunks, repo map, vectors.
  llm/         Provider clients, model handling, tool-call parsing.
  prompts/     System and mode prompts.
  tools/       VS Code workspace tool implementations.
  webview/     Chat view, settings panel, UI scripts, styles.
media/
  sorex-icon.png
  sorex-icon.svg
  sorex.svg
  sorex-pulse.svg
```

## Safety And Cost Controls

SOREX calls the provider you configure. Local endpoints run wherever your local provider is running. Cloud providers require official API keys and may bill according to that provider's rules.

Recommended cloud-provider precautions:

- Use provider-side credit or request limits.
- Use free model IDs only when you want free-provider behavior.
- Disable embeddings unless you intentionally want vector indexing through the selected embedding provider.
- Keep edit and terminal permissions aligned with how much autonomy you want.

## License

SOREX Code is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
