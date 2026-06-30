import { css } from '../shared/style';

export const contextRingStyles = css`
  html body #contextRing .context-progress,
  html body #composerFooter #contextRing.context-ring .context-progress,
  html body #contextRing.warn .context-progress,
  html body #contextRing.hot .context-progress,
  html body #composerFooter #contextRing.context-ring.warn .context-progress,
  html body #composerFooter #contextRing.context-ring.hot .context-progress {
    stroke: rgba(255,255,255,.86) !important;
    filter: none !important;
  }
`;
