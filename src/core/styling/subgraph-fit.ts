/**
 * Grows a subgraph box until it contains the nodes inside it.
 *
 * The layout engine sizes a tier box from the nodes it holds, but the box can
 * end a few pixels short, so a node border sits on or across the tier border.
 * That reads as a broken diagram. This measures the members and widens the box
 * rather than moving anything, so the layout the engine chose is preserved.
 */

const PADDING = 14;
/** The header strip a tier draws above its contents. */
const HEADER_HEIGHT = 28;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

function numeric(tag: string, name: string): number {
  return Number.parseFloat(attribute(tag, name) ?? '');
}

/** Walks to the close tag that matches an opening `<g>`, allowing for nesting. */
function groupBody(svg: string, openEnd: number): { body: string; end: number } {
  let depth = 1;
  let index = openEnd;
  const scan = /<g\b[^>]*>|<\/g>/g;
  scan.lastIndex = openEnd;

  let tag: RegExpExecArray | null;
  while (depth > 0 && (tag = scan.exec(svg)) !== null) {
    depth += tag[0] === '</g>' ? -1 : 1;
    index = scan.lastIndex;
  }

  return { body: svg.slice(openEnd, index), end: index };
}

/** Collects the drawn box of every node, keyed by the id the renderer stamps. */
function nodeBoxes(svg: string): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const open = /<g\b[^>]*class="[^"]*\bnode\b[^"]*"[^>]*>/g;

  let match: RegExpExecArray | null;
  while ((match = open.exec(svg)) !== null) {
    const id = attribute(match[0], 'data-id');
    if (!id) {
      continue;
    }

    const { body } = groupBody(svg, open.lastIndex);

    const rect = body.match(/<rect\b[^>]*>/);
    if (rect) {
      const box = {
        x: numeric(rect[0], 'x'),
        y: numeric(rect[0], 'y'),
        width: numeric(rect[0], 'width'),
        height: numeric(rect[0], 'height'),
      };
      if (Object.values(box).every(Number.isFinite)) {
        boxes.set(id, box);
      }
      continue;
    }

    const ellipse = body.match(/<ellipse\b[^>]*>/);
    if (ellipse) {
      const cx = numeric(ellipse[0], 'cx');
      const cy = numeric(ellipse[0], 'cy');
      const rx = numeric(ellipse[0], 'rx');
      const ry = numeric(ellipse[0], 'ry');
      if ([cx, cy, rx, ry].every(Number.isFinite)) {
        boxes.set(id, { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 });
      }
    }
  }

  return boxes;
}

/**
 * Rewrites every subgraph box so it encloses its members.
 *
 * A tier keeps its own header strip, which stays anchored to the top edge and
 * is widened with the box.
 */
export function fitSubgraphBoxes(svg: string, membership: Map<string, string[]>): string {
  if (membership.size === 0) {
    return svg;
  }

  const boxes = nodeBoxes(svg);
  if (boxes.size === 0) {
    return svg;
  }

  let result = svg;
  const open = /<g\b[^>]*class="[^"]*\bsubgraph\b[^"]*"[^>]*>/g;

  // Collect first, then rewrite, so the indexes stay valid while scanning.
  const edits: Array<{ from: string; to: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = open.exec(svg)) !== null) {
    const id = attribute(match[0], 'data-id');
    if (!id) {
      continue;
    }

    const members = (membership.get(id) ?? [])
      .map((nodeId) => boxes.get(nodeId))
      .filter((box): box is Box => Boolean(box));

    if (members.length === 0) {
      continue;
    }

    const { body } = groupBody(svg, open.lastIndex);
    const rects = body.match(/<rect\b[^>]*>/g);
    if (!rects || rects.length === 0) {
      continue;
    }

    const outer = rects[0];
    const current = {
      x: numeric(outer, 'x'),
      y: numeric(outer, 'y'),
      width: numeric(outer, 'width'),
      height: numeric(outer, 'height'),
    };
    if (!Object.values(current).every(Number.isFinite)) {
      continue;
    }

    const needLeft = Math.min(...members.map((m) => m.x)) - PADDING;
    const needTop = Math.min(...members.map((m) => m.y)) - PADDING;
    const needRight = Math.max(...members.map((m) => m.x + m.width)) + PADDING;
    const needBottom = Math.max(...members.map((m) => m.y + m.height)) + PADDING;

    // Only grow. Shrinking would undo the engine's spacing decisions.
    const x = Math.min(current.x, needLeft);
    const y = Math.min(current.y, needTop - HEADER_HEIGHT);
    const right = Math.max(current.x + current.width, needRight);
    const bottom = Math.max(current.y + current.height, needBottom);

    if (
      x === current.x &&
      y === current.y &&
      right === current.x + current.width &&
      bottom === current.y + current.height
    ) {
      continue;
    }

    const grown = withBox(outer, { x, y, width: right - x, height: bottom - y });
    edits.push({ from: outer, to: grown });

    // The second rectangle is the header strip. Keep it on the top edge.
    if (rects.length > 1) {
      const header = rects[1];
      const headerHeight = numeric(header, 'height');
      edits.push({
        from: header,
        to: withBox(header, {
          x,
          y,
          width: right - x,
          height: Number.isFinite(headerHeight) ? headerHeight : HEADER_HEIGHT,
        }),
      });
    }
  }

  for (const edit of edits) {
    result = result.replace(edit.from, edit.to);
  }

  return result;
}

function withBox(tag: string, box: Box): string {
  return tag
    .replace(/\sx="[^"]*"/, ` x="${round(box.x)}"`)
    .replace(/\sy="[^"]*"/, ` y="${round(box.y)}"`)
    .replace(/\swidth="[^"]*"/, ` width="${round(box.width)}"`)
    .replace(/\sheight="[^"]*"/, ` height="${round(box.height)}"`);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
