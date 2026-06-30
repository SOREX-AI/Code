import { css } from '../shared/style';

export const compactStatusStyles = css`
  html body .progress-compact,
  html body .compact-line {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 14px !important;
    width: 100% !important;
    min-width: 0 !important;
    text-align: center !important;
  }

  html body .progress-compact > span,
  html body .compact-line::before,
  html body .compact-line::after {
    flex: 1 1 0 !important;
    min-width: 28px !important;
    max-width: none !important;
  }

  html body .progress-compact > b,
  html body .compact-line > b {
    flex: 0 0 auto !important;
    max-width: min(72%, 260px) !important;
    text-align: center !important;
    white-space: nowrap !important;
  }

  @media (max-width: 390px) {
    html body .progress-compact,
    html body .compact-line {
      gap: 9px !important;
    }

    html body .progress-compact > span,
    html body .compact-line::before,
    html body .compact-line::after {
      min-width: 18px !important;
    }

    html body .progress-compact > b,
    html body .compact-line > b {
      max-width: 76% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
  }
`;
