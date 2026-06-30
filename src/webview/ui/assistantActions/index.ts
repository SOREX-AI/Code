export { assistantActionsStyles } from './style';

export const assistantActionsRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createAssistantActionsController = function(options) {
  var vscode = options.vscode;
  function markFeedback(footer, rating, text) {
    footer.querySelectorAll('.assistant-action.thumbs-up,.assistant-action.thumbs-down').forEach(function(btn) { btn.classList.remove('active'); });
    footer.querySelector('.assistant-action.' + (rating === 'up' ? 'thumbs-up' : 'thumbs-down'))?.classList.add('active');
    vscode.postMessage({ type: 'assistantFeedback', rating: rating, text: String(text || '').slice(0, 1000) });
  }
  return { markFeedback: markFeedback };
};
`;
