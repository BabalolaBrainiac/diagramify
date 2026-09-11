import { DiagramTheme, generateThemeCSS } from './themes.js';

const NODE_SHADOW_CSS = `g.node > rect { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.12)); }
g.node > text { stroke: none; }`;

export function styleSVG(svg: string, theme: DiagramTheme): string {
  const cleanSVG = svg.replace(/<\?xml[^?]*\?>/, '');
  // Bound filter work to each shape instead of the complete diagram surface.
  const shadow = theme.shadow;
  const filters = `<defs>
    <filter id="dfy-theme-shadow" x="-25%" y="-50%" width="150%" height="200%">
      <feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" stdDeviation="${shadow.blur}" flood-color="${theme.colors.shadow}" flood-opacity="${shadow.opacity}"/>
    </filter>
    <filter id="dfy-card-shadow" x="-25%" y="-50%" width="150%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.12"/>
    </filter>
  </defs>`;
  const css = generateThemeCSS(theme).replace(/filter: drop-shadow\([^;]+;/g, 'filter: url(#dfy-theme-shadow);');
  const styleTag = `${filters}<style>${css}\n${NODE_SHADOW_CSS.replace(/filter: drop-shadow\([^;]+;/g, 'filter: url(#dfy-card-shadow);')}</style>`;

  const enhanced = cleanSVG.replace(/<svg[^>]*>/, `$&${styleTag}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${enhanced}`;
}
