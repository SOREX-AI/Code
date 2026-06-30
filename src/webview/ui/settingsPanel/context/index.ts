export const settingsContextPage = {
  id: 'context',
  title: 'Context',
  controls: ['maxInputTokens', 'maxOutputTokens', 'contextSafetyTokens', 'autoCompactEnabled', 'compactAtPercent', 'maxUserMessageChars', 'includeToolSchemaInContextBudget']
} as const;

export { settingsContextStyles } from './style';
