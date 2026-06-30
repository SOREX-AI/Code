export const settingsAgentPage = {
  id: 'agent',
  title: 'Agent',
  controls: ['temperature', 'preferLocalModels', 'maxToolRounds', 'conservativeToolCalling']
} as const;

export { settingsAgentStyles } from './style';
