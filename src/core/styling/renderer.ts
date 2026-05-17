import { DiagramTheme, generateThemeCSS } from './themes.js';

const NODE_SHADOW_CSS = `g.node rect { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.12)); }`;

export function styleSVG(svg: string, theme: DiagramTheme): string {
  const cleanSVG = svg.replace(/<\?xml[^?]*\?>/, '');
  const styleTag = `<style>${generateThemeCSS(theme)}\n${NODE_SHADOW_CSS}</style>`;

  const enhanced = cleanSVG.replace(/<svg[^>]*>/, `$&${styleTag}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${enhanced}`;
}
