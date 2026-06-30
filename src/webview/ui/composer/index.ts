export { composerStyles } from './style';

type ComposerControllerOptions = {
  composer: HTMLElement | null;
  send: HTMLElement | null;
  sendIcon: HTMLElement | null;
};

export type ComposerController = {
  setOrbitDuration(durationSeconds: number): void;
  setRunningVisual(running: boolean): void;
};

export function createComposerController(options: ComposerControllerOptions): ComposerController {
  const { composer, send, sendIcon } = options;

  return {
    setOrbitDuration(durationSeconds: number): void {
      composer?.style.setProperty('--sorex-orbit-duration', `${durationSeconds.toFixed(2)}s`);
    },

    setRunningVisual(running: boolean): void {
      composer?.classList.toggle('working', running);
      send?.classList.toggle('running', running);
      if (send) send.title = running ? 'Stop generation' : 'Send';
      if (sendIcon) sendIcon.innerHTML = running ? '<span class="stop-square"></span>' : '\u21B5';
    }
  };
}

export const composerRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createComposerController = function(options) {
  var composer = options.composer;
  var send = options.send;
  var sendIcon = options.sendIcon;
  return {
    setOrbitDuration: function(durationSeconds) {
      if (composer) composer.style.setProperty('--sorex-orbit-duration', Number(durationSeconds).toFixed(2) + 's');
    },
    setRunningVisual: function(running) {
      if (composer) composer.classList.toggle('working', running);
      if (send) {
        send.classList.toggle('running', running);
        send.title = running ? 'Stop generation' : 'Send';
      }
      if (sendIcon) sendIcon.innerHTML = running ? '<span class="stop-square"></span>' : '\\u21B5';
    }
  };
};
`;
