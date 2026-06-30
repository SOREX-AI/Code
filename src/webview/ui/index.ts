import { baseStyles } from './base';
import { assistantActionsRuntimeScript, assistantActionsStyles } from './assistantActions';
import { composerRuntimeScript, composerStyles } from './composer';
import { compactStatusStyles } from './compactStatus';
import { contextRingRuntimeScript, contextRingStyles } from './contextRing';
import { editSummaryRuntimeScript, editSummaryStyles } from './editSummary';
import { historyRuntimeScript, historyStyles } from './history';
import { menusRuntimeScript, menusStyles } from './menus';
import { modelPickerRuntimeScript, modelPickerStyles } from './modelPicker';
import { settingsEntryRuntimeScript, settingsEntryStyles } from './settingsEntry';
import { joinStyles } from './shared/style';

export const webviewUiStyles = joinStyles(
  baseStyles,
  assistantActionsStyles,
  composerStyles,
  compactStatusStyles,
  contextRingStyles,
  editSummaryStyles,
  historyStyles,
  menusStyles,
  modelPickerStyles,
  settingsEntryStyles
);

export const webviewUiRuntimeScript = [
  assistantActionsRuntimeScript,
  composerRuntimeScript,
  contextRingRuntimeScript,
  editSummaryRuntimeScript,
  historyRuntimeScript,
  menusRuntimeScript,
  modelPickerRuntimeScript,
  settingsEntryRuntimeScript
].join('\n');
