export { settingsEntryStyles } from './style';

export const settingsEntryRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createSettingsEntryController = function(options) {
  var vscode = options.vscode;
  return {
    openSettings: function() {
      vscode.postMessage({ type: 'openSettings' });
    },
    attach: function(button) {
      if (button) button.addEventListener('click', function() { vscode.postMessage({ type: 'openSettings' }); });
    }
  };
};
`;
