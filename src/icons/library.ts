export function getFallbackSVG(label: string, color: string = '#999999'): string {
  const chars = label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  const bgColor = color;
  const textColor = shouldUseLightText(color) ? '#ffffff' : '#000000';

  return `<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <rect width="36" height="36" rx="6" fill="${bgColor}"/>
    <text x="18" y="20" font-size="16" font-weight="600" text-anchor="middle" fill="${textColor}" font-family="system-ui, -apple-system, sans-serif">
      ${chars}
    </text>
  </svg>`;
}

function shouldUseLightText(hexColor: string): boolean {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

export function fallbackSVGDataURI(label: string, color: string = '#999999'): string {
  const svg = getFallbackSVG(label, color);
  const encoded = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}
