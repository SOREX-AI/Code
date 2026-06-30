import { css } from '../shared/style';

export const editSummaryStyles = css`
  html body .edit-summary-card {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }

  html body .edit-summary-head {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 10px 12px !important;
    min-width: 0 !important;
  }

  html body .edit-summary-icon {
    flex: 0 0 34px !important;
    width: 34px !important;
    min-width: 34px !important;
    align-self: flex-start !important;
    margin-top: 2px !important;
  }

  html body .edit-summary-head > div {
    flex: 1 1 13rem !important;
    min-width: 9.5rem !important;
    max-width: 100% !important;
  }

  html body .edit-summary-head strong {
    line-height: 1.28 !important;
    white-space: normal !important;
    word-break: normal !important;
    overflow-wrap: normal !important;
    hyphens: none !important;
  }

  html body .edit-summary-head small {
    white-space: nowrap !important;
  }

  html body .edit-summary-link,
  html body .edit-summary-review {
    flex: 0 0 auto !important;
    white-space: nowrap !important;
  }

  html body .edit-summary-list,
  html body .edit-summary-row,
  html body .edit-summary-row span {
    min-width: 0 !important;
  }

  @media (max-width: 520px) {
    html body .edit-summary-head {
      gap: 9px 10px !important;
      padding: 13px 14px !important;
    }

    html body .edit-summary-head > div {
      flex: 1 1 calc(100% - 46px) !important;
      min-width: 0 !important;
    }

    html body .edit-summary-link {
      margin-left: 46px !important;
    }
  }

  @media (max-width: 390px) {
    html body .edit-summary-head {
      align-items: stretch !important;
    }

    html body .edit-summary-link {
      margin-left: 46px !important;
    }

    html body .edit-summary-review {
      margin-left: 0 !important;
    }
  }
`;
