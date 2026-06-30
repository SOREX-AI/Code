export { contextRingStyles } from './style';

export type ContextMeterDetails = {
  contextUsed?: number;
  approx?: number;
  requestApprox?: number;
  contextLimit?: number;
  max?: number;
  windowMax?: number;
  usableMax?: number;
  contextPercent?: number;
  compacted?: boolean;
  compactionDone?: boolean;
  forceInstant?: boolean;
  contextSource?: string;
};

type ContextRingControllerOptions = {
  ring: HTMLElement | null;
  value: HTMLElement | null;
  tip: HTMLElement | null;
  clamp(value: number, min: number, max: number): number;
};

export type ContextRingController = {
  setup(): void;
  setPercent(
    pct: number,
    approx?: number,
    max?: number,
    available?: number,
    compactAt?: number,
    details?: ContextMeterDetails
  ): void;
};

export function createContextRingController(options: ContextRingControllerOptions): ContextRingController {
  const { ring, value, tip, clamp } = options;
  let progressPath: SVGPathElement | null = null;
  let lastVisualPercent = 0;
  const radius = 7.05;
  const cx = 12;
  const cy = 12;
  const startAngle = -90;

  const pointAtAngle = (angleDegrees: number): { x: number; y: number } => {
    const angleRadians = angleDegrees * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(angleRadians),
      y: cy + radius * Math.sin(angleRadians)
    };
  };

  const arcPath = (percent: number): string => {
    const pct = clamp(Number(percent) || 0, 0, 100);
    if (pct <= 0) return '';

    const start = pointAtAngle(startAngle);
    if (pct >= 99.95) {
      const mid = pointAtAngle(startAngle + 180);
      return [
        `M ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
        `A ${radius} ${radius} 0 1 1 ${mid.x.toFixed(3)} ${mid.y.toFixed(3)}`,
        `A ${radius} ${radius} 0 1 1 ${start.x.toFixed(3)} ${start.y.toFixed(3)}`
      ].join(' ');
    }

    const endAngle = startAngle + (pct * 3.6);
    const end = pointAtAngle(endAngle);
    const largeArcFlag = pct > 50 ? 1 : 0;
    return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
  };

  const setup = (): void => {
    if (!ring) return;

    ring.querySelectorAll('.context-svg').forEach(el => el.remove());

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'context-svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const track = document.createElementNS(ns, 'circle');
    track.setAttribute('class', 'context-track');
    track.setAttribute('cx', String(cx));
    track.setAttribute('cy', String(cy));
    track.setAttribute('r', String(radius));

    const progress = document.createElementNS(ns, 'path');
    progress.setAttribute('class', 'context-progress');
    progress.setAttribute('d', '');
    progress.style.strokeDasharray = 'none';
    progress.style.transform = 'none';

    svg.append(track, progress);
    ring.insertBefore(svg, ring.firstChild);
    progressPath = progress;
    if (value) value.textContent = '';
  };

  const setPercent: ContextRingController['setPercent'] = (pct, approx = 0, max = 0, _available = undefined, compactAt = 62, details = {}) => {
    if (!ring) return;

    const totalApprox = Number(details.contextUsed || details.approx || approx || details.requestApprox || 0);
    const windowMax = Math.max(1, Number(details.contextLimit || details.max || max || details.windowMax || details.usableMax || 32768));
    const used = Math.max(0, totalApprox);
    const limit = windowMax;
    const threshold = Math.max(35, Math.min(95, Number(compactAt) || 62));
    const explicitContextPercent = Number(details.contextPercent);
    const derived = Number.isFinite(explicitContextPercent)
      ? explicitContextPercent
      : limit > 1
        ? (used / limit) * 100
        : Number(pct) || 0;
    const exactPercent = clamp(derived, 0, 100);
    const n = Math.floor(exactPercent);
    const displayPercent = exactPercent >= 10 || Number.isInteger(exactPercent)
      ? String(n)
      : exactPercent.toFixed(1).replace(/\.0$/, '');

    const visualN = exactPercent;
    const instantVisualUpdate = Boolean(details.compacted || details.compactionDone || details.forceInstant);
    const droppedAfterCompact = instantVisualUpdate || visualN < lastVisualPercent - 4;
    if (droppedAfterCompact) setup();
    lastVisualPercent = visualN;
    ring.style.setProperty('--pct', `${visualN}%`);
    ring.style.removeProperty('--sorex-context-dash');
    ring.dataset.percent = displayPercent;
    ring.dataset.visualPercent = visualN.toFixed(2);
    if (progressPath) {
      progressPath.style.transition = droppedAfterCompact ? 'none' : '';
      progressPath.setAttribute('d', arcPath(visualN));
      progressPath.style.strokeDasharray = 'none';
      progressPath.style.transform = 'none';
      progressPath.style.opacity = visualN <= 0 ? '0' : '1';
      if (droppedAfterCompact) {
        void progressPath.getBoundingClientRect();
        progressPath.style.transition = '';
      }
    }

    if (value) value.textContent = '';
    const source = details.contextSource === 'provider' ? 'provider' : 'manual';
    const info = `Total context: ${Math.round(used).toLocaleString()} / ${Math.round(limit).toLocaleString()} tokens (${displayPercent}%, ${source})`;
    ring.title = info;
    ring.setAttribute('aria-label', info);
    if (tip) tip.textContent = info;

    ring.classList.toggle('empty', visualN <= 0);
    ring.classList.toggle('warn', visualN >= threshold);
    ring.classList.toggle('hot', visualN >= Math.min(96, threshold + 15));
  };

  return { setup, setPercent };
}

export const contextRingRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createContextRingController = function(options) {
  var ring = options.ring;
  var value = options.value;
  var tip = options.tip;
  var clamp = options.clamp;
  var progressPath = null;
  var lastVisualPercent = 0;
  var radius = 7.05;
  var cx = 12;
  var cy = 12;
  var startAngle = -90;

  function pointAtAngle(angleDegrees) {
    var angleRadians = angleDegrees * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(angleRadians),
      y: cy + radius * Math.sin(angleRadians)
    };
  }

  function arcPath(percent) {
    var pct = clamp(Number(percent) || 0, 0, 100);
    if (pct <= 0) return '';
    var start = pointAtAngle(startAngle);
    if (pct >= 99.95) {
      var mid = pointAtAngle(startAngle + 180);
      return [
        'M ' + start.x.toFixed(3) + ' ' + start.y.toFixed(3),
        'A ' + radius + ' ' + radius + ' 0 1 1 ' + mid.x.toFixed(3) + ' ' + mid.y.toFixed(3),
        'A ' + radius + ' ' + radius + ' 0 1 1 ' + start.x.toFixed(3) + ' ' + start.y.toFixed(3)
      ].join(' ');
    }
    var endAngle = startAngle + (pct * 3.6);
    var end = pointAtAngle(endAngle);
    var largeArcFlag = pct > 50 ? 1 : 0;
    return 'M ' + start.x.toFixed(3) + ' ' + start.y.toFixed(3) + ' A ' + radius + ' ' + radius + ' 0 ' + largeArcFlag + ' 1 ' + end.x.toFixed(3) + ' ' + end.y.toFixed(3);
  }

  function setup() {
    if (!ring) return;
    ring.querySelectorAll('.context-svg').forEach(function(el) { el.remove(); });
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'context-svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var track = document.createElementNS(ns, 'circle');
    track.setAttribute('class', 'context-track');
    track.setAttribute('cx', String(cx));
    track.setAttribute('cy', String(cy));
    track.setAttribute('r', String(radius));
    var progress = document.createElementNS(ns, 'path');
    progress.setAttribute('class', 'context-progress');
    progress.setAttribute('d', '');
    progress.style.strokeDasharray = 'none';
    progress.style.transform = 'none';
    svg.append(track, progress);
    ring.insertBefore(svg, ring.firstChild);
    progressPath = progress;
    if (value) value.textContent = '';
  }

  function setPercent(pct, approx, max, available, compactAt, details) {
    if (!ring) return;
    approx = approx || 0;
    max = max || 0;
    compactAt = compactAt === undefined ? 62 : compactAt;
    details = details || {};
    var totalApprox = Number(details.contextUsed || details.approx || approx || details.requestApprox || 0);
    var windowMax = Math.max(1, Number(details.contextLimit || details.max || max || details.windowMax || details.usableMax || 32768));
    var used = Math.max(0, totalApprox);
    var limit = windowMax;
    var threshold = Math.max(35, Math.min(95, Number(compactAt) || 62));
    var explicitContextPercent = Number(details.contextPercent);
    var derived = Number.isFinite(explicitContextPercent) ? explicitContextPercent : (limit > 1 ? (used / limit) * 100 : Number(pct) || 0);
    var exactPercent = clamp(derived, 0, 100);
    var n = Math.floor(exactPercent);
    var displayPercent = exactPercent >= 10 || Number.isInteger(exactPercent) ? String(n) : exactPercent.toFixed(1).replace(/\\.0$/, '');
    var visualN = exactPercent;
    var instantVisualUpdate = Boolean(details.compacted || details.compactionDone || details.forceInstant);
    var droppedAfterCompact = instantVisualUpdate || visualN < lastVisualPercent - 4;
    if (droppedAfterCompact) setup();
    lastVisualPercent = visualN;
    ring.style.setProperty('--pct', visualN + '%');
    ring.style.removeProperty('--sorex-context-dash');
    ring.dataset.percent = displayPercent;
    ring.dataset.visualPercent = visualN.toFixed(2);
    if (progressPath) {
      progressPath.style.transition = droppedAfterCompact ? 'none' : '';
      progressPath.setAttribute('d', arcPath(visualN));
      progressPath.style.strokeDasharray = 'none';
      progressPath.style.transform = 'none';
      progressPath.style.opacity = visualN <= 0 ? '0' : '1';
      if (droppedAfterCompact) {
        progressPath.getBoundingClientRect();
        progressPath.style.transition = '';
      }
    }
    if (value) value.textContent = '';
    var source = details.contextSource === 'provider' ? 'provider' : 'manual';
    var info = 'Total context: ' + Math.round(used).toLocaleString() + ' / ' + Math.round(limit).toLocaleString() + ' tokens (' + displayPercent + '%, ' + source + ')';
    ring.title = info;
    ring.setAttribute('aria-label', info);
    if (tip) tip.textContent = info;
    ring.classList.toggle('empty', visualN <= 0);
    ring.classList.toggle('warn', visualN >= threshold);
    ring.classList.toggle('hot', visualN >= Math.min(96, threshold + 15));
  }

  return { setup: setup, setPercent: setPercent };
};
`;
