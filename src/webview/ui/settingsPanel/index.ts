export { settingsPanelStyles } from './style';
export { settingsAgentPage, settingsAgentStyles } from './agent';
export { settingsContextPage, settingsContextStyles } from './context';
export { settingsIndexingPage, settingsIndexingStyles } from './indexing';
export { settingsProvidersPage, settingsProvidersStyles } from './providers';
export { settingsToolingPage, settingsToolingStyles } from './tooling';

export const settingsPanelPages = ['providers', 'context', 'indexing', 'tooling', 'agent'] as const;
