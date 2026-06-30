export { modelPickerStyles } from './style';

export const modelPickerRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createModelPickerController = function() {
  return {
    providerModeLabel: function(mode) {
      var map = { lmstudio: 'LM Studio', ollama: 'Ollama', jan: 'Jan', custom: 'OpenAI-compatible', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', openrouter: 'OpenRouter' };
      return map[String(mode || '').toLowerCase()] || 'Provider';
    },
    isCloudProvider: function(mode) {
      return ['openai', 'anthropic', 'google', 'openrouter'].includes(String(mode || '').toLowerCase());
    }
  };
};
`;
