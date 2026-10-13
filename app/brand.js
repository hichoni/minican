// App identity is separate from the editor's document fonts and storage keys.
import { el } from './ui.js';
export const onbatangAsset = name => new URL(`./brand/${name}`, import.meta.url).href;
export const onbatangLogo = (className = '', alt = '온바탕') => el('img', {
  class: `onba-logo ${className}`, src: onbatangAsset('logo-primary.svg'), alt,
  width: 342, height: 96, draggable: 'false', decoding: 'async',
});
