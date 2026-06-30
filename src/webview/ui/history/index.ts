export { historyStyles } from './style';

export const historyRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createHistoryController = function(options) {
  var panel = options.panel;
  var list = options.list;
  var body = document.body;
  var savedScrollTop = 0;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function archiveIcon(archiveTab) {
    return archiveTab
      ? '<svg class="history-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"></path><path d="M20 4v4h-4"></path><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"></path><path d="M4 20v-4h4"></path></svg>'
      : '<svg class="history-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14"></path><path d="M7 8v11h10V8"></path><path d="M9 8V5h6v3"></path><path d="M9.5 12h5"></path></svg>';
  }

  function deleteIcon() {
    return '<svg class="history-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"></path><path d="M9 7V5h6v2"></path><path d="M8 10v9h8v-9"></path><path d="M10.5 12.5 13.5 15.5"></path><path d="M13.5 12.5 10.5 15.5"></path></svg>';
  }

  function render(state, handlers) {
    if (!list) return;
    list.textContent = '';
    var archiveTab = state.tab === 'archive';
    var source = archiveTab ? state.archivedSessions : state.sessions;
    source = Array.isArray(source) ? source : [];
    if (!source.length) {
      var empty = document.createElement('div');
      empty.className = 'history-row empty';
      empty.innerHTML = '<div class="history-title">' + (archiveTab ? 'No archived chats' : 'No saved chats yet') + '</div><div class="history-meta">' + (archiveTab ? 'Archived chats will appear here.' : 'Start a task and it will appear here.') + '</div>';
      list.appendChild(empty);
      return;
    }
    source.forEach(function(session) {
      var row = document.createElement('div');
      row.className = 'history-row';
      row.dataset.sessionId = session.id;
      var archiveTitle = archiveTab ? 'Restore' : 'Archive';
      row.innerHTML = '<button class="history-load" title="' + escapeHtml(session.title) + '"><div class="history-title">' + escapeHtml(session.title) + '</div><div class="history-meta">' + new Date(session.updatedAt).toLocaleString() + '</div></button><div class="history-actions"><button title="' + archiveTitle + '" aria-label="' + archiveTitle + '" data-action="archive">' + archiveIcon(archiveTab) + '</button><button title="Delete" aria-label="Delete" data-action="delete">' + deleteIcon() + '</button></div>';
      row.querySelector('.history-load').addEventListener('click', function() { handlers.load(session.id, archiveTab); });
      row.querySelector('[data-action="archive"]').addEventListener('click', function(ev) {
        ev.stopPropagation();
        handlers.archive(session.id, archiveTab);
      });
      row.querySelector('[data-action="delete"]').addEventListener('click', function(ev) {
        ev.stopPropagation();
        handlers.delete(session.id, archiveTab);
      });
      list.appendChild(row);
    });
  }

  function setOpen(open, hooks) {
    if (!panel) return;
    var willOpen = Boolean(open);
    var wasOpen = body.classList.contains('history-open');
    if (willOpen && !wasOpen) {
      var scroller = hooks.getChatScroller && hooks.getChatScroller();
      savedScrollTop = Number((scroller && scroller.scrollTop) || 0);
    }
    if (hooks.syncLayout) hooks.syncLayout();
    panel.classList.toggle('hidden', !willOpen);
    body.classList.toggle('history-open', willOpen);
    if (willOpen) {
      if (list) list.scrollTop = 0;
    } else if (wasOpen) {
      var restoreScroller = hooks.getChatScroller && hooks.getChatScroller();
      if (restoreScroller) restoreScroller.scrollTop = savedScrollTop;
    }
  }

  function animateAction(id, action, commit) {
    var row = list && list.querySelector('[data-session-id="' + CSS.escape(String(id)) + '"]');
    if (!row) {
      commit();
      return;
    }
    row.classList.add(action === 'delete' ? 'removing-delete' : 'removing-archive');
    row.addEventListener('animationend', function() { commit(); }, { once: true });
    window.setTimeout(function() {
      if (row.isConnected) commit();
    }, 240);
  }

  return { render: render, setOpen: setOpen, animateAction: animateAction };
};
`;
