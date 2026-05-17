import { DiagramTheme, generateThemeCSS } from './themes.js';

export function styleSVG(svg: string, theme: DiagramTheme): string {
  const cleanSVG = svg.replace(/<\?xml[^?]*\?>/, '');
  const styleTag = `<style>${generateThemeCSS(theme)}</style>`;

  const enhanced = cleanSVG.replace(/<svg[^>]*>/, `$&${styleTag}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${enhanced}`;
}

export function addVisualEffects(svg: string): string {
  const filters = `<defs><filter id="shadow">
    <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.3"/>
  </filter></defs>`;

  let result = svg.replace(/<svg[^>]*>/, `$&${filters}`);

  result = result.replace(/(<rect[^>]*class="[^"]*node[^"]*"[^>]*>)/g, (match) => {
    if (match.includes('filter=')) return match;
    return match.replace(/([^>]*)>/, `$1 filter="url(#shadow)">`);
  });

  return result;
}
