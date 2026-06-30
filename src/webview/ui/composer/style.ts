import { css } from '../shared/style';

export const composerStyles = css`
  html body:not(.history-open) #composer.working::before,
  html body.history-open #composer.working::before {
    background: conic-gradient(from var(--angle),
      transparent 0deg 292deg,
      rgba(255,255,255,.16) 306deg,
      rgba(255,255,255,.72) 321deg,
      rgba(255,255,255,.94) 332deg,
      rgba(255,255,255,.72) 344deg,
      rgba(255,255,255,.16) 354deg,
      transparent 360deg) !important;
  }

  html body:not(.history-open) #composer.working::after,
  html body.history-open #composer.working::after {
    background: radial-gradient(circle at 50% 100%, rgba(255,255,255,.18), transparent 62%) !important;
    opacity: .18 !important;
  }
`;
