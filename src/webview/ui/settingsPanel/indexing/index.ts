export const settingsIndexingPage = {
  id: 'indexing',
  title: 'Indexing',
  controls: ['indexEnabled', 'indexAutoRefresh', 'indexStorageMode', 'indexRankingMode', 'indexEmbeddingEnabled', 'indexEmbeddingProvider', 'indexEmbeddingModel']
} as const;

export { settingsIndexingStyles } from './style';
