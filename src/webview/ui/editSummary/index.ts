export { editSummaryStyles } from './style';

export const editSummaryRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createEditSummaryController = function(options) {
  var vscode = options.vscode;
  function bindFooter(footer, editSessionId) {
    footer.querySelector('.edit-summary-link')?.addEventListener('click', function(ev) {
      if (!editSessionId) return;
      ev.currentTarget.disabled = true;
      vscode.postMessage({ type: 'toggleEditUndo', editSessionId: editSessionId });
    });
    footer.querySelector('.edit-summary-review')?.addEventListener('click', function() {
      if (editSessionId) vscode.postMessage({ type: 'reviewEdits', editSessionId: editSessionId });
    });
    footer.querySelectorAll('.edit-summary-row').forEach(function(row) {
      row.addEventListener('click', function() {
        if (editSessionId) vscode.postMessage({ type: 'reviewEdits', editSessionId: editSessionId, filePath: row.dataset.path || '' });
      });
    });
  }
  function updateButtons(editSessionId, undone) {
    var id = String(editSessionId || '');
    if (!id) return;
    document.querySelectorAll('.edit-summary-card[data-edit-session="' + CSS.escape(id) + '"] .edit-summary-link').forEach(function(button) {
      button.textContent = undone ? 'Reapply' : 'Undo';
      button.title = undone ? 'Reapply these edits' : 'Undo these edits';
      button.disabled = false;
      button.classList.toggle('reapply', undone);
    });
  }
  return { bindFooter: bindFooter, updateButtons: updateButtons };
};
`;
