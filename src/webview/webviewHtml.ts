import * as vscode from 'vscode';
import { webviewUiRuntimeScript, webviewUiStyles } from './ui';

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const assetVersion = String(Date.now());
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js').with({ query: `v=${assetVersion}` }));
  const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sorex-icon.svg'));
  const iconFontUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sorex-icons.ttf').with({ query: `v=${assetVersion}` }));
  const fontFaceStyles = `@font-face{font-family:'SorexIcons';src:url('${String(iconFontUri)}') format('truetype');font-weight:400;font-style:normal;font-display:block;}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">${fontFaceStyles}${webviewUiStyles}</style>
<title>SOREX Code</title>
</head>
<body>
  <div id="bootSplash" class="boot-splash" aria-label="Loading SOREX Code"><div class="boot-logo sorex-logo-icon"><span class="sorex-font-icon" aria-hidden="true">&#xe001;</span></div><div class="boot-title">SOREX Code</div></div>
  <main id="app">
    <header id="titlebar">
      <div class="brand">
        <span class="logo sorex-logo-icon"><span class="sorex-font-icon" aria-hidden="true">&#xe001;</span></span>
        <span class="title">SOREX Code</span>
      </div>
      <div class="top-actions">
        <button id="newChatTop" class="icon-button" title="New chat">＋</button>
        <button id="historyTop" class="icon-button" title="Chat history">◴</button>
        <button id="settings" class="icon-button" title="SOREX settings">⚙</button>
      </div>
    </header>

    <section id="messages" aria-label="SOREX Code chat messages"><div id="welcome" class="welcome"><div class="welcome-mark sorex-logo-icon"><span class="sorex-font-icon" aria-hidden="true">&#xe001;</span></div><div class="welcome-title">SOREX Code</div><div class="welcome-sub">Local-first agent. Select a model, then describe what to build.</div></div></section>

    <section id="activity" class="activity hidden" aria-live="polite">
      <div class="activity-title"><span class="pulse"></span><span id="activityTitle">Working</span></div>
      <div id="activityItems" class="activity-items"></div>
    </section>

    <section id="historyPanel" class="side-panel hidden" aria-label="Chat history">
      <div class="side-panel-head">
        <strong>History</strong>
      </div>
      <div class="history-tabs">
        <button id="historyActiveTab" class="history-tab active">Recent</button>
        <button id="historyArchiveTab" class="history-tab">Archived</button>
      </div>
      <div id="historyList" class="history-list"></div>
    </section>

    <div id="menuBackdrop" class="menu-backdrop hidden" aria-hidden="true"></div>

    <section id="modeMenu" class="model-menu hidden" aria-label="Mode selector">
      <div class="menu-section">
        <div class="menu-title">Mode</div>
        <div class="model-list">
          <button class="model-row mode-row active" data-mode="agent"><span class="row-icon">◈</span><b>Agent</b><span>Code tasks and repo work</span></button>
          <button class="model-row mode-row" data-mode="ask"><span class="row-icon">?</span><b>Ask</b><span>Read-only answer</span></button>
          <button class="model-row mode-row" data-mode="edit"><span class="row-icon">✎</span><b>Edit</b><span>Modify with approval</span></button>
          <button class="model-row mode-row" data-mode="explore"><span class="row-icon">⌕</span><b>Explore</b><span>Trace code only</span></button>
          <button class="model-row mode-row" data-mode="plan"><span class="row-icon">☷</span><b>Plan</b><span>Plan with reads</span></button>
        </div>
      </div>
    </section>

    <section id="permissionMenu" class="model-menu tiny-menu hidden" aria-label="Permission selector">
      <div class="menu-section">
        <div class="menu-title">Permissions</div>
        <div class="model-list">
          <button class="model-row permission-row active" data-permission="ask"><span>✋</span><b>Ask</b><small>Confirm edits/terminal</small></button>
          <button class="model-row permission-row" data-permission="auto"><span>⚡</span><b>Auto</b><small>Safe tools freely</small></button>
          <button class="model-row permission-row" data-permission="autonomous"><span>▶</span><b>Autonomous</b><small>Run without asking</small></button>
          <button class="model-row permission-row" data-permission="manual"><span>□</span><b>Manual</b><small>Ask every time</small></button>
        </div>
      </div>
    </section>

    <section id="modelMenu" class="model-menu hidden" aria-label="Model selector">
      <input id="modelSearch" class="model-search" placeholder="Search models" />
      <div class="menu-section">
        <div class="menu-title">Models</div>
        <div id="localModels" class="model-list"><button class="model-row muted">Loading local models...</button></div>
      </div>
      <div id="cloudProviderSection" class="menu-section cloud-section hidden">
        <div id="cloudProviderTitle" class="menu-title">Cloud models</div>
        <div id="cloudModels" class="model-list"></div>
      </div>
    </section>

    <section id="composer">
      <textarea id="input" rows="3" placeholder="Ask anything"></textarea>
      <div id="composerFooter">
        <button id="attach" class="icon-button mini" title="Attachments coming later">＋</button>
        <button id="modeButton" class="mode-button" title="Agent mode"><span id="modeIcon" class="button-icon">◈</span><span id="modeName">Agent</span></button>
        <button id="permissionButton" class="permission-button" title="Agent permissions"><span class="button-icon">✋</span><span id="permissionName">Ask</span></button>
        <button id="modelButton" class="model-button" title="Select model"><span class="button-icon">◇</span><span id="modelName">Select model</span></button>
        <button id="indexButton" class="index-button" title="Workspace index not built" aria-label="Workspace index status and settings" data-index-state="idle"><span class="index-stack"><i></i><i></i><i></i></span><span id="indexTip" class="index-tip">Workspace index not built</span></button>
        <button id="contextRing" class="context-ring" title="Context usage"><span id="contextValue"></span><span id="contextTip" class="context-tip">0% · 0 / 0 tokens available</span></button>
        <button id="send" class="send-button" title="Send"><span id="sendIcon">↵</span></button>
      </div>
    </section>
  </main>
  <script nonce="${nonce}">window.SOREX_ICON_URI = ${JSON.stringify(String(iconUri))};</script>
  <script nonce="${nonce}">${webviewUiRuntimeScript}</script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
