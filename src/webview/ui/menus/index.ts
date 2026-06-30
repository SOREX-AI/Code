export { menusStyles } from './style';

export const menusRuntimeScript = `
window.SOREX_UI = window.SOREX_UI || {};
window.SOREX_UI.createMenusController = function(options) {
  return {
    list: function() {
      return [options.modelMenu, options.modeMenu, options.permissionMenu].filter(Boolean);
    },
    anchors: function() {
      return [options.modelButton, options.modeButton, options.permissionButton].filter(Boolean);
    }
  };
};
`;
