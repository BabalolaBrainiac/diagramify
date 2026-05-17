/**
 * Professional styling themes for diagrams
 * Supports dark and light modes with proper contrast and visual hierarchy
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  text: string;
  border: string;
  shadow: string;
  nodeBackground: string;
  nodeBorder: string;
  edgeStroke: string;
  edgeLabel: string;
}

export interface DiagramTheme {
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: {
    padding: number;
    margin: number;
    iconSize: number;
  };
  typography: {
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    lineHeight: number;
  };
  shadow: {
    blur: number;
    offsetX: number;
    offsetY: number;
    opacity: number;
  };
}

const lightTheme: DiagramTheme = {
  mode: 'light',
  colors: {
    background: '#FFFFFF',
    text: '#1A1A1A',
    border: '#E0E0E0',
    shadow: '#000000',
    nodeBackground: '#FAFAFA',
    nodeBorder: '#D0D0D0',
    edgeStroke: '#666666',
    edgeLabel: '#333333',
  },
  spacing: {
    padding: 12,
    margin: 8,
    iconSize: 32,
  },
  typography: {
    fontSize: 14,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: 500,
    lineHeight: 1.4,
  },
  shadow: {
    blur: 4,
    offsetX: 0,
    offsetY: 2,
    opacity: 0.1,
  },
};

const darkTheme: DiagramTheme = {
  mode: 'dark',
  colors: {
    background: '#1A1A1A',
    text: '#E0E0E0',
    border: '#3A3A3A',
    shadow: '#000000',
    nodeBackground: '#2A2A2A',
    nodeBorder: '#4A4A4A',
    edgeStroke: '#999999',
    edgeLabel: '#CCCCCC',
  },
  spacing: {
    padding: 12,
    margin: 8,
    iconSize: 32,
  },
  typography: {
    fontSize: 14,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: 500,
    lineHeight: 1.4,
  },
  shadow: {
    blur: 8,
    offsetX: 0,
    offsetY: 4,
    opacity: 0.3,
  },
};

/**
 * Get theme by name
 */
export function getTheme(themeName?: string, mode: ThemeMode = 'light'): DiagramTheme {
  // For now, return light or dark theme
  // In future, can support named themes like 'tokyo-night', 'gruvbox', etc.
  return mode === 'dark' ? darkTheme : lightTheme;
}

/**
 * Generate CSS for theme
 */
export function generateThemeCSS(theme: DiagramTheme): string {
  const { colors, typography, shadow } = theme;

  return `
    :root {
      --diagram-bg: ${colors.background};
      --diagram-text: ${colors.text};
      --diagram-border: ${colors.border};
      --diagram-shadow: ${colors.shadow};
      --diagram-node-bg: ${colors.nodeBackground};
      --diagram-node-border: ${colors.nodeBorder};
      --diagram-edge-stroke: ${colors.edgeStroke};
      --diagram-edge-label: ${colors.edgeLabel};
      --diagram-font-family: ${typography.fontFamily};
      --diagram-font-size: ${typography.fontSize}px;
      --diagram-font-weight: ${typography.fontWeight};
      --diagram-line-height: ${typography.lineHeight};
      --diagram-shadow-blur: ${shadow.blur}px;
      --diagram-shadow-x: ${shadow.offsetX}px;
      --diagram-shadow-y: ${shadow.offsetY}px;
      --diagram-shadow-opacity: ${shadow.opacity};
    }

    body {
      background-color: var(--diagram-bg);
      color: var(--diagram-text);
      font-family: var(--diagram-font-family);
      font-size: var(--diagram-font-size);
      font-weight: var(--diagram-font-weight);
      line-height: var(--diagram-line-height);
    }

    svg {
      background-color: var(--diagram-bg);
      color: var(--diagram-text);
    }

    .node {
      fill: var(--diagram-node-bg);
      stroke: var(--diagram-node-border);
      stroke-width: 1.5px;
      filter: drop-shadow(var(--diagram-shadow-x) var(--diagram-shadow-y) var(--diagram-shadow-blur) rgba(var(--diagram-shadow), var(--diagram-shadow-opacity)));
    }

    .node text {
      fill: var(--diagram-text);
      font-family: var(--diagram-font-family);
      font-size: var(--diagram-font-size);
      font-weight: var(--diagram-font-weight);
    }

    .edgePath path {
      stroke: var(--diagram-edge-stroke);
      stroke-width: 1.5px;
      fill: none;
    }

    .edgeLabel {
      fill: var(--diagram-edge-label);
      font-family: var(--diagram-font-family);
      font-size: calc(var(--diagram-font-size) * 0.85);
    }

    .label {
      fill: var(--diagram-text);
      background-color: var(--diagram-node-bg);
    }
  `;
}

/**
 * Get contrast-safe text color for a background color
 */
export function getContrastColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Parse hex to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return white for dark colors, dark for light colors
  return luminance > 0.5 ? '#1A1A1A' : '#FFFFFF';
}

/**
 * Lighten a color for backgrounds
 */
export function lightenColor(hexColor: string, percent: number = 10): string {
  const hex = hexColor.replace('#', '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  r = Math.min(255, Math.round(r + (255 - r) * (percent / 100)));
  g = Math.min(255, Math.round(g + (255 - g) * (percent / 100)));
  b = Math.min(255, Math.round(b + (255 - b) * (percent / 100)));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Darken a color for borders
 */
export function darkenColor(hexColor: string, percent: number = 10): string {
  const hex = hexColor.replace('#', '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  r = Math.max(0, Math.round(r - r * (percent / 100)));
  g = Math.max(0, Math.round(g - g * (percent / 100)));
  b = Math.max(0, Math.round(b - b * (percent / 100)));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
