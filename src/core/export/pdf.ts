/**
 * Writes a vector PDF from the rendered SVG.
 *
 * The output holds real vector shapes and selectable text, not a picture of the
 * diagram, so it stays sharp at any zoom and prints cleanly. Text uses the
 * Helvetica family, which every PDF reader carries, so nothing has to be
 * embedded and the file stays small.
 *
 * The converter covers the subset of SVG that the Diagramify renderer emits:
 * rect, ellipse, circle, line, polyline, polygon, path, and text.
 */

import { flattenSVGColors } from '../styling/flatten.js';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface PdfOptions {
  /** Page margin in points. */
  margin?: number;
  title?: string;
  /** Painted behind the drawing. Pass `transparent` to leave the page white. */
  background?: string;
}

const POINTS_PER_INCH = 72;
const MAX_PAGE_POINTS = 200 * POINTS_PER_INCH; // PDF caps a page at 200 inches.

function parseHex(value: string | undefined): Rgb | null {
  if (!value) {
    return null;
  }
  const text = value.trim().toLowerCase();
  if (text === 'none' || text === 'transparent') {
    return null;
  }

  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    grey: '#808080',
    gray: '#808080',
  };
  const hex = (named[text] ?? text).replace('#', '');

  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16) / 255,
      g: parseInt(hex[1] + hex[1], 16) / 255,
      b: parseInt(hex[2] + hex[2], 16) / 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
    };
  }

  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) {
      return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
    }
  }

  return null;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

function num(tag: string, name: string, fallback = 0): number {
  const parsed = Number.parseFloat(attribute(tag, name) ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fmt(value: number): string {
  // Three decimals is well below a printer's resolution and keeps the file small.
  return (Math.round(value * 1000) / 1000).toString();
}

/** Escapes a string for a PDF literal. */
function pdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Maps text to WinAnsi, the encoding the base fonts use.
 * A character outside it is replaced, so the file never holds invalid bytes.
 */
function toWinAnsi(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[←-⇿]/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

interface DrawState {
  content: string[];
  fill: Rgb | null;
  stroke: Rgb | null;
  lineWidth: number;
}

function setFill(state: DrawState, color: Rgb | null): void {
  if (!color) {
    return;
  }
  if (
    !state.fill ||
    state.fill.r !== color.r ||
    state.fill.g !== color.g ||
    state.fill.b !== color.b
  ) {
    state.content.push(`${fmt(color.r)} ${fmt(color.g)} ${fmt(color.b)} rg`);
    state.fill = color;
  }
}

function setStroke(state: DrawState, color: Rgb | null, width: number): void {
  if (!color) {
    return;
  }
  if (
    !state.stroke ||
    state.stroke.r !== color.r ||
    state.stroke.g !== color.g ||
    state.stroke.b !== color.b
  ) {
    state.content.push(`${fmt(color.r)} ${fmt(color.g)} ${fmt(color.b)} RG`);
    state.stroke = color;
  }
  if (state.lineWidth !== width) {
    state.content.push(`${fmt(width)} w`);
    state.lineWidth = width;
  }
}

/** Chooses the paint operator: fill, stroke, or both. */
function paintOp(fill: Rgb | null, stroke: Rgb | null): string | null {
  if (fill && stroke) return 'B';
  if (fill) return 'f';
  if (stroke) return 'S';
  return null;
}

/**
 * Converts an SVG path `d` attribute into PDF operators.
 * Covers M, L, H, V, C, Q, Z, and their relative forms, which is everything the
 * renderer produces.
 */
function pathToPdf(d: string, y: (value: number) => number): string[] {
  const out: string[] = [];
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?[\d.]+(?:e[-+]?\d+)?/gi) ?? [];

  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  let lastControlX = 0;
  let lastControlY = 0;

  const next = () => Number.parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const token = tokens[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(token)) {
      command = token;
      i += 1;
    }

    const relative = command === command.toLowerCase();

    switch (command.toLowerCase()) {
      case 'm': {
        const x = next();
        const yy = next();
        cx = relative ? cx + x : x;
        cy = relative ? cy + yy : yy;
        startX = cx;
        startY = cy;
        out.push(`${fmt(cx)} ${fmt(y(cy))} m`);
        // A repeated pair after M is treated as L.
        command = relative ? 'l' : 'L';
        break;
      }
      case 'l': {
        const x = next();
        const yy = next();
        cx = relative ? cx + x : x;
        cy = relative ? cy + yy : yy;
        out.push(`${fmt(cx)} ${fmt(y(cy))} l`);
        break;
      }
      case 'h': {
        const x = next();
        cx = relative ? cx + x : x;
        out.push(`${fmt(cx)} ${fmt(y(cy))} l`);
        break;
      }
      case 'v': {
        const yy = next();
        cy = relative ? cy + yy : yy;
        out.push(`${fmt(cx)} ${fmt(y(cy))} l`);
        break;
      }
      case 'c': {
        const x1 = next();
        const y1 = next();
        const x2 = next();
        const y2 = next();
        const x = next();
        const yy = next();
        const c1x = relative ? cx + x1 : x1;
        const c1y = relative ? cy + y1 : y1;
        const c2x = relative ? cx + x2 : x2;
        const c2y = relative ? cy + y2 : y2;
        cx = relative ? cx + x : x;
        cy = relative ? cy + yy : yy;
        lastControlX = c2x;
        lastControlY = c2y;
        out.push(
          `${fmt(c1x)} ${fmt(y(c1y))} ${fmt(c2x)} ${fmt(y(c2y))} ${fmt(cx)} ${fmt(y(cy))} c`,
        );
        break;
      }
      case 's': {
        const x2 = next();
        const y2 = next();
        const x = next();
        const yy = next();
        const c1x = 2 * cx - lastControlX;
        const c1y = 2 * cy - lastControlY;
        const c2x = relative ? cx + x2 : x2;
        const c2y = relative ? cy + y2 : y2;
        cx = relative ? cx + x : x;
        cy = relative ? cy + yy : yy;
        lastControlX = c2x;
        lastControlY = c2y;
        out.push(
          `${fmt(c1x)} ${fmt(y(c1y))} ${fmt(c2x)} ${fmt(y(c2y))} ${fmt(cx)} ${fmt(y(cy))} c`,
        );
        break;
      }
      case 'q': {
        const qx = next();
        const qy = next();
        const x = next();
        const yy = next();
        const ctrlX = relative ? cx + qx : qx;
        const ctrlY = relative ? cy + qy : qy;
        const endX = relative ? cx + x : x;
        const endY = relative ? cy + yy : yy;
        // Raise the quadratic curve to a cubic one, which is all PDF has.
        const c1x = cx + (2 / 3) * (ctrlX - cx);
        const c1y = cy + (2 / 3) * (ctrlY - cy);
        const c2x = endX + (2 / 3) * (ctrlX - endX);
        const c2y = endY + (2 / 3) * (ctrlY - endY);
        cx = endX;
        cy = endY;
        lastControlX = ctrlX;
        lastControlY = ctrlY;
        out.push(
          `${fmt(c1x)} ${fmt(y(c1y))} ${fmt(c2x)} ${fmt(y(c2y))} ${fmt(cx)} ${fmt(y(cy))} c`,
        );
        break;
      }
      case 'z': {
        out.push('h');
        cx = startX;
        cy = startY;
        break;
      }
      default: {
        // An unsupported command would desynchronise the token stream.
        i = tokens.length;
        break;
      }
    }
  }

  return out;
}

/** Maps an SVG font weight and style onto one of the base Helvetica fonts. */
/**
 * Recovers the final two points of a path, in SVG coordinates.
 * The operators already hold flipped y values, so they are flipped back.
 */
function endpointsFromOperators(
  operators: string[],
): { tipX: number; tipY: number; fromX: number; fromY: number } | null {
  const points: Array<[number, number]> = [];

  for (const operator of operators) {
    const parts = operator.trim().split(/\s+/);
    const verb = parts[parts.length - 1];
    if (verb !== 'm' && verb !== 'l' && verb !== 'c') {
      continue;
    }
    const x = Number.parseFloat(parts[parts.length - 3]);
    const yValue = Number.parseFloat(parts[parts.length - 2]);
    if (Number.isFinite(x) && Number.isFinite(yValue)) {
      points.push([x, yValue]);
    }
  }

  if (points.length < 2) {
    return null;
  }

  const [tipX, tipY] = points[points.length - 1];
  const [fromX, fromY] = points[points.length - 2];
  return { tipX, tipY, fromX, fromY };
}

const ARROW_SIZE = 7;

function fontResource(weight: string | undefined, style: string | undefined): string {
  const bold = weight ? weight === 'bold' || Number.parseInt(weight, 10) >= 600 : false;
  const italic = style === 'italic' || style === 'oblique';
  if (bold && italic) return 'F4';
  if (bold) return 'F2';
  if (italic) return 'F3';
  return 'F1';
}

/** Widths for Helvetica, used only to centre and right-align text. */
const HELVETICA_WIDTH_DEFAULT = 0.55;
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 0.278, '!': 0.278, '"': 0.355, '#': 0.556, $: 0.556, '%': 0.889, '&': 0.667,
  "'": 0.191, '(': 0.333, ')': 0.333, '*': 0.389, '+': 0.584, ',': 0.278, '-': 0.333,
  '.': 0.278, '/': 0.278, '0': 0.556, '1': 0.556, '2': 0.556, '3': 0.556, '4': 0.556,
  '5': 0.556, '6': 0.556, '7': 0.556, '8': 0.556, '9': 0.556, ':': 0.278, ';': 0.278,
  '<': 0.584, '=': 0.584, '>': 0.584, '?': 0.556, '@': 1.015, A: 0.667, B: 0.667,
  C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.5,
  K: 0.667, L: 0.556, M: 0.833, N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722,
  S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611,
  '[': 0.278, '\\': 0.278, ']': 0.278, '^': 0.469, _: 0.556, '`': 0.333, a: 0.556,
  b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278, g: 0.556, h: 0.556, i: 0.222,
  j: 0.222, k: 0.5, l: 0.222, m: 0.833, n: 0.556, o: 0.556, p: 0.556, q: 0.556,
  r: 0.333, s: 0.5, t: 0.278, u: 0.556, v: 0.5, w: 0.722, x: 0.5, y: 0.5, z: 0.5,
  '{': 0.334, '|': 0.26, '}': 0.334, '~': 0.584,
};

function textWidth(text: string, size: number, bold: boolean): number {
  let total = 0;
  for (const char of text) {
    total += HELVETICA_WIDTHS[char] ?? HELVETICA_WIDTH_DEFAULT;
  }
  // Bold Helvetica runs a little wider than the regular face.
  return total * size * (bold ? 1.03 : 1);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Draws a filled triangle at the end of a line.
 *
 * SVG points an arrowhead with a `marker-end`. PDF has no equivalent, so the
 * head is drawn as real geometry, turned to match the final segment.
 */
function arrowHead(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  size: number,
  y: (value: number) => number,
): string[] {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) {
    return [];
  }

  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular unit vector, for the two base corners.
  const px = -uy;
  const py = ux;

  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const halfWidth = size * 0.42;

  return [
    `${fmt(tipX)} ${fmt(y(tipY))} m`,
    `${fmt(baseX + px * halfWidth)} ${fmt(y(baseY + py * halfWidth))} l`,
    `${fmt(baseX - px * halfWidth)} ${fmt(y(baseY - py * halfWidth))} l`,
    'h',
    'f',
  ];
}

/**
 * Renders the SVG into PDF content-stream operators.
 * Elements are walked in document order, so paint order is preserved.
 */
function svgToContent(svg: string, height: number): string {
  const state: DrawState = { content: [], fill: null, stroke: null, lineWidth: -1 };
  const y = (value: number) => height - value;

  // Strip style and defs. Colors are already literal, and markers are redrawn
  // as arrowhead paths by the renderer.
  const body = svg
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<defs[\s\S]*?<\/defs>/g, '');

  const elements = body.match(
    /<(?:rect|ellipse|circle|line|polyline|polygon|path)\b[^>]*\/?>|<text\b[^>]*>[\s\S]*?<\/text>/g,
  ) ?? [];

  for (const element of elements) {
    const openTag = element.match(/<[^>]*>/)![0];
    const fill = parseHex(attribute(openTag, 'fill'));
    const stroke = parseHex(attribute(openTag, 'stroke'));
    const strokeWidth = num(openTag, 'stroke-width', 1);
    const opacity = Number.parseFloat(attribute(openTag, 'opacity') ?? '1');

    if (opacity === 0) {
      continue;
    }

    if (element.startsWith('<text')) {
      const raw = element.replace(/<[^>]*>/g, '');
      const text = toWinAnsi(decodeEntities(raw)).trim();
      if (!text) {
        continue;
      }

      const size = num(openTag, 'font-size', 13);
      const weight = attribute(openTag, 'font-weight');
      const anchor = attribute(openTag, 'text-anchor') ?? 'start';
      const font = fontResource(weight, attribute(openTag, 'font-style'));
      const bold = font === 'F2' || font === 'F4';

      let tx = num(openTag, 'x');
      const dy = num(openTag, 'dy');
      const ty = num(openTag, 'y') + dy;

      const width = textWidth(text, size, bold);
      if (anchor === 'middle') {
        tx -= width / 2;
      } else if (anchor === 'end') {
        tx -= width;
      }

      setFill(state, fill ?? { r: 0, g: 0, b: 0 });
      state.content.push('BT');
      state.content.push(`/${font} ${fmt(size)} Tf`);
      state.content.push(`1 0 0 1 ${fmt(tx)} ${fmt(y(ty))} Tm`);
      state.content.push(`(${pdfString(text)}) Tj`);
      state.content.push('ET');
      continue;
    }

    const op = paintOp(fill, stroke);
    if (!op) {
      continue;
    }

    setFill(state, fill);
    setStroke(state, stroke, strokeWidth);

    if (element.startsWith('<rect')) {
      const x = num(openTag, 'x');
      const ry = num(openTag, 'y');
      const w = num(openTag, 'width');
      const h = num(openTag, 'height');
      if (w <= 0 || h <= 0) {
        continue;
      }
      state.content.push(`${fmt(x)} ${fmt(y(ry + h))} ${fmt(w)} ${fmt(h)} re`);
      state.content.push(op);
      continue;
    }

    if (element.startsWith('<ellipse') || element.startsWith('<circle')) {
      const cx = num(openTag, 'cx');
      const cy = num(openTag, 'cy');
      const rx = element.startsWith('<circle') ? num(openTag, 'r') : num(openTag, 'rx');
      const ryRadius = element.startsWith('<circle') ? num(openTag, 'r') : num(openTag, 'ry');
      if (rx <= 0 || ryRadius <= 0) {
        continue;
      }
      // Four Bezier curves approximate an ellipse within a fraction of a point.
      const k = 0.5523;
      const ox = rx * k;
      const oy = ryRadius * k;
      state.content.push(`${fmt(cx - rx)} ${fmt(y(cy))} m`);
      state.content.push(
        `${fmt(cx - rx)} ${fmt(y(cy - oy))} ${fmt(cx - ox)} ${fmt(y(cy - ryRadius))} ${fmt(cx)} ${fmt(y(cy - ryRadius))} c`,
      );
      state.content.push(
        `${fmt(cx + ox)} ${fmt(y(cy - ryRadius))} ${fmt(cx + rx)} ${fmt(y(cy - oy))} ${fmt(cx + rx)} ${fmt(y(cy))} c`,
      );
      state.content.push(
        `${fmt(cx + rx)} ${fmt(y(cy + oy))} ${fmt(cx + ox)} ${fmt(y(cy + ryRadius))} ${fmt(cx)} ${fmt(y(cy + ryRadius))} c`,
      );
      state.content.push(
        `${fmt(cx - ox)} ${fmt(y(cy + ryRadius))} ${fmt(cx - rx)} ${fmt(y(cy + oy))} ${fmt(cx - rx)} ${fmt(y(cy))} c`,
      );
      state.content.push(op);
      continue;
    }

    if (element.startsWith('<line')) {
      state.content.push(`${fmt(num(openTag, 'x1'))} ${fmt(y(num(openTag, 'y1')))} m`);
      state.content.push(`${fmt(num(openTag, 'x2'))} ${fmt(y(num(openTag, 'y2')))} l`);
      state.content.push('S');
      continue;
    }

    if (element.startsWith('<polyline') || element.startsWith('<polygon')) {
      const raw = attribute(openTag, 'points') ?? '';
      const values = raw
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (values.length < 4) {
        continue;
      }
      state.content.push(`${fmt(values[0])} ${fmt(y(values[1]))} m`);
      for (let index = 2; index + 1 < values.length; index += 2) {
        state.content.push(`${fmt(values[index])} ${fmt(y(values[index + 1]))} l`);
      }
      if (element.startsWith('<polygon')) {
        state.content.push('h');
      }
      state.content.push(element.startsWith('<polygon') ? op : 'S');

      if (attribute(openTag, 'marker-end') && values.length >= 4) {
        const count = values.length;
        setFill(state, stroke);
        state.content.push(
          ...arrowHead(
            values[count - 2],
            values[count - 1],
            values[count - 4],
            values[count - 3],
            ARROW_SIZE,
            y,
          ),
        );
      }
      if (attribute(openTag, 'marker-start') && values.length >= 4) {
        setFill(state, stroke);
        state.content.push(
          ...arrowHead(values[0], values[1], values[2], values[3], ARROW_SIZE, y),
        );
      }
      continue;
    }

    if (element.startsWith('<path')) {
      const d = attribute(openTag, 'd');
      if (!d) {
        continue;
      }
      const operators = pathToPdf(d, y);
      if (operators.length === 0) {
        continue;
      }
      state.content.push(...operators);
      state.content.push(op);

      if (attribute(openTag, 'marker-end')) {
        const tail = endpointsFromOperators(operators);
        if (tail) {
          setFill(state, stroke);
          state.content.push(
            ...arrowHead(tail.tipX, tail.tipY, tail.fromX, tail.fromY, ARROW_SIZE, y),
          );
        }
      }
    }
  }

  return state.content.join('\n');
}

/**
 * Builds the PDF file.
 *
 * The page is sized to the diagram, so nothing is cropped and no scaling is
 * needed. A very large diagram is scaled down to the format's page limit.
 */
export function svgToPDF(svg: string, options: PdfOptions = {}): Buffer {
  const flattened = flattenSVGColors(svg);

  const viewBox = flattened.match(/viewBox="([-\d.eE+\s]+)"/);
  let minX = 0;
  let minY = 0;
  let width = Number.parseFloat(flattened.match(/\swidth="([\d.]+)"/)?.[1] ?? '800');
  let height = Number.parseFloat(flattened.match(/\sheight="([\d.]+)"/)?.[1] ?? '600');

  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      [minX, minY, width, height] = parts;
    }
  }

  const margin = options.margin ?? 24;
  let scale = 1;
  const maxContent = MAX_PAGE_POINTS - margin * 2;
  if (width > maxContent || height > maxContent) {
    scale = Math.min(maxContent / width, maxContent / height);
  }

  const pageWidth = width * scale + margin * 2;
  const pageHeight = height * scale + margin * 2;

  const drawing = svgToContent(flattened, height);

  const parts: string[] = ['q'];

  const background = parseHex(options.background);
  if (background) {
    parts.push(`${fmt(background.r)} ${fmt(background.g)} ${fmt(background.b)} rg`);
    parts.push(`0 0 ${fmt(pageWidth)} ${fmt(pageHeight)} re f`);
  }

  // Move the origin to the margin, apply the scale, then shift by the viewBox.
  parts.push(`1 0 0 1 ${fmt(margin)} ${fmt(margin)} cm`);
  if (scale !== 1) {
    parts.push(`${fmt(scale)} 0 0 ${fmt(scale)} 0 0 cm`);
  }
  parts.push(`1 0 0 1 ${fmt(-minX)} ${fmt(minY)} cm`);
  parts.push(drawing);
  parts.push('Q');

  const content = parts.join('\n');
  return assemblePDF(content, pageWidth, pageHeight, options.title);
}

/** Writes the PDF object structure and the cross-reference table. */
function assemblePDF(content: string, width: number, height: number, title?: string): Buffer {
  const objects: string[] = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(width)} ${fmt(height)}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R >> >> ' +
      '/Contents 4 0 R >>',
  );
  objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);

  for (const [name, resource] of [
    ['Helvetica', 'F1'],
    ['Helvetica-Bold', 'F2'],
    ['Helvetica-Oblique', 'F3'],
    ['Helvetica-BoldOblique', 'F4'],
  ] as const) {
    void resource;
    objects.push(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`,
    );
  }

  const info = title
    ? `<< /Title (${pdfString(toWinAnsi(title))}) /Producer (Diagramify) /Creator (Diagramify) >>`
    : '<< /Producer (Diagramify) /Creator (Diagramify) >>';
  objects.push(info);

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
