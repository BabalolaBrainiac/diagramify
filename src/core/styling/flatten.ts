/**
 * Flattens modern CSS color syntax in an SVG to literal colors.
 *
 * A rasterizer such as librsvg, which `sharp` uses, does not support CSS custom
 * properties (`var()`) or `color-mix()`. Every reference to them falls back to
 * black. The result is an unreadable PNG or JPEG. This module resolves the
 * values ahead of the rasterizer, so the raster output matches the browser.
 */

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  transparent: 'transparent',
  none: 'none',
  currentcolor: 'currentColor',
};

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(color: Rgb): string {
  return `#${[color.r, color.g, color.b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Reads `#rgb`, `#rrggbb`, `rgb(...)`, and a small set of named colors. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();

  const named = NAMED_COLORS[value];
  if (named && named.startsWith('#')) {
    return parseColor(named);
  }

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map((p) => parseFloat(p));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
  }

  return null;
}

/**
 * Splits the arguments of a CSS function at the top level.
 * A nested function keeps its own commas.
 */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of input) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    }

    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

/** Finds the body of the first `name(` call and the index after its closing bracket. */
function matchCall(input: string, name: string): { start: number; end: number; body: string } | null {
  const start = input.indexOf(`${name}(`);
  if (start === -1) {
    return null;
  }

  let depth = 0;
  for (let i = start + name.length; i < input.length; i += 1) {
    if (input[i] === '(') {
      depth += 1;
    } else if (input[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return { start, end: i + 1, body: input.slice(start + name.length + 1, i) };
      }
    }
  }

  return null;
}

/** Mixes two colors in the sRGB space, as `color-mix(in srgb, a p%, b)` does. */
function mixSrgb(first: Rgb, firstWeight: number, second: Rgb, secondWeight: number): Rgb {
  const total = firstWeight + secondWeight;
  if (total <= 0) {
    return first;
  }
  const a = firstWeight / total;
  const b = secondWeight / total;
  return {
    r: first.r * a + second.r * b,
    g: first.g * a + second.g * b,
    b: first.b * a + second.b * b,
  };
}

const MAX_DEPTH = 24;

/**
 * Replaces every `var()` and `color-mix()` in `value` with a literal color.
 * Returns the input unchanged when a reference cannot resolve.
 */
export function resolveValue(
  value: string,
  variables: Map<string, string>,
  depth = 0,
): string {
  if (depth > MAX_DEPTH) {
    return value;
  }

  let result = value;

  // Resolve the innermost var() first, so a fallback that holds a var() also resolves.
  for (let guard = 0; guard < 64; guard += 1) {
    const call = matchCall(result, 'var');
    if (!call) {
      break;
    }

    const args = splitTopLevel(call.body, ',');
    const name = args[0].trim();
    const fallback = args.slice(1).join(',').trim();

    const declared = variables.get(name);
    let replacement: string;

    if (declared !== undefined && declared.trim() !== '') {
      replacement = resolveValue(declared, variables, depth + 1);
    } else if (fallback !== '') {
      replacement = resolveValue(fallback, variables, depth + 1);
    } else {
      // Nothing to resolve to. Leave the text alone rather than emit black.
      return value;
    }

    result = result.slice(0, call.start) + replacement + result.slice(call.end);
  }

  // Resolve color-mix() from the inside out.
  for (let guard = 0; guard < 64; guard += 1) {
    const call = matchCall(result, 'color-mix');
    if (!call) {
      break;
    }

    const mixed = evaluateColorMix(call.body, variables, depth);
    if (!mixed) {
      return value;
    }

    result = result.slice(0, call.start) + mixed + result.slice(call.end);
  }

  return result;
}

function evaluateColorMix(body: string, variables: Map<string, string>, depth: number): string | null {
  const args = splitTopLevel(body, ',').map((a) => resolveValue(a.trim(), variables, depth + 1).trim());

  // The first argument names the color space, for example `in srgb`.
  const colorArgs = args[0].startsWith('in ') ? args.slice(1) : args;
  if (colorArgs.length !== 2) {
    return null;
  }

  const parsed = colorArgs.map((arg) => {
    const percent = arg.match(/(-?[\d.]+)%\s*$/);
    const colorText = percent ? arg.slice(0, percent.index).trim() : arg.trim();
    return { color: parseColor(colorText), weight: percent ? parseFloat(percent[1]) : null };
  });

  if (parsed.some((p) => p.color === null)) {
    return null;
  }

  // CSS fills in a missing percentage so that the two weights total 100.
  let [firstWeight, secondWeight] = parsed.map((p) => p.weight);
  if (firstWeight === null && secondWeight === null) {
    firstWeight = 50;
    secondWeight = 50;
  } else if (firstWeight === null) {
    firstWeight = 100 - (secondWeight as number);
  } else if (secondWeight === null) {
    secondWeight = 100 - firstWeight;
  }

  return toHex(mixSrgb(parsed[0].color as Rgb, firstWeight, parsed[1].color as Rgb, secondWeight as number));
}

/** Collects every `--name: value` declaration in the SVG, in document order. */
export function collectVariables(svg: string): Map<string, string> {
  const variables = new Map<string, string>();
  const declaration = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}"]+)/g;

  let match: RegExpExecArray | null;
  while ((match = declaration.exec(svg)) !== null) {
    // A later declaration wins, which matches the cascade for a single scope.
    variables.set(match[1], match[2].trim());
  }

  return variables;
}

const PAINT_ATTRIBUTES = [
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color',
];

/**
 * Rewrites an SVG so that a rasterizer without `var()` or `color-mix()` support
 * draws the same colors as a browser.
 */
export function flattenSVGColors(svg: string): string {
  const variables = collectVariables(svg);
  if (variables.size === 0 && !svg.includes('var(')) {
    return svg;
  }

  let result = svg;

  // 1. Presentation attributes, for example fill="var(--_node-fill)".
  for (const attribute of PAINT_ATTRIBUTES) {
    const pattern = new RegExp(`(\\s${attribute}=")([^"]*(?:var\\(|color-mix\\()[^"]*)(")`, 'g');
    result = result.replace(pattern, (_full, prefix, value, suffix) =>
      prefix + resolveValue(value, variables) + suffix,
    );
  }

  // 2. Inline style attributes, which can hold several declarations.
  result = result.replace(/(\sstyle=")([^"]*)(")/g, (full, prefix, value: string, suffix) => {
    if (!value.includes('var(') && !value.includes('color-mix(')) {
      return full;
    }
    return prefix + resolveDeclarationList(value, variables) + suffix;
  });

  // 3. Declarations inside <style> blocks.
  result = result.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_full, open, css: string, close) => {
    if (!css.includes('var(') && !css.includes('color-mix(')) {
      return open + css + close;
    }
    return open + resolveStyleBlock(css, variables) + close;
  });

  return result;
}

function resolveDeclarationList(value: string, variables: Map<string, string>): string {
  return splitTopLevel(value, ';')
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon === -1) {
        return declaration;
      }
      const property = declaration.slice(0, colon);
      const propertyValue = declaration.slice(colon + 1);
      // Keep a custom property as written. Only its use sites need a literal.
      if (property.trim().startsWith('--')) {
        return declaration;
      }
      return `${property}:${resolveValue(propertyValue, variables)}`;
    })
    .join(';');
}

function resolveStyleBlock(css: string, variables: Map<string, string>): string {
  // Rewrite a declaration only when it uses a reference, and never a custom
  // property definition, so the original cascade stays readable in a browser.
  // The lookbehind stops the match inside a custom property name such as
  // `--_node-fill`, whose definition must stay for the browser cascade.
  return css.replace(
    /(?<![-_A-Za-z0-9])([A-Za-z][A-Za-z-]*)\s*:\s*([^;{}]*(?:var\(|color-mix\()[^;{}]*)/g,
    (full, property: string, value: string) => {
      const resolved = resolveValue(value, variables);
      return resolved === value ? full : `${property}: ${resolved}`;
    },
  );
}
