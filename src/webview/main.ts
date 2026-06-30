// @ts-nocheck

type SorexWebviewMessage = { type: string; [key: string]: unknown };
type SorexVsCodeApi = {
  postMessage(message: SorexWebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare function acquireVsCodeApi(): SorexVsCodeApi;

interface Window {
  SOREX_ICON_URI?: string;
  SOREX_UI?: {
    createComposerController(options: { composer: HTMLElement | null; send: HTMLElement | null; sendIcon: HTMLElement | null }): {
      setOrbitDuration(durationSeconds: number): void;
      setRunningVisual(running: boolean): void;
    };
    createContextRingController(options: { ring: HTMLElement | null; value: HTMLElement | null; tip: HTMLElement | null; clamp(value: number, min: number, max: number): number }): {
      setup(): void;
      setPercent(pct: number, approx?: number, max?: number, available?: number, compactAt?: number, details?: Record<string, unknown>): void;
    };
    createHistoryController(options: { panel: HTMLElement | null; list: HTMLElement | null }): any;
    createSettingsEntryController(options: { vscode: SorexVsCodeApi }): any;
    createEditSummaryController(options: { vscode: SorexVsCodeApi }): any;
    createAssistantActionsController(options: { vscode: SorexVsCodeApi }): any;
    createModelPickerController(): any;
    createMenusController(options: Record<string, HTMLElement | null>): any;
  };
}

const vscode = acquireVsCodeApi();

const messages = document.getElementById('messages');
const input = document.getElementById('input');
const send = document.getElementById('send');
const sendIcon = document.getElementById('sendIcon');
const settings = document.getElementById('settings');
const refreshModels = document.getElementById('refreshModels');
const modelButton = document.getElementById('modelButton');
const indexButton = document.getElementById('indexButton');
const indexTip = document.getElementById('indexTip');
const modelName = document.getElementById('modelName');
const modelMenu = document.getElementById('modelMenu');
const menuBackdrop = document.getElementById('menuBackdrop');
const modelSearch = document.getElementById('modelSearch');
const localModels = document.getElementById('localModels');
const cloudProviderSection = document.getElementById('cloudProviderSection');
const cloudProviderTitle = document.getElementById('cloudProviderTitle');
const cloudModels = document.getElementById('cloudModels');
const cloudModelsToggle = document.getElementById('cloudModelsToggle');
const cloudModelsChevron = document.getElementById('cloudModelsChevron');
const modeButton = document.getElementById('modeButton');
const modeName = document.getElementById('modeName');
const modeIcon = document.getElementById('modeIcon');
const modeMenu = document.getElementById('modeMenu');
const historyTop = document.getElementById('historyTop');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const historyActiveTab = document.getElementById('historyActiveTab');
const historyArchiveTab = document.getElementById('historyArchiveTab');
const newChatTop = document.getElementById('newChatTop');
const newChatHistory = document.getElementById('newChatHistory');
const welcome = document.getElementById('welcome');
const contextRing = document.getElementById('contextRing');
const contextValue = document.getElementById('contextValue');
const contextTip = document.getElementById('contextTip');
const permissionButton = document.getElementById('permissionButton');
const permissionName = document.getElementById('permissionName');
const permissionMenu = document.getElementById('permissionMenu');
const composer = document.getElementById('composer');
const bootSplash = document.getElementById('bootSplash');
const composerController = window.SOREX_UI.createComposerController({ composer, send, sendIcon });
const contextRingController = window.SOREX_UI.createContextRingController({ ring: contextRing, value: contextValue, tip: contextTip, clamp });
const historyController = window.SOREX_UI.createHistoryController({ panel: historyPanel, list: historyList });
const settingsEntryController = window.SOREX_UI.createSettingsEntryController({ vscode });
const editSummaryController = window.SOREX_UI.createEditSummaryController({ vscode });
const assistantActionsController = window.SOREX_UI.createAssistantActionsController({ vscode });
const modelPickerController = window.SOREX_UI.createModelPickerController();
const menusController = window.SOREX_UI.createMenusController({ modelMenu, modeMenu, permissionMenu, modelButton, modeButton, permissionButton });

let currentModel = '';
let currentProviderMode = 'lmstudio';
let currentMode = 'agent';
let activeSessionId = randomId();
let sessions = loadSessions();
let archivedSessions = loadArchivedSessions();
let historyTab = 'active';
let permissionMode = 'ask';
let transcript = [];
let activeProgress = null;
let activeProcess = [];
let activeCompactLine = null;
let compactLines = new Map();
let compactUiBurstRow = null;
let compactUiBurstUpdatedAt = 0;
let compactUiBurstGeneration = 0;
let compactUiBurstFinishTimer = 0;
let compactUiActive = false;
let compactQueuedMessages = [];
let manualCompactActive = false;
const COMPACT_UI_MERGE_MS = 12000;
let activeToolRows = new Map();
let currentFinalAssistantEl = null;
let allLocalModels = [];
let cloudModelsByProvider = { openai: [], anthropic: [], google: [], openrouter: [] };
let cloudApiKeysByProvider = { openai: false, anthropic: false, google: false, openrouter: false };
let cloudModelsExpanded = false;
let isRunning = false;
let lastRuntimeTokensPerSecond = 0;
let activeTextAnimation = null;
let activeTextAnimations = new Set();
let finalAssistantTyping = false;
let ignoreNextStopped = false;
let indexCompleteTimer = 0;
let savedChatScrollTopBeforeHistory = 0;

function getChatScroller() {



  if (messages) return messages;
  return document.scrollingElement || document.documentElement || document.body;
}

function scrollChatToBottom() {
  const scroller = getChatScroller();
  if (!scroller) return;
  scroller.scrollTop = scroller.scrollHeight;
}

function scrollChatBy(delta) {
  const amount = Number(delta) || 0;
  if (!amount) return;
  const scroller = getChatScroller();
  if (scroller) scroller.scrollTop += amount;
}

function chatViewportRect() {
  const rect = messages?.getBoundingClientRect?.();
  if (rect && rect.width && rect.height) return rect;
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  return { top: 0, left: 0, right: width, bottom: height, width, height };
}

contextRingController.setup();
contextRing?.classList.add('empty');
// Let the boot logo animate through at least one full shimmer cycle, then fade out.
if (bootSplash) {
  bootSplash.classList.remove('ready');
  requestAnimationFrame(() => {
    bootSplash.classList.add('boot-animating');
    const bootGlyph = bootSplash.querySelector('.boot-logo .sorex-font-icon');
    if (bootGlyph) {
      bootGlyph.style.animation = 'none';
      void bootGlyph.offsetWidth;
      bootGlyph.style.animation = '';
    }
    window.setTimeout(() => {
      const lateGlyph = bootSplash.querySelector('.boot-logo .sorex-font-icon');
      if (lateGlyph) {
        lateGlyph.style.animation = 'none';
        void lateGlyph.offsetWidth;
        lateGlyph.style.animation = '';
      }
    }, 60);
    window.setTimeout(() => bootSplash.classList.add('ready'), 4400);
  });
}

function setIndexStatus(data = {}) {
  if (!indexButton) return;
  const rawState = String(data.state || 'empty').toLowerCase();
  const allowed = new Set(['idle', 'empty', 'checking', 'indexing', 'ready', 'success', 'complete', 'disabled', 'error']);
  const state = allowed.has(rawState) ? rawState : 'empty';
  if (indexCompleteTimer) {
    clearTimeout(indexCompleteTimer);
    indexCompleteTimer = 0;
  }
  indexButton.dataset.indexState = state;
  indexButton.classList.toggle('auto-index-on', data.enabled !== false && data.autoRefresh === true);
  indexButton.classList.toggle('manual-index-only', data.enabled !== false && data.autoRefresh !== true);
  indexButton.classList.toggle('index-disabled', data.enabled === false || state === 'disabled');
  const label = data.label || (
    state === 'indexing' ? 'Indexing...' :
    state === 'complete' ? 'Index complete' :
    state === 'ready' || state === 'success' ? 'Index ready' :
    state === 'disabled' ? 'Index disabled' :
    state === 'error' ? 'Index error' :
    'Index not built'
  );
  const detail = data.detail || label;
  const count = Number(data.indexedFiles || 0) || Number(data.files || 0) || 0;
  const chunks = Number(data.chunks || 0) || 0;
  const skipped = Number(data.skippedFiles || 0) || 0;
  const meta = count || chunks ? ` - ${count.toLocaleString()} files - ${chunks.toLocaleString()} chunks${skipped ? ` - ${skipped.toLocaleString()} skipped` : ''}` : '';
  const mode = data.enabled === false ? 'disabled' : (data.autoRefresh === true ? 'auto index on' : 'manual index only');
  const text = `${label}${meta} - ${mode}\n${detail}`.trim();
  const displayText = simpleIndexStatusLabel(state, label);
  indexButton.title = displayText;
  indexButton.setAttribute('aria-label', displayText);
  if (indexTip) indexTip.textContent = displayText;
  if (state === 'complete') {
    indexCompleteTimer = window.setTimeout(() => {
      indexButton.dataset.indexState = 'success';
      const readyText = 'Index is up to date';
      indexButton.title = readyText;
      indexButton.setAttribute('aria-label', readyText);
      if (indexTip) indexTip.textContent = readyText;
      indexCompleteTimer = 0;
    }, 2600);
  }
}

function simpleIndexStatusLabel(state, fallback = '') {
  if (state === 'checking') return 'Checking index...';
  if (state === 'indexing') return 'Indexing...';
  if (state === 'complete' || state === 'ready' || state === 'success') return 'Index is up to date';
  if (state === 'disabled') return 'Indexing off';
  if (state === 'error') return 'Index error';
  return String(fallback || 'Index not built').trim();
}


setIndexStatus({ state: 'empty', label: 'Index not built', detail: 'Workspace index has not been built yet.' });
const modeIcons = { agent: '\u25C6', ask: '?', edit: '\u270E', explore: '\u2315', plan: '\u2637' };
const permissionIcons = { ask: '\u270B', auto: '\u26A1', autonomous: '\u25B6', manual: '\u25A1' };

function randomId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
}

function loadSessions() {
  const state = vscode.getState() || {};
  return Array.isArray(state.sessions) ? state.sessions : [];
}

function loadArchivedSessions() {
  const state = vscode.getState() || {};
  return Array.isArray(state.archivedSessions) ? state.archivedSessions : [];
}

function saveSessions() {
  const state = vscode.getState() || {};
  vscode.setState({ ...state, sessions, archivedSessions });
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function updateWelcome() {
  welcome.classList.toggle('hidden', transcript.length > 0 || messages.children.length > 0);
}

function renderMarkdown(text) {
  const blocks = [];
  let src = String(text ?? '').replace(/\r\n/g, '\n');
  src = src.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const token = `@@CODE${blocks.length}@@`;
    blocks.push(`<pre><div class="code-head">${escapeHtml(lang || 'code')}</div><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return token;
  });

  const lines = src.split('\n');
  let html = '';
  let listOpen = false;
  let orderedOpen = false;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    html += `<p>${inline(para.join(' '))}</p>`;
    para = [];
  };
  const closeLists = () => {
    if (listOpen) { html += '</ul>'; listOpen = false; }
    if (orderedOpen) { html += '</ol>'; orderedOpen = false; }
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trimEnd();
    if (!line.trim()) { flushPara(); closeLists(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); closeLists();
      html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (orderedOpen) { html += '</ol>'; orderedOpen = false; }
      if (!listOpen) { html += '<ul>'; listOpen = true; }
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushPara();
      if (listOpen) { html += '</ul>'; listOpen = false; }
      if (!orderedOpen) { html += '<ol>'; orderedOpen = true; }
      html += `<li>${inline(numbered[1])}</li>`;
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara(); closeLists();
      html += `<blockquote>${inline(quote[1])}</blockquote>`;
      continue;
    }
    para.push(line);
  }
  flushPara(); closeLists();

  html = html.replace(/@@CODE(\d+)@@/g, (_, i) => blocks[Number(i)] || '');
  return `<div class="md">${html}</div>`;
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function estimatedTokensPerSecondForModel(modelId) {
  const name = String(modelId || '').toLowerCase();
  if (!name) return 18;
  if (/\b(1\.5b|3b|4b|mini|small|flash|haiku)\b/.test(name)) return 42;
  if (/\b(7b|8b|9b)\b/.test(name)) return 28;
  if (/\b(13b|14b|15b)\b/.test(name)) return 18;
  if (/\b(20b|22b|24b|30b|32b|34b)\b/.test(name)) return 10;
  if (/\b(70b|72b|90b|110b|120b)\b/.test(name)) return 5;
  if (/gpt|claude|gemini|openai|anthropic|google|openrouter/.test(name)) return 36;
  return 18;
}

function activeTokensPerSecond() {
  return clamp(lastRuntimeTokensPerSecond || estimatedTokensPerSecondForModel(currentModel), 3, 70);
}

function typewriterCharsPerSecond() {
  return activeCharsPerSecond();
}

function activeCharsPerSecond() {


  return clamp(activeTokensPerSecond() * 3.05, 12, 86);
}

function liveInternalCharsPerSecond(totalChars) {
  const chars = Math.max(1, Number(totalChars) || 1);


  return clamp(Math.max(activeCharsPerSecond(), chars / 5.8), 18, 220);
}

function bufferedFinalCharsPerSecond(totalChars) {





  const chars = Math.max(1, Number(totalChars) || 1);
  const modelDriven = activeTokensPerSecond() * 10.5;
  const maxDurationDriven = chars / 7.2;
  return clamp(Math.max(modelDriven, maxDurationDriven, 120), 100, 680);
}

function runTextAnimation(stepper, onDone, options = {}) {
  const state = { cancelled: false, frame: 0 };
  const started = performance.now();
  const frame = (now) => {
    if (state.cancelled) return;
    const elapsedSeconds = Math.max(0, (now - started) / 1000);
    const finished = stepper(elapsedSeconds);
    if (typeof options.onFrame === 'function') options.onFrame();
    else if (options.autoScroll !== false) scrollChatToBottom();
    if (finished) {
      activeTextAnimations.delete(state);
      if (activeTextAnimation === state) activeTextAnimation = null;
      if (typeof onDone === 'function') onDone(false);
      return;
    }
    state.frame = requestAnimationFrame(frame);
  };
  state.cancel = () => {
    if (state.cancelled) return;
    state.cancelled = true;
    if (state.frame) cancelAnimationFrame(state.frame);
    activeTextAnimations.delete(state);
    if (activeTextAnimation === state) activeTextAnimation = null;
    if (typeof onDone === 'function') onDone(true);
  };
  activeTextAnimation = state;
  activeTextAnimations.add(state);
  state.frame = requestAnimationFrame(frame);
  return state;
}


function forceSolidAssistantDialogText(el) {
  if (!el) return;
  el.classList.remove('sorex-pulse-text', 'dom-shimmer-text', 'tool-active-text');
  el.classList.add('solid-assistant-text');
  const important = 'important';
  el.style.setProperty('color', 'color-mix(in srgb, var(--vscode-foreground) 78%, var(--sorex-muted) 22%)', important);
  el.style.setProperty('-webkit-text-fill-color', 'currentColor', important);
  el.style.setProperty('background', 'none', important);
  el.style.setProperty('background-image', 'none', important);
  el.style.setProperty('animation', 'none', important);
  el.style.setProperty('filter', 'none', important);
  el.style.setProperty('text-shadow', 'none', important);
}

function animatePlainText(target, text, onDone) {
  const full = String(text || '');
  target.textContent = '';
  target.dataset.pulseText = '';

  return runTextAnimation((elapsedSeconds) => {
    const count = Math.min(full.length, Math.floor(elapsedSeconds * liveInternalCharsPerSecond(full.length)));
    const visible = full.slice(0, count);
    target.textContent = visible;
    target.dataset.pulseText = visible;
    if (target.classList?.contains('solid-assistant-text')) forceSolidAssistantDialogText(target);
    return count >= full.length;
  }, onDone);
}

function revealUnits(text) {
  return String(text || '').match(/\S+\s*/g) || [];
}

function textTokenEstimate(value) {
  const raw = String(value ?? '');
  if (!raw.trim()) return 1;


  return Math.max(1, Math.ceil(raw.length / 4));
}

function fallbackRowsForText(target, text) {
  const full = String(text || '');
  if (!full) return [];
  const width = Math.max(80, Math.floor(target?.getBoundingClientRect?.().width || messages?.getBoundingClientRect?.().width || 260));
  const computed = target ? getComputedStyle(target) : null;
  const fontSize = Number.parseFloat(computed?.fontSize || '') || 14;
  const approxCharWidth = Math.max(6, fontSize * 0.56);
  const limit = Math.max(18, Math.floor(width / approxCharWidth));
  const rows = [];

  for (const sourceLine of full.split('\n')) {
    if (!sourceLine) {
      rows.push('');
      continue;
    }
    let row = '';
    const parts = sourceLine.match(/\S+\s*|\s+/g) || [sourceLine];
    for (const part of parts) {
      if ((row + part).length <= limit || !row) {
        row += part;
        continue;
      }
      rows.push(row);
      row = part;
    }
    if (row) rows.push(row);
  }
  return rows;
}

function measureVisualRows(target, text) {
  const full = String(text || '');
  if (!full) return [];
  if (!target || !target.isConnected) return fallbackRowsForText(target, full);

  const measure = document.createElement('div');
  measure.className = 'row-measure';
  const targetWidth = Math.max(1, Math.floor(target.getBoundingClientRect().width || 0));
  if (targetWidth) measure.style.width = `${targetWidth}px`;
  measure.textContent = full;
  target.appendChild(measure);

  const node = measure.firstChild;
  if (!node) {
    measure.remove();
    return fallbackRowsForText(target, full);
  }

  const units = [];
  const re = /\S+\s*|\s+/g;
  let match;
  while ((match = re.exec(full))) {
    units.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }

  const rows = [];
  let row = '';
  let rowTop = null;
  const range = document.createRange();

  try {
    for (const unit of units) {
      range.setStart(node, unit.start);
      range.setEnd(node, unit.end);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0);
      const rect = rects[rects.length - 1];
      const top = rect ? Math.round(rect.top * 2) / 2 : rowTop;
      if (rowTop === null && typeof top === 'number') rowTop = top;
      if (row && typeof top === 'number' && rowTop !== null && Math.abs(top - rowTop) > 3) {
        rows.push(row);
        row = unit.text;
        rowTop = top;
      } else {
        row += unit.text;
      }
    }
    if (row || !rows.length) rows.push(row);
  } catch (_err) {
    range.detach?.();
    measure.remove();
    return fallbackRowsForText(target, full);
  }

  range.detach?.();
  measure.remove();
  return rows.length ? rows : fallbackRowsForText(target, full);
}

function rowRevealHtml(rows) {
  return rows.map((row) => {
    const visible = row === '' ? '&nbsp;' : escapeHtml(row);
    return `<span class="fade-row" style="opacity:0;--row-reveal:0%">${visible}</span>`;
  }).join('');
}

function setRowRevealProgress(el, progress) {
  const eased = clamp(progress, 0, 1);
  const pct = Math.round(eased * 100);
  el.style.opacity = String(eased);
  el.style.transform = `translateY(${(1 - eased) * 4}px)`;
  el.style.filter = `blur(${(1 - eased) * 1.4}px)`;
  el.style.setProperty('--row-reveal', `${pct}%`);
}

function animateRowText(target, text, options = {}, onDone) {
  const full = String(text || '');
  target.innerHTML = '';
  target.classList.add('rowwise-appearing');

  if (!full) {
    if (options.markdown) target.innerHTML = renderMarkdown(full);
    else target.textContent = full;
    target.classList.remove('rowwise-appearing');
    if (typeof onDone === 'function') onDone(false);
    return null;
  }

  const rows = measureVisualRows(target, full);
  const meta = rows.map((row) => ({ text: row, tokens: textTokenEstimate(row) }));
  let cursor = 0;
  for (const row of meta) {
    row.start = cursor;
    cursor += Math.max(1, row.tokens);
    row.end = cursor;
  }
  const totalTokens = Math.max(1, cursor);

  target.innerHTML = rowRevealHtml(rows);
  const rowEls = Array.from(target.querySelectorAll('.fade-row'));
  if (!rowEls.length) {
    if (options.markdown) target.innerHTML = renderMarkdown(full);
    else target.textContent = full;
    target.classList.remove('rowwise-appearing');
    if (typeof onDone === 'function') onDone(false);
    return null;
  }

  let activeRevealRow = rowEls[0] || target;
  return runTextAnimation((elapsedSeconds) => {
    const tps = activeTokensPerSecond();
    const visibleTokens = (elapsedSeconds * tps) + 0.35;
    let latestVisible = rowEls[0] || target;
    for (let i = 0; i < rowEls.length; i += 1) {
      const row = meta[i];
      const progress = (visibleTokens - row.start) / Math.max(0.75, row.tokens);
      setRowRevealProgress(rowEls[i], progress);
      if (progress > 0) latestVisible = rowEls[i];
    }
    activeRevealRow = latestVisible;
    return visibleTokens >= totalTokens;
  }, (cancelled) => {
    if (options.markdown) target.innerHTML = renderMarkdown(full);
    else target.textContent = full;
    target.classList.remove('rowwise-appearing');
    if (typeof onDone === 'function') onDone(cancelled);
  }, {
    autoScroll: false,
    onFrame: () => {
      if (options.scrollMode === 'none') return;
      revealInMessages(activeRevealRow || target, { preferTop: options.scrollMode === 'top' });
    }
  });
}

function revealWordsInRenderedMarkdown(root) {
  root.querySelectorAll('pre').forEach((block) => {
    block.classList.add('block-fade');
  });
  root.querySelectorAll('code:not(pre code)').forEach((code) => {
    code.classList.add('word-fade', 'inline-code-fade');
    const listItem = code.closest?.('li');
    if (listItem) {
      listItem.classList.add('li-word-pending');
      code.dataset.listItem = String(Array.from(root.querySelectorAll('li')).indexOf(listItem));
    }
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!String(node.nodeValue || '').trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest?.('code, pre, .assistant-footer')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  const wordEls = [];
  for (const node of textNodes) {
    const frag = document.createDocumentFragment();
    const parts = String(node.nodeValue || '').match(/\S+\s*|\s+/g) || [];
    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.className = 'word-fade';
        span.textContent = part;
        const listItem = node.parentElement?.closest?.('li');
        if (listItem) {
          listItem.classList.add('li-word-pending');
          span.dataset.listItem = String(Array.from(root.querySelectorAll('li')).indexOf(listItem));
        }
        frag.appendChild(span);
        wordEls.push(span);
      }
    }
    node.replaceWith(frag);
  }
  return Array.from(root.querySelectorAll('.word-fade, .block-fade')).sort((a, b) => {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

function animateMarkdownText(target, text, onDone) {
  const full = String(text || '');
  target.innerHTML = renderMarkdown(full);
  target.classList.add('markdown-wordwise-appearing', 'markdown-blockwise-appearing');
  target.classList.remove('rowwise-appearing');

  const md = target.querySelector('.md') || target;
  const blockEls = Array.from(md.children.length ? md.children : [md]);
  for (const block of blockEls) {
    block.classList.add('block-fade');
  }

  if (!full.trim()) {
    target.classList.remove('markdown-wordwise-appearing', 'markdown-blockwise-appearing');
    if (typeof onDone === 'function') onDone(false);
    return null;
  }

  if (!blockEls.length) {
    target.classList.remove('markdown-wordwise-appearing', 'markdown-blockwise-appearing');
    if (typeof onDone === 'function') onDone(false);
    return null;
  }

  const tokenEnds = [];
  let cursor = 0;
  for (const el of blockEls) {
    const unitTokens = Math.max(1.2, Math.min(9, textTokenEstimate(el.textContent || '') * 0.22));
    cursor += unitTokens;
    tokenEnds.push(cursor);
  }
  const totalTokens = Math.max(1, cursor);

  return runTextAnimation((elapsedSeconds) => {
    const revealTps = Math.max(activeTokensPerSecond() * 1.35, 11);
    const visibleTokens = (elapsedSeconds * revealTps) + 0.8;
    for (let i = 0; i < blockEls.length; i += 1) {
      if (visibleTokens < tokenEnds[i]) break;
      blockEls[i].classList.add('visible');
    }
    return visibleTokens >= totalTokens;
  }, (cancelled) => {
    for (const block of blockEls) block.classList.add('visible');
    target.classList.remove('markdown-wordwise-appearing', 'markdown-blockwise-appearing');
    scrollChatToBottom();
    requestAnimationFrame(() => scrollChatToBottom());
    requestAnimationFrame(() => requestAnimationFrame(scrollChatToBottom));
    if (typeof onDone === 'function') onDone(cancelled);
  }, {
    autoScroll: false,
    onFrame: () => {
      scrollChatToBottom();
    }
  });
}

function animateWordText(target, text, onDone) {
  return animateRowText(target, text, { markdown: false }, onDone);
}

function animatePlainWordFade(target, text, onDone) {
  const full = String(text || '');
  target.textContent = '';
  target.classList.add('plain-wordwise-appearing');
  const parts = full.match(/\S+\s*|\s+/g) || [];
  const wordEls = [];
  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      target.appendChild(document.createTextNode(part));
      continue;
    }
    const span = document.createElement('span');
    span.className = 'dialog-word-fade';
    span.textContent = part;
    target.appendChild(span);
    wordEls.push(span);
  }
  if (!wordEls.length) {
    target.textContent = full;
    target.classList.remove('plain-wordwise-appearing');
    if (typeof onDone === 'function') onDone(false);
    return null;
  }
  const tokenEnds = [];
  let cursor = 0;
  for (const el of wordEls) {
    cursor += Math.max(0.35, textTokenEstimate(el.textContent || ''));
    tokenEnds.push(cursor);
  }
  const totalTokens = Math.max(1, cursor);
  return runTextAnimation((elapsedSeconds) => {
    const revealTps = Math.max(activeTokensPerSecond() * 1.15, 10);
    const visibleTokens = (elapsedSeconds * revealTps) + 0.55;
    for (let i = 0; i < wordEls.length; i += 1) {
      if (visibleTokens < tokenEnds[i]) break;
      wordEls[i].classList.add('visible');
    }
    return visibleTokens >= totalTokens;
  }, (cancelled) => {
    target.textContent = full;
    target.classList.remove('plain-wordwise-appearing');
    if (typeof onDone === 'function') onDone(cancelled);
  }, {
    autoScroll: false,
    onFrame: () => revealInMessages(target, { preferTop: false })
  });
}

function animateFadeText(target, text, onDone) {
  return animatePlainText(target, text, onDone);
}

function prepareLivePulse(root = document) {
  const targets = root.querySelectorAll('.progress-line.live-text span:not(.progress-dot):not(.tool-icon), .progress-item.live-text .tool-main, .approval-main.live-text span:not(.tool-icon)');
  for (const el of targets) {
    if (el.classList.contains('tool-icon') || el.classList.contains('progress-dot') || el.classList.contains('row-icon')) continue;
    el.classList.add('sorex-pulse-text');
    el.dataset.pulseText = el.textContent || '';
  }
}

function append(type, text, animate = false, process = [], onDone = null, meta = {}) {
  const el = document.createElement('div');
  el.className = `message ${type}`;
  messages.appendChild(el);
  scrollChatToBottom();

  if (type === 'assistant') {
    if (Array.isArray(process) && process.length) {
      const p = document.createElement('div');
      p.innerHTML = renderProcessSummary(process);
      const summaryEl = p.firstElementChild;
      if (summaryEl) messages.insertBefore(summaryEl, el);
    }
    el.innerHTML = renderMarkdown('');
    if (!animate) {
      el.innerHTML = renderMarkdown(text);
      addAssistantFooter(el, text, process, meta);
      updateWelcome();
      return el;
    }
    currentFinalAssistantEl = el;
    animateMarkdownText(el, text, (cancelled) => {
      if (currentFinalAssistantEl === el) currentFinalAssistantEl = null;
      if (!cancelled) addAssistantFooter(el, text, process, meta);
      if (!cancelled) saveCurrentSession();
      if (typeof onDone === 'function') onDone(cancelled);
    });
    updateWelcome();
    return el;
  }

  el.textContent = text;
  updateWelcome();
  return el;
}

function renderProcessSummary(process) {
  if (!Array.isArray(process) || !process.length) return '';
  const summary = process.map(item => {
    if (String(item.name || '').toLowerCase().includes('compact')) {
      return `<div class="process-item process-compact-summary"><span></span><span>${escapeHtml(item.title || 'Conversation Compacted')}</span><span></span></div>`;
    }
    return `<div class="process-item"><span class="${toolIconClass(item.name)}">${toolIcon(item.name)}</span><span class="tool-main">${formatToolTitleHtml(item.title || prettyToolName(item.name))}</span><small>${escapeHtml(item.detail || '')}</small></div>`;
  }).join('');
  return `<details class="process-summary"><summary>Activity summary</summary><div class="process-list">${summary}</div></details>`;
}

function formatToolTitleHtml(title = '') {
  const text = String(title || '');
  return escapeHtml(text).replace(/(\s)(\+\d+)(\s)(-\d+)\s*$/u, '$1<span class="edit-plus">$2</span>$3<span class="edit-minus">$4</span>');
}

function addAssistantFooter(messageEl, text = '', process = [], meta = {}) {
  if (!messageEl || messageEl.querySelector(':scope > .assistant-footer')) return;
  const footer = document.createElement('div');
  footer.className = 'assistant-footer';
  const editSessionId = String(meta.editSessionId || '');
  const editCard = renderEditSummaryCard(process, editSessionId);
  footer.innerHTML = `${editCard}<div class="assistant-actions" aria-label="Assistant response actions">
    <button type="button" class="assistant-action copy" title="Copy response" aria-label="Copy response">${actionIcon('copy')}</button>
    <button type="button" class="assistant-action thumbs-up" title="Good response" aria-label="Good response">${actionIcon('thumbsUp')}</button>
    <button type="button" class="assistant-action thumbs-down" title="Bad response" aria-label="Bad response">${actionIcon('thumbsDown')}</button>
    <button type="button" class="assistant-action expand" title="Open response actions" aria-label="Open response actions">${actionIcon('expand')}</button>
  </div>`;
  const copyButton = footer.querySelector('.assistant-action.copy');
  copyButton?.addEventListener('click', async () => {
    const ok = await copyAssistantText(text);
    flashActionIcon(copyButton, ok ? 'check' : 'x', ok ? 'copied' : 'failed');
  });
  footer.querySelector('.assistant-action.thumbs-up')?.addEventListener('click', () => markAssistantFeedback(footer, 'up', text));
  footer.querySelector('.assistant-action.thumbs-down')?.addEventListener('click', () => markAssistantFeedback(footer, 'down', text));
  footer.querySelector('.assistant-action.expand')?.addEventListener('click', () => vscode.postMessage({ type: 'openAssistantResponse', text: String(text || '') }));
  editSummaryController.bindFooter(footer, editSessionId);
  messageEl.appendChild(footer);
  requestAnimationFrame(() => requestAnimationFrame(scrollChatToBottom));
}

function updateEditSessionButtons(editSessionId, undone) {
  editSummaryController.updateButtons(editSessionId, undone);
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function actionIcon(name) {
  if (name === 'copy') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg>';
  if (name === 'thumbsUp') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10"></path><path d="M15 6l-1 4h5.5a2 2 0 0 1 1.9 2.6l-1.7 5.6A2.5 2.5 0 0 1 17.3 20H7"></path><path d="M7 10h3l4-7a2 2 0 0 1 2 2.3L15 10"></path></svg>';
  if (name === 'thumbsDown') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14V4"></path><path d="M15 18l-1-4h5.5a2 2 0 0 0 1.9-2.6l-1.7-5.6A2.5 2.5 0 0 0 17.3 4H7"></path><path d="M7 14h3l4 7a2 2 0 0 0 2-2.3L15 14"></path></svg>';
  if (name === 'check') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
  if (name === 'x') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="M6 6l12 12"></path></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M9 7h8v8"></path><path d="M7 7v10h10"></path></svg>';
}

async function copyAssistantText(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard?.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

function flashActionIcon(button, icon, stateClass) {
  if (!button) return;
  const original = button.innerHTML;
  button.innerHTML = actionIcon(icon);
  button.classList.add('active', stateClass);
  window.setTimeout(() => {
    button.innerHTML = original;
    button.classList.remove('active', 'copied', 'failed');
  }, 1800);
}

function markAssistantFeedback(footer, rating, text) {
  assistantActionsController.markFeedback(footer, rating, text);
}

function renderEditSummaryCard(process = [], editSessionId = '') {
  const edits = summarizeEditedFiles(process);
  if (!edits.length) return '';
  const totals = edits.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  const createdCount = edits.filter(item => item.created).length;
  const editedCount = edits.length - createdCount;
  const summaryLabel = createdCount && editedCount
    ? `Created ${createdCount} and edited ${editedCount} ${editedCount === 1 ? 'file' : 'files'}`
    : createdCount
      ? `Created ${createdCount} ${createdCount === 1 ? 'file' : 'files'}`
      : `Edited ${edits.length} ${edits.length === 1 ? 'file' : 'files'}`;
  const disabled = editSessionId ? '' : ' disabled';
  const rows = edits.map(item => `<button type="button" class="edit-summary-row" data-path="${escapeHtml(item.path)}"${disabled}><span>${escapeHtml(item.path)}</span><b><em class="plus">+${item.added}</em> <em class="minus">-${item.removed}</em></b></button>`).join('');
  return `<div class="edit-summary-card" data-edit-session="${escapeHtml(editSessionId)}">
    <div class="edit-summary-head"><span class="edit-summary-icon">${actionIcon('copy')}</span><div><strong>${escapeHtml(summaryLabel)}</strong><small><em class="plus">+${totals.added}</em> <em class="minus">-${totals.removed}</em></small></div><button type="button" class="edit-summary-link"${disabled}>Undo</button><button type="button" class="edit-summary-review"${disabled}>Review</button></div>
    <div class="edit-summary-list">${rows}</div>
  </div>`;
}

function summarizeEditedFiles(process = []) {
  const byPath = new Map();
  for (const item of Array.isArray(process) ? process : []) {
    const name = String(item?.name || '').toLowerCase();
    if (!['replace_string_in_file', 'replace_range_in_file', 'insert_text_in_file', 'write_file', 'delete_file'].includes(name)) continue;
    const path = String(item.filePath || item.args?.filePath || pathFromText(item.detail) || '').trim();
    if (!path) continue;
    const counts = editLineCounts(name, item.args || {});
    const added = Number(item.added ?? counts.added ?? 0) || 0;
    const removed = Number(item.removed ?? counts.removed ?? (name === 'delete_file' ? 1 : 0)) || 0;
    const created = String(item.writeKind || '').toLowerCase() === 'create';
    const current = byPath.get(path) || { path, added: 0, removed: 0, editIds: [], created };
    current.added += added;
    current.removed += removed;
    current.created = current.created || created;
    if (item.editId) current.editIds.push(item.editId);
    byPath.set(path, current);
  }
  return Array.from(byPath.values());
}

function pathFromText(text = '') {
  const match = String(text || '').match(/(?:src|lib|app|test|tests|media|package|README|tsconfig|vite|webpack)[^\s:,)]*/i);
  return match?.[0] || '';
}

function toolIcon(name) {
  const n = String(name || '').toLowerCase();
  const svg = body => '<svg class="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  if (isTerminalTool(n)) return svg('<path d="M6 8.2 10.2 12 6 15.8"></path><path d="M12 16h6"></path><path d="M17.5 5.5l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z"></path>');
  if (n.includes('grep') || n.includes('search')) return svg('<circle cx="10.5" cy="10.5" r="4.2"></circle><path d="M13.8 13.8 18.5 18.5"></path>');
  if (n.includes('index')) return svg('<rect x="5" y="5" width="5" height="5" rx="1"></rect><rect x="14" y="5" width="5" height="5" rx="1"></rect><rect x="5" y="14" width="5" height="5" rx="1"></rect><rect x="14" y="14" width="5" height="5" rx="1"></rect>');
  if (n.includes('web')) return svg('<circle cx="12" cy="12" r="7"></circle><path d="M5 12h14"></path><path d="M12 5c2 2.1 3 4.4 3 7s-1 4.9-3 7"></path><path d="M12 5c-2 2.1-3 4.4-3 7s1 4.9 3 7"></path>');
  if (n.includes('read')) return svg('<path d="M7 4.8h7l3 3V19H7z"></path><path d="M14 4.8V8h3"></path><path d="M9.2 12.2h5.6"></path><path d="M9.2 15.2h4.2"></path>');
  if (n.includes('replace') || n.includes('insert') || n.includes('write') || n.includes('create') || n.includes('delete') || n.includes('edit')) return svg('<path d="M5.5 18.5l3.7-.8 8.5-8.5a2 2 0 0 0-2.9-2.9L6.3 14.8z"></path><path d="M14.2 6.8l3 3"></path>');
  if (n.includes('error') || n.includes('diagnostic')) return svg('<path d="M12 4.5 20 19H4z"></path><path d="M12 9.5v4"></path><path d="M12 16.8h.01"></path>');
  if (n.includes('dir') || n.includes('list')) return svg('<path d="M6 7h12"></path><path d="M6 12h12"></path><path d="M6 17h12"></path>');
  if (n.includes('compact')) return svg('<rect x="5" y="5" width="14" height="14" rx="3"></rect><path d="M8 12h8"></path>');
  return svg('<path d="M12 5 19 12 12 19 5 12z"></path>');
}

function isTerminalTool(name) {
  const n = String(name || '').toLowerCase();
  return n === 'run_in_terminal' || n.includes('terminal');
}

function toolIconClass(name) {
  const n = String(name || '').toLowerCase();
  const classes = ['tool-icon'];
  if (isTerminalTool(n)) classes.push('terminal-icon');
  if (n.includes('replace') || n.includes('insert') || n.includes('write') || n.includes('create') || n.includes('delete') || n.includes('edit')) classes.push('edit-icon');
  if (n.includes('search') || n.includes('grep')) classes.push('search-icon');
  return classes.join(' ');
}

function sorexIconMarkup(extraClass = '') {
  const className = `sorex-font-icon${extraClass ? ` ${extraClass}` : ''}`;
  return `<span class="${className}" aria-hidden="true">&#xe001;</span>`;
}

function prettyToolName(name) {
  return String(name || 'tool').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function editToolSummary(name, args = {}, phase = 'running', writeKind = '') {
  if (!['replace_string_in_file', 'replace_range_in_file', 'insert_text_in_file', 'write_file'].includes(name)) return '';
  const filePath = String(args.filePath || args.path || '').trim();
  if (!filePath) return '';
  const file = shortPath(filePath);
  const counts = editLineCounts(name, args);
  const plus = counts.added ? ` <span class="edit-plus">+${counts.added}</span>` : '';
  const minus = counts.removed ? ` <span class="edit-minus">-${counts.removed}</span>` : '';
  const createsFile = name === 'write_file' && writeKind === 'create';
  const verb = createsFile ? (phase === 'done' ? 'Created' : 'Creating') : (phase === 'done' ? 'Edited' : 'Editing');
  return `${verb} <span class="edit-file">${fileLinkHtml(filePath, file)}</span>${plus}${minus}`;
}

function writeKindFromTitle(title) {
  const text = String(title || '').replace(/<[^>]*>/g, '').trim().toLowerCase();
  if (text.startsWith('creating ') || text.startsWith('created ')) return 'create';
  return '';
}

function stripHtmlForUi(value) {
  const div = document.createElement('div');
  div.innerHTML = String(value || '');
  return div.textContent || div.innerText || String(value || '').replace(/<[^>]*>/g, '');
}

function finishUiSpeech(id) {
  if (id) vscode.postMessage({ type: 'uiSpeechDone', id });
}

function animateToolMain(main, title, titleIsHtml, id, row) {
  const displayText = titleIsHtml ? stripHtmlForUi(title) : String(title || '');

  main.classList.remove('tool-static-text');
  main.classList.add('tool-active-text', 'sorex-pulse-text');

  main.innerHTML = activeToolLabelHtml(title, titleIsHtml);
  main.dataset.pulseText = displayText || main.textContent || '';
  restartLiveAnimations(row || main);

  if (id) requestAnimationFrame(() => finishUiSpeech(id));
}

function toolDescription(name, args = {}, phase = 'running') {
  const n = String(name || '').toLowerCase();
  const done = phase === 'done';
  const verb = done ? 'Finished' : 'Running';
  const editSummary = editToolSummary(n, args);
  if (editSummary) return editSummary;
  if (n === 'read_file') {
    const filePath = args.filePath || 'file';
    const label = `${shortPath(filePath)}${args.startLine ? `:${args.startLine}-${args.endLine || args.startLine}` : ''}`;
    return `${done ? 'Read' : 'Reading'} ${fileLinkHtml(filePath, label, args.startLine || 0)}`.trim();
  }
  if (n === 'file_search') return `${done ? 'Searched files' : 'Searching files'}${args.query ? ` - ${args.query}` : ''}${args.maxResults ? ` - max ${args.maxResults}` : ''}`.trim();
  if (n === 'grep_search') return `${done ? 'Searched text' : 'Searching text'}${args.query ? ` - ${args.query}` : ''}${args.includePattern ? ` - ${args.includePattern}` : ''}`.trim();
  if (n === 'list_dir') return `${done ? 'Ran' : 'Running'} list_dir${args.path ? ` - ${args.path}` : ''}`.trim();
  if (n === 'delete_file') return `${done ? 'Deleted' : 'Deleting'} ${fileLinkHtml(args.filePath || 'file', shortPath(args.filePath || 'file'))}`.trim();
  if (n === 'create_directory') return `${done ? 'Created folder' : 'Creating folder'}${args.dirPath ? ` - ${args.dirPath}` : ''}`.trim();
  if (n === 'mode_guard') return `${verb} edit-mode guard`;
  if (n === 'git_diff') return `${done ? 'Read diff' : 'Reading diff'}${args.filePath ? ` - ${args.filePath}` : args.staged ? ' - staged' : ''}`.trim();
  if (n === 'get_errors') return done ? 'Checked diagnostics' : 'Checking diagnostics';
  if (n === 'workspace_index_search') return done ? 'Viewed index' : 'Viewing index';
  if (n === 'workspace_index_refresh') return done ? 'Refreshed index' : 'Refreshing index';
  if (n === 'web_search') return `${done ? 'Searched web' : 'Searching web'}${args.query ? ` - ${args.query}` : ''}`.trim();
  if (n === 'web_fetch') return `${done ? 'Fetched page' : 'Fetching page'}${args.url ? ` - ${args.url}` : ''}`.trim();
  if (n === 'run_in_terminal') return `${done ? 'Ran command' : 'Running command'}${args.command ? ` - ${args.command}` : args.goal ? ` - ${args.goal}` : ''}`.trim();
  return `${verb} ${prettyToolName(name)}`;
}

function shortPath(path) {
  const clean = String(path || '').replace(/\\/g, '/');
  return clean.split('/').filter(Boolean).pop() || clean || 'file';
}

function fileLinkHtml(filePath, label = '', line = 0) {
  const path = String(filePath || '').replace(/\\/g, '/').trim();
  const text = String(label || shortPath(path) || 'file');
  if (!path) return escapeHtml(text);
  const lineAttr = Number(line || 0) > 0 ? ` data-open-line="${escapeHtml(String(Number(line || 0)))}"` : '';
  return `<span class="tool-file-link" role="button" tabindex="0" data-open-file="${escapeHtml(path)}"${lineAttr}>${escapeHtml(text)}</span>`;
}

function toolTitleHasHtml(value) {
  return /<(?:span|button)\b[^>]*(?:edit-|tool-file-link|data-open-file)/i.test(String(value || ''));
}

function activeToolLabelHtml(title, titleIsHtml = false) {
  const template = document.createElement('template');
  template.innerHTML = titleIsHtml ? String(title || '') : escapeHtml(String(title || ''));

  const staticSelector = '.tool-file-link, .edit-plus, .edit-minus, .edit-file, [data-open-file], [data-no-shimmer]';

  const processNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (!text) return;
      const frag = document.createDocumentFragment();
      const parts = text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else {
          const span = document.createElement('span');
          span.className = 'tool-shimmer-text';
          span.textContent = part;
          frag.appendChild(span);
        }
      }
      node.replaceWith(frag);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches?.(staticSelector)) {
      node.classList?.add?.('shimmer-static');
      return;
    }

    for (const child of Array.from(node.childNodes)) processNode(child);
  };

  for (const child of Array.from(template.content.childNodes)) processNode(child);
  return template.innerHTML;
}

function countLines(text) {
  const value = String(text ?? '');
  if (!value) return 0;
  return value.replace(/\n$/, '').split(/\r?\n/).length;
}

function editLineCounts(name, args = {}) {
  if (name === 'replace_string_in_file') return { added: countLines(args.newString), removed: countLines(args.oldString) };
  if (name === 'replace_range_in_file') return { added: countLines(args.newText), removed: Math.max(0, Number(args.endLine ?? 0) - Number(args.startLine ?? 0) + 1) || 0 };
  if (name === 'insert_text_in_file') return { added: countLines(args.text), removed: 0 };
  if (name === 'write_file') return { added: countLines(args.content), removed: 0 };
  return { added: 0, removed: 0 };
}

function editProcessMetadata(name, args = {}, writeKind = '') {
  const n = String(name || '').toLowerCase();
  if (!['replace_string_in_file', 'replace_range_in_file', 'insert_text_in_file', 'write_file', 'delete_file'].includes(n)) return {};
  const counts = editLineCounts(n, args);
  return {
    filePath: String(args.filePath || ''),
    writeKind: String(writeKind || ''),
    added: counts.added,
    removed: n === 'delete_file' && counts.removed === 0 ? 1 : counts.removed
  };
}

function restartSorexIconAnimations(root = document) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('.sorex-font-icon').forEach((el) => {
    const host = el.parentElement;
    if (!host) return;
    const isTracked = host.classList.contains('sorex-logo-icon') || host.classList.contains('sorex-thinking-icon') || host.classList.contains('assistant-step-icon');
    if (!isTracked) return;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  });
}

document.fonts?.load?.("1em SorexIcons").then(() => restartSorexIconAnimations(document)).catch(() => {});

function restartLiveAnimations(root = document) {
  prepareLivePulse(root);
  restartSorexIconAnimations(root);
  const progressRoot = root?.classList?.contains?.('running-progress')
    ? root
    : root?.closest?.('.message.progress.running-progress');
  applyActiveDomShimmer(progressRoot || activeProgress?.el || document);
}

function buildShimmerTextNodes(text, offsetStart = 0) {
  const frag = document.createDocumentFragment();
  let offset = offsetStart;
  for (const ch of Array.from(String(text || ''))) {
    const span = document.createElement('span');
    span.className = 'shimmer-char';
    span.textContent = ch === ' ' ? '\u00A0' : ch;
    span.style.setProperty('--shimmer-index', String(offset));
    frag.appendChild(span);
    offset += 1;
  }
  return { frag, nextOffset: offset };
}

function applyDomShimmerToElement(el) {
  if (!el || el.dataset.domShimmer === '1') return;
  const original = el.innerHTML;
  el.dataset.originalHtml = original;
  el.dataset.domShimmer = '1';
  el.classList.add('dom-shimmer-text');
  let offset = 0;

  const shouldPreserveStatic = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(node.matches?.('.shimmer-static, [data-no-shimmer]'));
  };

  const rebuild = (node, parent) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || '';
      if (!value) return;
      const built = buildShimmerTextNodes(value, offset);
      offset = built.nextOffset;
      parent.appendChild(built.frag);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const clone = node.cloneNode(false);

    if (shouldPreserveStatic(node)) {
      clone.innerHTML = node.innerHTML;
      clone.classList?.add?.('shimmer-static');
      parent.appendChild(clone);
      return;
    }

    clone.classList?.add?.('shimmer-preserve');
    parent.appendChild(clone);
    for (const child of Array.from(node.childNodes)) rebuild(child, clone);
  };

  const template = document.createElement('template');
  template.innerHTML = original;
  el.textContent = '';
  for (const child of Array.from(template.content.childNodes)) rebuild(child, el);

  if (!el.childNodes.length) {
    const built = buildShimmerTextNodes(el.dataset.pulseText || el.textContent || '', 0);
    el.appendChild(built.frag);
  }
}

function restoreDomShimmerElement(el) {
  if (!el || el.dataset.domShimmer !== '1') return;
  const original = el.dataset.originalHtml || el.textContent || '';
  el.innerHTML = original;
  delete el.dataset.originalHtml;
  delete el.dataset.domShimmer;
  el.classList.remove('dom-shimmer-text');
}

function applyActiveDomShimmer(root = document) {
  const selector =
    '.message.progress.running-progress .progress-item .tool-main, ' +
    '.message.progress.running-progress .progress-item .tool-detail summary .tool-main, ' +
    '.message.progress.running-progress .progress-item.tool-thinking .tool-main, ' +
    '.message.progress.running-progress .progress-thought .thought-text, ' +
    '.message.progress.running-progress .progress-line.live-text > span.sorex-pulse-text, ' +
    '.message.progress.running-progress .progress-approval .approval-main span:not(.tool-icon)';

  const targets = [];
  if (root?.matches?.(selector)) targets.push(root);
  targets.push(...Array.from(root?.querySelectorAll?.(selector) || []));
  for (const el of targets) applyDomShimmerToElement(el);
}

function placeLiveProgressElement(el) {
  if (finalAssistantTyping && currentFinalAssistantEl && messages.contains(currentFinalAssistantEl)) {
    messages.insertBefore(el, currentFinalAssistantEl);
    return;
  }
  messages.appendChild(el);
}

function progressHeaderClass(label) {
  return /^thinking$/i.test(String(label || '').trim())
    ? 'progress-line live-text initial-ai-thinking-line'
    : 'progress-line live-text';
}

function progressHeaderHtml(label) {
  const text = String(label || 'Thinking').trim() || 'Thinking';
  const isThinking = /^thinking$/i.test(text);
  const icon = isThinking
    ? `<span class="tool-icon sorex-thinking-icon">${sorexIconMarkup()}</span>`
    : '<span class="progress-dot"></span>';
  const pulseClass = isThinking ? ' class="sorex-pulse-text"' : '';
  return `<div class="${progressHeaderClass(text)}">${icon}<span${pulseClass}>${escapeHtml(text)}</span></div>`;
}

function ensureThinkingHeaderIcon(line, label = 'Thinking') {
  if (!line || !/^thinking$/i.test(String(label || '').trim())) return;
  let icon = Array.from(line.children || []).find(child => child.classList?.contains?.('tool-icon') && child.classList?.contains?.('sorex-thinking-icon'));
  if (!icon) {
    icon = document.createElement('span');
    icon.className = 'tool-icon sorex-thinking-icon';
    icon.innerHTML = sorexIconMarkup();
    line.insertBefore(icon, line.firstChild || null);
  }
  if (!icon.querySelector?.('.sorex-font-icon')) {
    icon.innerHTML = sorexIconMarkup();
  }
}

function startProgress(title = '', options = {}) {
  clearProgress();
  activeToolRows.clear();
  setRunning(true);
  activeProcess = [];
  const el = document.createElement('div');
  el.className = 'message progress running-progress';
  const label = String(title || '').trim();
  const hideHeader = Boolean(options.hideHeader) || !label;
  if (hideHeader) {
    el.classList.add('headerless-progress');
    el.innerHTML = '<div class="progress-items"></div>';
  } else {
    el.innerHTML = `${progressHeaderHtml(label)}<div class="progress-items"></div>`;
  }
  placeLiveProgressElement(el);
  scrollChatToBottom();
  activeProgress = { el, items: el.querySelector('.progress-items') };
  if (!hideHeader) ensureThinkingHeaderIcon(el.querySelector(':scope > .progress-line'), label);
  restartLiveAnimations(el);
  updateWelcome();
}

function ensureProgress() {
  if (activeProgress) return activeProgress;
  startProgress('', { hideHeader: true });
  return activeProgress;
}

function progressHasBodyRows() {
  const items = activeProgress?.items;
  if (!items) return false;
  return Array.from(items.children || []).some(child => {
    if (!child || child.classList?.contains?.('hidden-progress-line')) return false;
    return child.matches?.('.progress-item, .progress-thought, .progress-approval, details');
  });
}

function showProgressHeader(title = 'Thinking') {
  const label = String(title || 'Thinking').trim() || 'Thinking';
  const isInitialThinkingHeader = /^thinking$/i.test(label);
  if (isInitialThinkingHeader && activeProgress && progressHasBodyRows()) {
    hideProgressHeader();
    setRunning(true);
    return activeProgress;
  }
  if (!activeProgress) {
    startProgress(label);
    return activeProgress;
  }
  const progressEl = activeProgress.el;
  progressEl.classList.remove('headerless-progress');
  let line = progressEl.querySelector(':scope > .progress-line');
  if (!line) {
    const holder = document.createElement('div');
    holder.innerHTML = progressHeaderHtml(label);
    line = holder.firstElementChild;
    if (line) progressEl.insertBefore(line, activeProgress.items || progressEl.firstChild);
  } else {
    line.className = progressHeaderClass(label);
    const holder = document.createElement('div');
    holder.innerHTML = progressHeaderHtml(label);
    line.innerHTML = holder.firstElementChild ? holder.firstElementChild.innerHTML : '';
  }
  ensureThinkingHeaderIcon(line, label);
  line?.classList.remove('hidden-progress-line');
  restartLiveAnimations(line || progressEl);
  setRunning(true);
  revealInMessages(line || progressEl, { preferTop: false });
  updateWelcome();
  return activeProgress;
}

function hideProgressHeader() {
  const progressEl = activeProgress?.el;
  if (!progressEl) return;
  const line = progressEl.querySelector(':scope > .progress-line');
  progressEl.classList.add('headerless-progress');
  if (!line) return;
  line.classList.add('hidden-progress-line');
  line.remove();
}

function setProgressItemRunning(row, name, title, args = {}, id = '', writeKind = '') {
  if (!row) return;
  const showDetail = shouldShowToolDetail(name, args, '');
  const titleIsHtml = toolTitleHasHtml(title);
  const head = `<span class="${toolIconClass(name)}">${toolIcon(name)}</span><span class="tool-main sorex-pulse-text"></span>`;
  const detailText = toolDetailText(name, args, '');
  row.className = `progress-item${showDetail ? ' has-tool-detail' : ''}`;
  if (writeKind) row.dataset.writeKind = writeKind;
  row.style.pointerEvents = 'none';
  row.innerHTML = showDetail ? `<details class="tool-detail"><summary>${head}</summary><pre>${escapeHtml(detailText)}</pre></details>` : `<div class="tool-line">${head}</div>`;
  const main = row.querySelector('.tool-main');
  if (main) animateToolMain(main, title, titleIsHtml, id, row);
  else if (id) finishUiSpeech(id);
  revealInMessages(row, { preferTop: false });
}

function addProgressItem(name, detail = '', args = {}, result = '', id = '', toolId = '', explicitWriteKind = '', fileExisted = undefined) {
  if (!activeProgress) ensureProgress();
  hideProgressHeader();
  const rawTitle = detail || toolDescription(name, args);
  const writeKind = fileExisted === false ? 'create' : (String(explicitWriteKind || '') || writeKindFromTitle(rawTitle));
  const editSummary = editToolSummary(String(name || '').toLowerCase(), args, 'running', writeKind);
  const title = editSummary || rawTitle;
  activeProcess.push({
    name,
    title: String(rawTitle || '').replace(/<[^>]*>/g, ''),
    detail: result || detail,
    args,
    ...editProcessMetadata(name, args, writeKind)
  });
  const key = String(toolId || '');
  const existing = key ? activeToolRows.get(key) : null;
  if (existing && !existing.isConnected) activeToolRows.delete(key);
  const connectedExisting = key ? activeToolRows.get(key) : null;
  if (connectedExisting) {
    if (!result && connectedExisting.classList.contains('tool-thinking')) {
      setProgressItemRunning(connectedExisting, name, title, args, id, writeKind);
    } else {
      updateProgressItem(connectedExisting, name, title, args, result);
      if (id) window.setTimeout(() => finishUiSpeech(id), 320);
    }
    revealInMessages(connectedExisting, { preferTop: false });
    return;
  }
  const showDetail = shouldShowToolDetail(name, args, result);
  const row = document.createElement(showDetail ? 'details' : 'div');
  row.className = `progress-item${showDetail ? ' has-tool-detail' : ''}`;
  const titleIsHtml = toolTitleHasHtml(title);
  const head = `<span class="${toolIconClass(name)}">${toolIcon(name)}</span><span class="tool-main sorex-pulse-text"></span>`;
  const detailText = toolDetailText(name, args, result);
  row.innerHTML = showDetail ? `<summary>${head}</summary><pre>${escapeHtml(detailText)}</pre>` : `<div class="tool-line">${head}</div>`;
  if (writeKind) row.dataset.writeKind = writeKind;
  if (key) activeToolRows.set(key, row);
  activeProgress.items.appendChild(row);
  row.querySelector('.thought-detail')?.remove();
  row.style.pointerEvents = showDetail && result ? 'auto' : 'none';
  if (showDetail) {
    const details = row.matches('details') ? row : row.querySelector('.tool-detail');
    details?.addEventListener('toggle', () => {
      if (details.open) revealInMessages(details);
    });
  }
  const main = row.querySelector('.tool-main');
  if (main) {
    animateToolMain(main, title, titleIsHtml, id, row);
  } else if (id) {
    finishUiSpeech(id);
  }
  scrollChatToBottom();
}

function addToolThinking(toolId = '', name = '', id = '') {
  if (!activeProgress) ensureProgress();
  hideProgressHeader();
  const key = String(toolId || `thinking-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  if (activeToolRows.has(key)) {
    if (id) finishUiSpeech(id);
    return;
  }
  const row = document.createElement('div');
  const isInitialThinking = !activeProgress.items.querySelector('.assistant-dialog, .progress-item:not(.tool-thinking), .progress-line:not(.live-text)');
  row.className = `progress-item tool-thinking${isInitialThinking ? ' initial-thinking' : ''}`;
  row.innerHTML = `<div class="tool-line"><span class="tool-icon sorex-thinking-icon">${sorexIconMarkup()}</span><span class="tool-main sorex-pulse-text">Thinking</span></div>`;
  activeProgress.items.appendChild(row);
  activeToolRows.set(key, row);
  const main = row.querySelector('.tool-main');
  if (main) main.dataset.pulseText = main.textContent || 'Thinking';
  if (main) {
    main.textContent = 'Thinking';
    main.dataset.pulseText = 'Thinking';
  }
  restartLiveAnimations(row);
  if (id) requestAnimationFrame(() => finishUiSpeech(id));
  revealInMessages(row, { preferTop: false });
}

function revealInMessages(el, options = {}) {
  if (!el || !messages) return;
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    const composerHeight = Math.ceil(composer?.getBoundingClientRect().height || 140);
    const messageRect = (messages && getComputedStyle(messages).overflowY === 'auto') ? messages.getBoundingClientRect() : chatViewportRect();
    const rect = el.getBoundingClientRect();
    const visibleTop = messageRect.top + 10;
    const visibleBottom = messageRect.bottom - composerHeight - 14;
    if (options.preferTop && rect.top < visibleTop) {
      scrollChatBy(Math.floor(rect.top - visibleTop));
      return;
    }
    if (rect.bottom > visibleBottom) {
      scrollChatBy(Math.ceil(rect.bottom - visibleBottom));
      return;
    }
    if (rect.top < visibleTop) {
      scrollChatBy(Math.floor(rect.top - visibleTop));
    }
  });
}

function updateProgressItem(row, name, title, args = {}, result = '') {
  row.classList.add('done');
  row.classList.remove('tool-thinking', 'live-text');
  row.style.pointerEvents = 'auto';
  const writeKind = writeKindFromTitle(title) || row.dataset.writeKind || '';
  const editSummary = editToolSummary(String(name || '').toLowerCase(), args, 'done', writeKind);
  const displayTitle = editSummary || title;
  const titleIsHtml = toolTitleHasHtml(displayTitle);
  const showDetail = shouldShowToolDetail(name, args, result);
  if (showDetail) {
    const detailText = toolDetailText(name, args, result);
    row.classList.add('has-tool-detail');
    const activeLabel = activeProgress?.el?.classList.contains('running-progress');
    const labelHtml = activeLabel ? activeToolLabelHtml(displayTitle, titleIsHtml) : (titleIsHtml ? displayTitle : escapeHtml(displayTitle));
    row.innerHTML = `<details class="tool-detail"><summary><span class="${toolIconClass(name)}">${toolIcon(name)}</span><span class="tool-main${activeLabel ? ' tool-active-text' : ''}">${labelHtml}</span></summary><pre>${escapeHtml(detailText)}</pre></details>`;
    const details = row.querySelector('.tool-detail');
    details?.addEventListener('toggle', () => {
      if (details.open) revealInMessages(details);
    });
    restartLiveAnimations(row);
    revealInMessages(row);
    return;
  }
  const main = row.querySelector('.tool-main');
  const icon = row.querySelector('.tool-icon');
  if (icon) {
    icon.className = toolIconClass(name);
    icon.innerHTML = toolIcon(name);
  }
  if (main) {
    restoreDomShimmerElement(main);
    main.classList.remove('sorex-pulse-text', 'tool-active-text', 'dom-shimmer-text');
    main.classList.add('tool-static-text');
    const activeLabel = activeProgress?.el?.classList.contains('running-progress');
    if (activeLabel) {
      main.classList.remove('tool-static-text');
      main.classList.add('tool-active-text');
      main.innerHTML = activeToolLabelHtml(displayTitle, titleIsHtml);
    } else if (titleIsHtml) {
      main.innerHTML = displayTitle;
    } else {
      main.textContent = displayTitle;
    }
    main.dataset.pulseText = titleIsHtml ? stripHtmlForUi(displayTitle) : String(displayTitle || '');
    restartLiveAnimations(row);
  }
}

function shouldShowToolDetail(name, args = {}, result = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'list_dir' && String(result || '').trim()) return true;
  if (isTerminalTool(n) && terminalCommandDetail(args, result)) return true;
  if (n === 'git_diff') return true;
  if (result && /```|diff|patch|edited|wrote|inserted|replaced/i.test(String(result))) return true;
  if (['replace_string_in_file', 'replace_range_in_file', 'insert_text_in_file', 'write_file'].includes(n)) return true;
  return Boolean(String(result || '').trim()) || (args && typeof args === 'object' && Object.keys(args).length > 0);
}

function normalizeListDirTreeDetail(args = {}, result = '') {
  const raw = String(result || '').trim();
  if (raw) return raw;
  const path = String(args.path || '.').trim() || '.';
  return `${path === '.' ? './' : `${path.replace(/\\/g, '/').replace(/\/+$/g, '')}/`}\n-- (no entries returned)`;
}

function terminalCommandDetail(args = {}, result = '') {
  const monitored = String(result || '').trim();
  if (monitored) return monitored;
  const direct = String(args.command || '').trim();
  if (direct) return `Terminal: SOREX User Terminal (VS Code)\n\nCommand:\n${direct}\n\nMonitoring: waiting for tool result.`;
  const match = monitored.match(/(?:^|\n)Command:\s*([^\n]+)/i);
  const parsed = match ? String(match[1] || '').trim() : '';
  return parsed ? `Command:\n${parsed}` : '';
}

function toolDetailText(name, args = {}, result = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'list_dir') return normalizeListDirTreeDetail(args, result);
  if (n === 'git_diff') return String(result || '').trim() || `Diff request:\n${JSON.stringify(args || {}, null, 2)}`;
  if (isTerminalTool(n)) return terminalCommandDetail(args, result) || String(result || '').trim() || JSON.stringify(args || {}, null, 2);
  if (n === 'replace_string_in_file') return String(args.newString ?? '');
  if (n === 'replace_range_in_file') return String(args.newText ?? '');
  if (n === 'insert_text_in_file') return String(args.text ?? '');
  if (n === 'write_file') return String(args.content ?? '');
  if (result) return String(result);
  const fallback = JSON.stringify(args || {}, null, 2);
  return fallback && fallback !== '{}' ? fallback : 'No additional details returned.';
}

function sanitizeAssistantStepText(text) {
  let clean = String(text || '').trim();
  const cutPatterns = [
    /```(?:sorex_tool|tool_call|tools?)\b/i,
    /<\s*(?:sorex_tool|tool_call|tool)\b/i,
    /(?:^|\n)\s*(?:list_dir|file_search|grep_search|read_file|git_diff|replace_string_in_file|replace_range_in_file|insert_text_in_file|write_file|delete_file|create_directory|get_errors|workspace_index_search|workspace_index_refresh|web_search|web_fetch|run_in_terminal)\s*\(\s*\{/i,
    /(?:^|\n)\s*\{\s*"(?:name|tool|tool_name)"\s*:\s*"(?:list_dir|file_search|grep_search|read_file|git_diff|replace_string_in_file|replace_range_in_file|insert_text_in_file|write_file|delete_file|create_directory|get_errors|workspace_index_search|workspace_index_refresh|web_search|web_fetch|run_in_terminal)"/i
  ];
  for (const pattern of cutPatterns) {
    const match = clean.match(pattern);
    if (match && typeof match.index === 'number') clean = clean.slice(0, match.index).trim();
  }
  return clean.replace(/`{3,}\s*$/g, '').trim();
}

function addThoughtItem(text, id = '') {
  const clean = sanitizeAssistantStepText(text);
  if (!clean) {
    if (id) vscode.postMessage({ type: 'uiSpeechDone', id });
    return;
  }
  if (!activeProgress) ensureProgress();
  hideProgressHeader();
  activeProcess.push({ name: 'assistant_step', title: 'Dialog', detail: clean });
  const row = document.createElement('details');
  row.className = 'progress-thought assistant-dialog';
  row.dataset.open = 'false';
  row.innerHTML = `<summary><span class="thought-text"></span></summary><div class="thought-detail">${escapeHtml(clean)}</div>`;
  activeProgress.items.appendChild(row);
  row.addEventListener('click', () => {
    row.dataset.open = row.dataset.open === 'true' ? 'false' : 'true';
  });
  requestAnimationFrame(() => row.classList.add('shown'));
  const liveThought = row.querySelector('.thought-text');
  if (liveThought) {
    forceSolidAssistantDialogText(liveThought);
    animatePlainWordFade(liveThought, clean, () => {
      forceSolidAssistantDialogText(liveThought);
      if (id) vscode.postMessage({ type: 'uiSpeechDone', id });
    });
    revealInMessages(row, { preferTop: false });
    return;
  }
  window.setTimeout(() => {
    if (id) vscode.postMessage({ type: 'uiSpeechDone', id });
  }, Math.min(900, Math.max(220, clean.length * 12)));
  scrollChatToBottom();
  return;
  if (!activeProgress) startProgress('Reasoning');
  activeProcess.push({ name: 'assistant_step', title: 'Reasoning', detail: clean });
  const legacyRow = document.createElement('div');
  legacyRow.className = 'progress-thought live-text';
  row.innerHTML = `<span class="tool-icon sorex-thinking-icon">${sorexIconMarkup()}</span><span class="thought-text sorex-pulse-text"></span>`;
  activeProgress.items.appendChild(legacyRow);
  const thought = legacyRow.querySelector('.thought-text');
  if (thought) {
    animatePlainText(thought, clean, () => {
      if (id) vscode.postMessage({ type: 'uiSpeechDone', id });
    });
  } else if (id) {
    vscode.postMessage({ type: 'uiSpeechDone', id });
  }
  restartLiveAnimations(legacyRow);
  scrollChatToBottom();
}

function resetCompactUiBurst() {
  if (compactUiBurstFinishTimer) {
    clearTimeout(compactUiBurstFinishTimer);
    compactUiBurstFinishTimer = 0;
  }
  compactUiActive = false;
  compactQueuedMessages = [];
  manualCompactActive = false;
  compactUiBurstRow = null;
  compactUiBurstUpdatedAt = 0;
  compactUiBurstGeneration++;
}

function setCompactRowLabel(row, label) {
  if (!row) return;
  if (row.classList.contains('progress-compact')) {
    const labelEl = row.querySelector('b');
    if (labelEl) {
      labelEl.textContent = label;
      labelEl.dataset.pulseText = label;
    }
  } else {
    const labelEl = row.querySelector('b');
    if (labelEl) {
      labelEl.textContent = label;
      labelEl.dataset.pulseText = label;
    } else {
      row.innerHTML = `<b data-pulse-text="${escapeHtml(label)}">${escapeHtml(label)}</b>`;
    }
  }
}

function ackUiAfterPaint(id = '', afterAck = null) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (id) vscode.postMessage({ type: 'uiSpeechDone', id });
      if (typeof afterAck === 'function') afterAck();
    });
  });
}

function queueDuringCompact(data) {
  const type = data?.type || '';
  return compactUiActive && [
    'thinking',
    'assistantStep',
    'toolThinking',
    'toolStart',
    'tool',
    'assistantAnimated'
  ].includes(type);
}

function flushCompactQueuedMessages() {
  const queued = compactQueuedMessages.splice(0);
  for (const item of queued) {
    window.dispatchEvent(new MessageEvent('message', { data: item }));
  }
}

function cancelPendingCompactFinish() {
  if (!compactUiBurstFinishTimer) return;
  clearTimeout(compactUiBurstFinishTimer);
  compactUiBurstFinishTimer = 0;
}

function reusableCompactRow() {
  const row = compactUiBurstRow;
  if (!row || !messages.contains(row)) return null;
  const recent = Date.now() - compactUiBurstUpdatedAt < COMPACT_UI_MERGE_MS;
  if (row.classList.contains('compacting')) return row;
  if (!isRunning && recent) return row;
  return null;
}

function registerCompactRow(key, row) {
  compactLines.set(key, row);
  activeCompactLine = row;
  compactUiBurstRow = row;
  compactUiBurstUpdatedAt = Date.now();
}

function addCompactItem(id = '', text = 'Compacting Conversation') {
  const key = id || `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const label = String(text || 'Compacting Conversation');
  compactUiActive = true;
  cancelPendingCompactFinish();
  hideProgressHeader();
  const existing = reusableCompactRow();
  if (existing) {
    existing.classList.add('compacting');
    existing.classList.remove('done');
    setCompactRowLabel(existing, label);
    registerCompactRow(key, existing);
    return existing;
  }

  if (activeProgress?.items && !activeProgress.el.classList.contains('sealed')) {
    const row = document.createElement('div');
    row.className = 'progress-compact compacting';
    row.innerHTML = `<span></span><b data-pulse-text="${escapeHtml(label)}">${escapeHtml(label)}</b><span></span>`;
    activeProgress.items.appendChild(row);
    if (!activeProcess.some(item => String(item.name || '').toLowerCase().includes('compact'))) {
      activeProcess.push({ name: 'compact', title: label, detail: 'Compacting older context into continuation memory' });
    }
    registerCompactRow(key, row);
    scrollChatToBottom();
    return row;
  }

  const row = document.createElement('div');
  row.className = 'compact-line compacting';
  row.innerHTML = `<b data-pulse-text="${escapeHtml(label)}">${escapeHtml(label)}</b>`;
  if (finalAssistantTyping && currentFinalAssistantEl && messages.contains(currentFinalAssistantEl)) {
    messages.insertBefore(row, currentFinalAssistantEl);
  } else {
    messages.appendChild(row);
  }
  registerCompactRow(key, row);
  scrollChatToBottom();
  updateWelcome();
  return row;
}

function finishCompactItem(id = '', text = 'Conversation Compacted', ackId = '', context = null) {
  const key = id || '';
  const row = key ? compactLines.get(key) : activeCompactLine;
  if (!row || !messages.contains(row)) {
    ackUiAfterPaint(ackId);
    return;
  }
  const label = String(text || 'Conversation Compacted');
  const applyDone = () => {
    compactUiBurstFinishTimer = 0;
    if (!row || !messages.contains(row)) {
      ackUiAfterPaint(ackId);
      return;
    }
    if (context) {
      setContextPercent(
        context.percent,
        context.approx,
        context.max,
        context.available,
        context.compactAt,
        { ...context, compacted: true, forceInstant: true }
      );
    }
    setCompactRowLabel(row, label);
    row.classList.remove('compacting');
    row.classList.add('done');
    compactUiActive = false;
    compactUiBurstRow = row;
    compactUiBurstUpdatedAt = Date.now();
    scrollChatToBottom();
    if (manualCompactActive) {
      manualCompactActive = false;
      setRunning(false);
    }
    ackUiAfterPaint(ackId, flushCompactQueuedMessages);
  };
  if (key) compactLines.delete(key);
  if (activeCompactLine === row) activeCompactLine = null;
  cancelPendingCompactFinish();
  applyDone();
}



function addApprovalItem(id, name, title, args = {}) {
  if (!activeProgress) startProgress('', { hideHeader: true });
  const row = document.createElement('div');
  row.className = 'progress-approval';
  row.innerHTML = `<div class="approval-main"><span class="${toolIconClass(name)}">${toolIcon(name)}</span><span class="tool-static-text">${escapeHtml(title || toolDescription(name, args))}</span></div><div class="approval-actions"><button class="allow" title="Allow this tool">Allow</button><button class="block" title="Block this tool">Block</button></div><pre>${escapeHtml(JSON.stringify(args || {}, null, 2))}</pre>`;
  row.querySelector('.allow').addEventListener('click', () => { row.classList.add('resolved'); row.querySelector('.approval-actions').textContent = 'Allowed'; vscode.postMessage({ type: 'approveTool', id }); });
  row.querySelector('.block').addEventListener('click', () => { row.classList.add('resolved'); row.querySelector('.approval-actions').textContent = 'Blocked'; vscode.postMessage({ type: 'rejectTool', id }); });
  activeProgress.items.appendChild(row);
  restartLiveAnimations(row);
  scrollChatToBottom();
}

function clearProgress(keepRunning = false) {
  if (activeProgress?.el) activeProgress.el.remove();
  activeProgress = null;
  activeToolRows.clear();
  if (!keepRunning) {
    compactUiActive = false;
    compactQueuedMessages = [];
  }
  if (!keepRunning) setRunning(false);
}

function progressLabelForMode() {
  if (currentMode === 'ask') return 'Analyzing';
  if (currentMode === 'plan') return 'Planning';
  if (currentMode === 'explore') return 'Exploring';
  if (currentMode === 'edit') return 'Preparing edits';
  return 'Thinking';
}

function submit() {
  const text = input.value.trim();
  const command = text.toLowerCase();
  if (command === '/compact') {
    input.value = '';
    autosizeComposerInput();
    closeHistory();
    manualCompactActive = true;
    setRunning(true);
    showProgressHeader('');
    vscode.postMessage({ type: 'compact' });
    return;
  }

  if (isRunning) {
    if (!text) {
      stopRun();
      return;
    }
    changeTopic(text);
    return;
  }
  if (!text) return;

  resetCompactUiBurst();
  append('user', text);
  transcript.push({ role: 'user', text, at: Date.now() });
  saveCurrentSession();
  showProgressHeader('Thinking');
  vscode.postMessage({ type: 'send', text, sessionId: activeSessionId });
  input.value = '';
  autosizeComposerInput();
}

function changeTopic(text) {
  const nextText = String(text || '').trim();
  if (!nextText) return;
  for (const animation of Array.from(activeTextAnimations)) animation?.cancel?.();
  if (activeTextAnimation?.cancel) activeTextAnimation.cancel();
  finalAssistantTyping = false;
  ignoreNextStopped = true;
  vscode.postMessage({ type: 'stop' });
  clearProgress(true);
  setRunning(true);
  resetCompactUiBurst();
  append('user', nextText);
  transcript.push({ role: 'user', text: nextText, at: Date.now() });
  saveCurrentSession();
  showProgressHeader('Thinking');
  vscode.postMessage({ type: 'send', text: nextText, sessionId: activeSessionId, interrupt: true });
  input.value = '';
  autosizeComposerInput();
}

function saveCurrentSession() {
  const title = transcript.find(m => m.role === 'user')?.text?.slice(0, 80) || 'New chat';
  const existing = sessions.findIndex(s => s.id === activeSessionId);
  const session = { id: activeSessionId, title, updatedAt: Date.now(), transcript, archived: false };
  if (existing >= 0) sessions[existing] = session;
  else sessions.unshift(session);
  sessions = sessions.slice(0, 30);
  saveSessions();
  renderHistory();
}

function removeStoredSession(id) {
  const key = String(id || '');
  if (!key) return;
  sessions = sessions.filter(s => s.id !== key);
  archivedSessions = archivedSessions.filter(s => s.id !== key);
  saveSessions();
}

function renderHistory() {
  historyController.render(
    { tab: historyTab, sessions, archivedSessions },
    {
      load: (id, fromArchive) => loadSession(id, fromArchive),
      archive: (id, fromArchive) => animateHistoryAction(id, fromArchive ? 'restore' : 'archive', () => toggleArchive(id, fromArchive)),
      delete: (id, fromArchive) => animateHistoryAction(id, 'delete', () => deleteSession(id, fromArchive))
    }
  );
}

function setHistoryOpen(open) {
  historyController.setOpen(open, { getChatScroller, syncLayout: syncHistoryPanelLayout });
}

function closeHistory() {
  setHistoryOpen(false);
}

function animateHistoryAction(id, action, commit) {
  historyController.animateAction(id, action, commit);
}

function toggleArchive(id, fromArchive = false) {
  if (fromArchive) {
    const idx = archivedSessions.findIndex(x => x.id === id);
    if (idx >= 0) sessions.unshift(archivedSessions.splice(idx, 1)[0]);
  } else {
    const idx = sessions.findIndex(x => x.id === id);
    if (idx >= 0) archivedSessions.unshift(sessions.splice(idx, 1)[0]);
  }
  saveSessions();
  renderHistory();
}

function resetToFreshChat(keepHistoryOpen = false) {
  activeSessionId = randomId();
  transcript = [];
  messages.textContent = '';
  activeProcess = [];
  compactLines.clear();
  resetCompactUiBurst();
  activeToolRows.clear();
  activeCompactLine = null;
  currentFinalAssistantEl = null;
  clearProgress();
  vscode.postMessage({ type: 'newSession', sessionId: activeSessionId });
  setContextPercent(0);
  updateWelcome();
  if (!keepHistoryOpen) closeHistory();
}

function deleteSession(id, fromArchive = false) {
  const key = String(id || '');
  if (fromArchive) archivedSessions = archivedSessions.filter(x => x.id !== key);
  else sessions = sessions.filter(x => x.id !== key);
  saveSessions();
  if (key && key === String(activeSessionId || '')) {
    resetToFreshChat(true);
  }
  renderHistory();
}

function loadSession(id, fromArchive = false) {
  const s = (fromArchive ? archivedSessions : sessions).find(x => x.id === id);
  if (!s) return;
  activeSessionId = s.id;
  transcript = Array.isArray(s.transcript) ? s.transcript : [];
  messages.textContent = '';
  for (const m of transcript) append(m.role === 'assistant' ? 'assistant' : 'user', m.text, false, m.process || []);
  closeHistory();
  vscode.postMessage({ type: 'restoreVisible', transcript, sessionId: activeSessionId });
  updateWelcome();
}

function newChat() {
  resetToFreshChat(false);
}

function shortModelName(id) {
  if (!id) return 'Select model';
  if (currentProviderMode === 'openrouter') return compactOpenRouterModelName(id);
  const name = String(id).split('/').pop();
  return name;
}

function compactOpenRouterModelName(id) {
  const value = String(id || '').trim();
  const parts = value.split('/');
  if (parts.length < 2) return value;
  const provider = parts.shift();
  const model = parts.join('/');
  return `${provider}/${model}`;
}

function updateModelButtonMetadata() {
  if (!modelButton || !modelName) return;
  const full = currentModel || 'Select model';
  const label = currentProviderMode === 'openrouter' && currentModel
    ? `OpenRouter model: ${full}`
    : `Model: ${full}`;
  modelButton.title = label;
  modelButton.setAttribute('aria-label', label);
  modelName.title = full;
}

function updateModelButtonWidth() {
  if (!modelButton || !modelName) return;
  const label = modelName.textContent || 'Select model';
  const ch = Math.max(8, Math.min(42, label.length + 4));
  modelButton.style.setProperty('--model-button-ch', `${ch}ch`);
  modelButton.style.setProperty('--model-button-max-ch', `${Math.max(10, Math.min(48, label.length + 5))}ch`);
  updateModelButtonMetadata();
}

function providerLabel(model) {
  const p = String(model.provider || 'local');
  if (p === 'local') return 'Local';
  return p;
}

function providerModeLabel(mode) {
  return modelPickerController.providerModeLabel(mode);
}

function isCloudProvider(mode) {
  return modelPickerController.isCloudProvider(mode);
}

function cloudModelListForProvider(provider) {
  const models = cloudModelsByProvider?.[provider] || [];
  return Array.isArray(models) ? models : [];
}

function selectModel(modelId, provider = currentProviderMode) {
  currentModel = modelId;
  currentProviderMode = provider || currentProviderMode;
  modelName.textContent = shortModelName(modelId);
  updateModelButtonWidth();
  closeMenus();
  vscode.postMessage({ type: 'selectModel', model: modelId, providerMode: provider });
}

function renderCloudSection() {
  if (cloudProviderSection) cloudProviderSection.classList.add('hidden');
  if (cloudModels) cloudModels.textContent = '';
  if (cloudModelsToggle) {
    cloudModelsToggle.classList.add('hidden');
    cloudModelsToggle.setAttribute('aria-hidden', 'true');
    cloudModelsToggle.removeAttribute('aria-expanded');
  }
}

function cloudModelRows(query) {
  const provider = String(currentProviderMode || '').toLowerCase();
  if (!isCloudProvider(provider)) return [];
  if (!cloudApiKeysByProvider?.[provider]) return [];
  const id = String(currentModel || '').trim();
  if (!id) return [];

  const q = String(query || '').toLowerCase().trim();
  const label = providerModeLabel(provider);
  if (q && !id.toLowerCase().includes(q) && !label.toLowerCase().includes(q)) return [];
  return [{ id, name: id, provider, providerLabel: label, kind: 'Cloud' }];
}

function renderLocalModels(models) {
  allLocalModels = Array.isArray(models) ? models : [];
  const q = (modelSearch?.value || '').toLowerCase().trim();
  localModels.textContent = '';

  const localRows = allLocalModels
    .filter(m => !q || String(`${m.name || ''} ${m.id || ''}`).toLowerCase().includes(q))
    .map(m => ({ id: m.id, name: m.name || m.id, provider: 'lmstudio', providerLabel: 'Local', kind: 'Local' }));
  const cloudRows = cloudModelRows(q);
  const rows = [...localRows, ...cloudRows];

  if (!rows.length) {
    const row = document.createElement('button');
    row.className = 'model-row muted';
    row.textContent = allLocalModels.length || cloudModelRows('').length ? 'No matches' : 'No models detected';
    localModels.appendChild(row);
  } else {
    for (const model of rows) {
      const row = document.createElement('button');
      row.className = `model-row ${model.id === currentModel ? 'active' : ''}`;
      row.innerHTML = `<span class="check">${model.id === currentModel ? '&check;' : ''}</span><b>${escapeHtml(shortModelName(model.name || model.id))}</b><span>${escapeHtml(model.kind === 'Local' ? 'Local' : `Cloud - ${model.providerLabel}`)}</span>`;
      row.title = model.id;
      row.addEventListener('click', () => selectModel(model.id, model.provider));
      localModels.appendChild(row);
    }
  }

  renderCloudSection();
  const manageRow = document.createElement('button');
  manageRow.className = 'model-row model-row-action';
  manageRow.innerHTML = `<span class="check">...</span><b>Manage Models</b><span>Settings</span>`;
  manageRow.addEventListener('click', () => { closeMenus(); settingsEntryController.openSettings(); });
  localModels.appendChild(manageRow);

  if (menuIsOpen(modelMenu)) requestAnimationFrame(() => positionMenu(modelMenu, modelButton, 246));
}
function updateModeUi(mode) {
  currentMode = mode || 'agent';
  modeName.textContent = currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
  if (modeIcon) modeIcon.textContent = modeIcons[currentMode] || '\u25C6';
  document.querySelectorAll('.mode-row').forEach(row => row.classList.toggle('active', row.dataset.mode === currentMode));
}

function setMode(mode) {
  updateModeUi(mode);
  closeMenus();
  vscode.postMessage({ type: 'setMode', mode });
}


function setMenuButtonState(menu, isOpen) {
  const map = new Map([[modelMenu, modelButton], [modeMenu, modeButton], [permissionMenu, permissionButton]]);
  const button = map.get(menu);
  if (button) button.classList.toggle('menu-open', Boolean(isOpen));
}

function menuList() {
  return menusController.list();
}

function menuAnchorList() {
  return menusController.anchors();
}

function menuIsOpen(menu) {
  return Boolean(menu && !menu.classList.contains('hidden'));
}

function anyMenuOpen() {
  return menuList().some(menuIsOpen);
}

function ensureMenuPortal() {
  if (menuBackdrop && menuBackdrop.parentElement !== document.body) {
    document.body.appendChild(menuBackdrop);
  }
  for (const menu of menuList()) {
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
  }
}

function eventHitsMenuOrAnchor(ev) {
  const elements = [...menuList(), ...menuAnchorList()].filter(Boolean);
  const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
  if (path.length) return elements.some(el => path.includes(el));

  const target = ev.target;
  if (!(target instanceof Node)) return false;
  return elements.some(el => el.contains(target));
}

function syncMenuBackdrop() {
  ensureMenuPortal();
  const open = anyMenuOpen();

  if (menuBackdrop) {
    menuBackdrop.classList.toggle('hidden', !open);
    menuBackdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    menuBackdrop.style.position = 'fixed';
    menuBackdrop.style.inset = '0';
    menuBackdrop.style.zIndex = '2147483645';
    menuBackdrop.style.background = 'transparent';
    menuBackdrop.style.display = open ? 'block' : 'none';
    menuBackdrop.style.pointerEvents = 'none';
  }

  for (const menu of menuList()) setMenuButtonState(menu, menuIsOpen(menu));
}

function syncHistoryPanelLayout() {
  const rect = composer?.getBoundingClientRect();
  const bottomOffset = rect ? Math.max(0, Math.ceil(window.innerHeight - rect.top)) : 128;
  document.documentElement.style.setProperty('--composer-height', `${Math.ceil(rect?.height || 128)}px`);
  document.documentElement.style.setProperty('--composer-top-gap', `${bottomOffset}px`);
  historyPanel?.style.setProperty('--history-bottom-offset', `${Math.max(0, bottomOffset - 1)}px`);
}

function autosizeComposerInput() {
  if (!input) return;
  const style = getComputedStyle(input);
  const lineHeight = Number.parseFloat(style.lineHeight) || 22;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const verticalPadding = paddingTop + paddingBottom;
  const minHeight = Math.ceil((lineHeight * 1.65) + verticalPadding);
  const maxHeight = Math.min(Math.ceil(window.innerHeight * 0.42), Math.ceil((lineHeight * 10) + verticalPadding));

  input.style.setProperty('height', 'auto', 'important');
  const wanted = Math.max(minHeight, Math.ceil(input.scrollHeight));
  const nextHeight = Math.min(wanted, maxHeight);
  input.style.setProperty('height', `${nextHeight}px`, 'important');
  input.style.setProperty('min-height', `${minHeight}px`, 'important');
  input.style.setProperty('max-height', `${maxHeight}px`, 'important');
  input.style.setProperty('overflow-y', wanted > maxHeight + 1 ? 'auto' : 'hidden', 'important');
  composer?.style.setProperty('--composer-input-height', `${nextHeight}px`);
  syncHistoryPanelLayout();
}

function closeMenus() {
  for (const menu of menuList()) {
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    menu.style.setProperty('display', 'none', 'important');
    menu.style.setProperty('pointer-events', 'none', 'important');
    menu.style.removeProperty('visibility');
  }
  syncMenuBackdrop();
}

function measureOpenMenu(menu, width) {
  ensureMenuPortal();
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
  menu.style.setProperty('display', 'block', 'important');
  menu.style.setProperty('width', `${Math.round(width)}px`, 'important');
  menu.style.setProperty('max-width', `${Math.round(width)}px`, 'important');
  menu.style.setProperty('height', 'auto', 'important');
  menu.style.setProperty('max-height', 'none', 'important');
  menu.style.setProperty('overflow-y', 'hidden', 'important');
  menu.style.setProperty('overflow-x', 'hidden', 'important');
  menu.style.setProperty('visibility', 'hidden', 'important');
  menu.style.setProperty('pointer-events', 'none', 'important');
  return Math.max(48, Math.ceil(menu.scrollHeight || menu.getBoundingClientRect().height || 120));
}

function positionMenu(menu, anchor, preferredWidth = 180) {
  ensureMenuPortal();

  const rect = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const margin = 6;
  const gap = 4;
  const minWidth = menu === modelMenu ? 214 : 178;
  const width = Math.min(preferredWidth, Math.max(minWidth, vw - margin * 2));

  const naturalHeight = measureOpenMenu(menu, width);
  const above = Math.max(0, rect.top - margin - gap);
  const below = Math.max(0, vh - rect.bottom - margin - gap);
  const preferAbove = above >= Math.min(naturalHeight, 120) || above >= below;
  const available = Math.max(64, preferAbove ? above : below);
  const maxHeight = Math.min(naturalHeight, available);
  const needsScroll = naturalHeight > maxHeight + 1;

  let top = preferAbove ? rect.top - maxHeight - gap : rect.bottom + gap;
  top = Math.max(margin, Math.min(top, vh - maxHeight - margin));

  let left = rect.right - width;
  left = Math.max(margin, Math.min(left, vw - width - margin));

  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
  menu.style.setProperty('position', 'fixed', 'important');
  menu.style.setProperty('left', `${Math.round(left)}px`, 'important');
  menu.style.setProperty('top', `${Math.round(top)}px`, 'important');
  menu.style.setProperty('right', 'auto', 'important');
  menu.style.setProperty('bottom', 'auto', 'important');
  menu.style.setProperty('width', `${Math.round(width)}px`, 'important');
  menu.style.setProperty('max-width', `${Math.round(width)}px`, 'important');
  menu.style.setProperty('height', 'auto', 'important');
  menu.style.setProperty('max-height', `${Math.round(maxHeight)}px`, 'important');
  menu.style.setProperty('overflow-y', needsScroll ? 'auto' : 'hidden', 'important');
  menu.style.setProperty('overflow-x', 'hidden', 'important');
  menu.style.setProperty('transform', 'none', 'important');
  menu.style.setProperty('display', 'block', 'important');
  menu.style.setProperty('visibility', 'visible', 'important');
  menu.style.setProperty('pointer-events', 'auto', 'important');
  menu.style.setProperty('z-index', '2147483647', 'important');

  syncMenuBackdrop();
}

function toggleMenu(menu, anchor, width) {
  const willOpen = !menuIsOpen(menu);
  closeMenus();
  closeHistory();
  if (willOpen) {
    positionMenu(menu, anchor, width);
    if (menu === modelMenu) {
      vscode.postMessage({ type: 'getModels' });
      requestAnimationFrame(() => modelSearch?.focus({ preventScroll: true }));
    }
  }
  syncMenuBackdrop();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function modelOrbitDurationFor(modelId) {
  const name = String(modelId || '').toLowerCase();
  if (!name) return 2.25;
  if (/\b(1\.5b|3b|4b|mini|small|flash|haiku)\b/.test(name)) return 1.35;
  if (/\b(7b|8b|9b)\b/.test(name)) return 1.65;
  if (/\b(13b|14b|15b)\b/.test(name)) return 2.05;
  if (/\b(20b|22b|24b|30b|32b|34b)\b/.test(name)) return 2.65;
  if (/\b(70b|72b|90b|110b|120b)\b/.test(name)) return 3.6;
  if (/gpt|claude|gemini|openai|anthropic|google|openrouter/.test(name)) return 1.55;
  return 2.25;
}

function applyComposerOrbitSpeed(durationSeconds) {
  const duration = clamp(Number(durationSeconds) || 2.25, 1.05, 4.4);
  composerController.setOrbitDuration(duration);
}

function applyLiveTextPulseSpeed() {
  const tps = activeTokensPerSecond();
  const duration = clamp(5.4 - Math.log2(tps + 1) * 0.62, 1.55, 5.0);
  document.documentElement.style.setProperty('--sorex-text-pulse-duration', `${duration.toFixed(2)}s`);
}

function updateComposerOrbitSpeedFromModel() {
  const orbitDuration = modelOrbitDurationFor(currentModel);
  applyComposerOrbitSpeed(orbitDuration);
  applyLiveTextPulseSpeed();
}

function updateComposerOrbitSpeedFromRuntime(tokensPerSecond) {
  const tps = Math.max(0.1, Number(tokensPerSecond) || 0);
  lastRuntimeTokensPerSecond = tps;
  const orbitDuration = clamp(4.1 - Math.log2(tps + 1) * 0.72, 1.05, 4.25);
  applyComposerOrbitSpeed(orbitDuration);
  applyLiveTextPulseSpeed();
}

function setRunning(next) {
  isRunning = Boolean(next);
  if (isRunning && !lastRuntimeTokensPerSecond) updateComposerOrbitSpeedFromModel();
  composerController.setRunningVisual(isRunning);
}

function stopRun() {
  if (!isRunning) return;
  const hadFinalTyping = finalAssistantTyping;
  for (const animation of Array.from(activeTextAnimations)) animation?.cancel?.();
  if (activeTextAnimation?.cancel) activeTextAnimation.cancel();
  finalAssistantTyping = false;
  vscode.postMessage({ type: 'stop' });
  clearProgress();
  setRunning(false);
  if (!hadFinalTyping) append('status', 'Stopped.');
}

function uiConversationIsEmpty() {
  return transcript.length === 0 && (!messages || messages.children.length === 0);
}

function incomingContextHasRealUsage(data = {}) {
  return Number(data.requestApprox || data.approx || data.percent || 0) > 0;
}

function setContextPercent(pct, approx = 0, max = 0, available = undefined, compactAt = 62, details = {}) {
  contextRingController.setPercent(pct, approx, max, available, compactAt, details);
}

send.addEventListener('click', submit);
input.addEventListener('input', autosizeComposerInput);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
});

settings.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
indexButton?.addEventListener('click', () => vscode.postMessage({ type: 'openIndexingSettings' }));
refreshModels?.addEventListener('click', () => vscode.postMessage({ type: 'getModels' }));
historyTop.addEventListener('click', () => { renderHistory(); closeMenus(); setHistoryOpen(historyPanel.classList.contains('hidden')); });
historyActiveTab?.addEventListener('click', () => { historyTab = 'active'; historyActiveTab.classList.add('active'); historyArchiveTab.classList.remove('active'); renderHistory(); });
historyArchiveTab?.addEventListener('click', () => { historyTab = 'archive'; historyArchiveTab.classList.add('active'); historyActiveTab.classList.remove('active'); renderHistory(); });
newChatTop.addEventListener('click', newChat);
newChatHistory?.addEventListener('click', newChat);
modelSearch?.addEventListener('input', () => { renderLocalModels(allLocalModels); requestAnimationFrame(() => positionMenu(modelMenu, modelButton, 246)); });
cloudModelsToggle?.addEventListener('click', () => { closeMenus(); vscode.postMessage({ type: 'openSettings' }); });

modelButton.addEventListener('click', (ev) => {
  ev.stopPropagation();
  toggleMenu(modelMenu, modelButton, 246);
});
modeButton.addEventListener('click', (ev) => {
  ev.stopPropagation();
  toggleMenu(modeMenu, modeButton, 204);
});
permissionButton.addEventListener('click', (ev) => {
  ev.stopPropagation();
  toggleMenu(permissionMenu, permissionButton, 214);
});
document.querySelectorAll('.permission-row').forEach(row => row.addEventListener('click', () => {
  permissionMode = row.dataset.permission || 'ask';
  permissionName.textContent = row.querySelector('b')?.textContent || 'Ask';
  const icon = permissionButton.querySelector('.button-icon');
  if (icon) icon.textContent = permissionIcons[permissionMode] || '\u270B';
  document.querySelectorAll('.permission-row').forEach(r => r.classList.toggle('active', r.dataset.permission === permissionMode));
  closeMenus();
  vscode.postMessage({ type: 'setPermissionMode', mode: permissionMode });
}));
document.querySelectorAll('.mode-row').forEach(row => row.addEventListener('click', () => setMode(row.dataset.mode)));;

window.addEventListener('resize', () => { closeMenus(); syncHistoryPanelLayout(); });
window.addEventListener('blur', () => closeMenus());
document.addEventListener('visibilitychange', () => { if (document.hidden) closeMenus(); });

function closeMenusFromOutsideEvent(ev) {
  if (!anyMenuOpen()) return;
  if (eventHitsMenuOrAnchor(ev)) return;
  closeMenus();
}

for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'contextmenu']) {
  document.addEventListener(type, closeMenusFromOutsideEvent, true);
  window.addEventListener(type, closeMenusFromOutsideEvent, true);
}

document.addEventListener('focusin', (ev) => {
  if (!anyMenuOpen()) return;
  if (!eventHitsMenuOrAnchor(ev)) closeMenus();
}, true);

window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenus(); }, true);

if (menuBackdrop) {
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
    menuBackdrop.addEventListener(type, closeMenusFromOutsideEvent, true);
  }
}

window.addEventListener('focusout', () => setTimeout(() => {
  if (!document.hasFocus()) closeMenus();
}, 0));
requestAnimationFrame(autosizeComposerInput);

syncMenuBackdrop();

function openToolFileFromElement(el) {
  if (!el) return;
  const filePath = el.getAttribute('data-open-file') || '';
  if (!filePath) return;
  const line = Number(el.getAttribute('data-open-line') || '0') || 0;
  vscode.postMessage({ type: 'openFile', path: filePath, line });
}

document.addEventListener('click', (ev) => {
  const target = ev.target?.closest?.('[data-open-file]');
  if (!target) return;
  ev.preventDefault();
  ev.stopPropagation();
  openToolFileFromElement(target);
}, true);

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const target = ev.target?.closest?.('[data-open-file]');
  if (!target) return;
  ev.preventDefault();
  ev.stopPropagation();
  openToolFileFromElement(target);
}, true);


window.addEventListener('message', event => {
  const data = event.data || {};
  const { type, text, models, model } = data;
  if (queueDuringCompact(data)) {
    compactQueuedMessages.push(data);
    return;
  }
  if (type === 'clear') {
    messages.textContent = '';
    removeStoredSession(activeSessionId);
    activeSessionId = randomId();
    transcript = [];
    clearProgress();
    setRunning(false);
    activeProcess = [];
    activeCompactLine = null;
    compactLines.clear();
    currentFinalAssistantEl = null;
    closeHistory();
    setContextPercent(0);
    updateWelcome();
    return;
  }
  if (type === 'models') {
    currentModel = model || '';
    currentProviderMode = data.providerMode || 'lmstudio';
    cloudModelsByProvider = data.cloudModels || cloudModelsByProvider;
    cloudApiKeysByProvider = data.cloudApiKeys || cloudApiKeysByProvider;
    cloudModelsExpanded = false;
    modelName.textContent = shortModelName(currentModel);
    updateModelButtonWidth();
    updateComposerOrbitSpeedFromModel();
    renderLocalModels(models);
    return;
  }
  if (type === 'model') {
    currentModel = model || '';
    modelName.textContent = shortModelName(currentModel);
    updateModelButtonWidth();
    updateComposerOrbitSpeedFromModel();
    return;
  }
  if (type === 'mode') {
    updateModeUi(text || 'agent');
    return;
  }
  if (type === 'permission') {
    permissionMode = text || 'ask';
    const labelMap = { ask: 'Ask', auto: 'Auto', autonomous: 'Autonomous', manual: 'Manual' };
    const icon = permissionButton.querySelector('.button-icon');
    if (icon) icon.textContent = permissionIcons[permissionMode] || '\u270B';
    permissionName.textContent = labelMap[permissionMode] || 'Ask';
    document.querySelectorAll('.permission-row').forEach(r => r.classList.toggle('active', r.dataset.permission === permissionMode));
    return;
  }
  if (type === 'indexStatus') {
    setIndexStatus(data);
    return;
  }
  if (type === 'context') {
    if (uiConversationIsEmpty() && incomingContextHasRealUsage(data)) {
      setContextPercent(0, 0, data.max, data.available, data.compactAt, { ...data, requestApprox: 0, approx: 0, percent: 0 });
      return;
    }
    setContextPercent(data.percent, data.approx, data.max, data.available, data.compactAt, data);
    return;
  }
  if (type === 'editSessionState') {
    updateEditSessionButtons(data.editSessionId || '', data.undone === true);
    return;
  }
  if (type === 'modelSpeed') {
    updateComposerOrbitSpeedFromRuntime(data.tokensPerSecond);
    return;
  }
  if (type === 'thinking') {
    showProgressHeader('Thinking');
    return;
  }
  if (type === 'compactLine') {
    addCompactItem(data.id || '', text || data.text || 'Compacting Conversation');
    ackUiAfterPaint(data.ackId || '');
    return;
  }
  if (type === 'compactDone') {
    finishCompactItem(data.id || '', text || data.text || 'Conversation Compacted', data.ackId || '', data.context || null);
    return;
  }
  if (type === 'toolApproval') {
    addApprovalItem(data.id, data.name || 'tool', data.title || 'Approve tool', data.args || {});
    return;
  }
  if (type === 'toolStart') {
    addProgressItem(data.name || text, data.title || '', data.args || {}, '', data.id || '', data.toolId || '', data.writeKind || '', data.fileExisted);
    return;
  }
  if (type === 'toolThinking') {
    addToolThinking(data.toolId || '', data.name || '', data.id || '');
    return;
  }
  if (type === 'tool') {
    addProgressItem(data.name || 'result', data.title || text || 'Tool result', data.args || {}, data.detail || text || '', data.id || '', data.toolId || '', data.writeKind || '', data.fileExisted);
    return;
  }
  if (type === 'stopped') {
    if (ignoreNextStopped) {
      ignoreNextStopped = false;
      return;
    }
    clearProgress();
    setRunning(false);
    return;
  }
  if (type === 'assistantStep') {
    addThoughtItem(text || '', data.id || '');
    return;
  }
  if (type === 'assistantAnimated') {
    const liveProcess = activeProgress && activeProcess.length ? activeProcess.slice() : [];
    const backendProcess = Array.isArray(data.process) ? data.process : [];
    const process = backendProcess.some(item => item && item.editId) ? backendProcess : (liveProcess.length ? liveProcess : backendProcess);
    const meta = { editSessionId: data.editSessionId || '' };
    clearProgress(true);
    finalAssistantTyping = true;
    setRunning(true);
    append('assistant', text, true, process, (cancelled) => {
      finalAssistantTyping = false;
      setRunning(false);
      if (!cancelled) saveCurrentSession();
    }, meta);
    transcript.push({ role: 'assistant', text, at: Date.now(), process, editSessionId: meta.editSessionId });
    saveCurrentSession();
    activeProcess = [];
    return;
  }
  if (type === 'status') {
    if (/error|failed|nothing meaningful to compact/i.test(text || '')) append('status', text);
    return;
  }
  if (type === 'error') {
    clearProgress();
    append('error', text);
    return;
  }
  append(type, text);
});

renderHistory();
syncHistoryPanelLayout();
updateWelcome();
setContextPercent(0);
updateModelButtonWidth();
updateComposerOrbitSpeedFromModel();
vscode.postMessage({ type: 'ready' });


// SOREX SVG glow filters.
// Adds persistent SVG filters once. The icon glyphs reference these filters;
// the animation happens by swapping filter levels, not by rebuilding DOM.
(function ensureSorexGlowFilters() {
  if (document.getElementById('sorexGlowFilterSvg')) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'sorexGlowFilterSvg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';
  svg.innerHTML = `
    <defs>
      <filter id="sorexGlowOff" x="-220%" y="-220%" width="540%" height="540%">
        <feDropShadow dx="0" dy="0" stdDeviation="0" flood-color="#ffffff" flood-opacity="0"/>
      </filter>
      <filter id="sorexGlowLow" x="-220%" y="-220%" width="540%" height="540%">
        <feDropShadow dx="0" dy="0" stdDeviation="0.8" flood-color="#ffffff" flood-opacity=".18"/>
        <feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="#7fd8ff" flood-opacity=".18"/>
      </filter>
      <filter id="sorexGlowMid" x="-220%" y="-220%" width="540%" height="540%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.1" flood-color="#ffffff" flood-opacity=".48"/>
        <feDropShadow dx="0" dy="0" stdDeviation="3.8" flood-color="#95e0ff" flood-opacity=".40"/>
        <feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="#43bdff" flood-opacity=".22"/>
      </filter>
      <filter id="sorexGlowPeak" x="-260%" y="-260%" width="620%" height="620%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.4" flood-color="#ffffff" flood-opacity=".95"/>
        <feDropShadow dx="0" dy="0" stdDeviation="5.2" flood-color="#d8f7ff" flood-opacity=".80"/>
        <feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#45c2ff" flood-opacity=".55"/>
      </filter>
    </defs>`;
  document.body.appendChild(svg);
})();


// SOREX JS-driven reflective glyph pulse.
// Directly updates every SOREX icon glyph each frame. No host box-shadow ring,
// so the weird outline/line around the glyph is gone. The glyph itself reflects
// the light by changing brightness, color, opacity, scale, and drop-shadow.
(function startSorexGlyphPulseEngine() {
  if (window.__sorexGlyphPulseEngineStarted) return;
  window.__sorexGlyphPulseEngineStarted = true;

  const PERIOD = 1450;
  const SELECTOR = [
    '.logo.sorex-logo-icon > .sorex-font-icon',
    '.tool-icon.sorex-thinking-icon > .sorex-font-icon',
    '.assistant-step-icon.sorex-thinking-icon > .sorex-font-icon',
    '.message.progress .progress-line .tool-icon.sorex-thinking-icon > .sorex-font-icon',
    '.message.progress .progress-item.tool-thinking .tool-icon.sorex-thinking-icon > .sorex-font-icon',
    '.message.progress .progress-item.tool-thinking.initial-thinking .tool-icon.sorex-thinking-icon > .sorex-font-icon',
    '.message.progress .progress-thought.assistant-dialog .tool-icon.sorex-thinking-icon > .sorex-font-icon',
    '.message.progress .progress-thought.assistant-dialog .assistant-step-icon.sorex-thinking-icon > .sorex-font-icon',
    '.message.progress.running-progress:not(.headerless-progress) > .progress-line.live-text.initial-ai-thinking-line:not(.hidden-progress-line) > .tool-icon.sorex-thinking-icon > .sorex-font-icon',
    '.welcome-mark.sorex-logo-icon > .sorex-font-icon',
    '.boot-logo.sorex-logo-icon > .sorex-font-icon'
  ].join(',');

  function breath(now) {
    const phase = (now % PERIOD) / PERIOD;
    const s = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    return s * s * (3 - 2 * s);
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function tick(now) {
    const p = breath(now);
    const opacity = mix(0.66, 1.0, p).toFixed(3);
    const scale = mix(0.985, 1.065, p).toFixed(3);
    const bright = mix(0.90, 1.52, p).toFixed(3);

    const r = Math.round(mix(205, 255, p));
    const g = Math.round(mix(220, 255, p));
    const b = Math.round(mix(232, 255, p));
    const color = `rgb(${r}, ${g}, ${b})`;

    const white = mix(0.00, 0.55, p).toFixed(3);
    const blue = mix(0.04, 0.62, p).toFixed(3);
    const far = mix(0.00, 0.34, p).toFixed(3);

    document.querySelectorAll(SELECTOR).forEach((el) => {
      const host = el.parentElement;
      if (!host) return;

      el.style.setProperty('font-family', "'SorexIcons'", 'important');
      el.style.setProperty('display', 'inline-block', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      el.style.setProperty('color', color, 'important');
      el.style.setProperty('-webkit-text-fill-color', 'currentColor', 'important');
      el.style.setProperty('opacity', opacity, 'important');
      el.style.setProperty('transform', `scale(${scale})`, 'important');

      // Reflection lives on the glyph. No halo border/ring around the host.
      el.style.setProperty(
        'filter',
        `brightness(${bright}) ` +
        `drop-shadow(0 0 1px rgba(255,255,255,${white})) ` +
        `drop-shadow(0 0 5px rgba(130,215,255,${blue})) ` +
        `drop-shadow(0 0 10px rgba(60,185,255,${far}))`,
        'important'
      );

      el.style.setProperty('text-shadow', 'none', 'important');
      el.style.setProperty('animation', 'none', 'important');
      el.style.setProperty('background', 'none', 'important');
      el.style.setProperty('background-image', 'none', 'important');

      // Kill the visible host ring/line. The host is only layout now.
      host.style.setProperty('box-shadow', 'none', 'important');
      host.style.setProperty('outline', 'none', 'important');
      host.style.setProperty('background', 'transparent', 'important');
      host.style.setProperty('background-image', 'none', 'important');
      host.style.setProperty('filter', 'none', 'important');
      host.style.setProperty('animation', 'none', 'important');
    });

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
