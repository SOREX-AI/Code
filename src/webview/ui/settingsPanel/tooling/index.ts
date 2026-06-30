export const settingsToolingPage = {
  id: 'tooling',
  title: 'Tooling',
  controls: ['nativeToolCallingEnabled', 'toolListDirEnabled', 'toolFileSearchEnabled', 'toolGrepSearchEnabled', 'toolReadFileEnabled', 'toolTerminalEnabled', 'toolEditFilesEnabled']
} as const;

export { settingsToolingStyles } from './style';
