/** Uses route segments so label placement needs no browser path measurements. */
export function routeLabelAnchor(path: string): { x: number; y: number; tx: number; ty: number } {
  let previous = { x: 0, y: 0 };
  let best = { x: 0, y: 0, tx: 1, ty: 0, length: -1 };
  for (const command of path.match(/[MLQ][^MLQ]*/gi) ?? []) {
    const values = command.slice(1).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
    if (values.length < 2) continue;
    const end = { x: values[values.length - 2], y: values[values.length - 1] };
    if (command[0].toUpperCase() === 'L') {
      const dx = end.x - previous.x, dy = end.y - previous.y;
      const length = Math.hypot(dx, dy);
      if (length > best.length && length > 0) best = {
        x: (previous.x + end.x) / 2, y: (previous.y + end.y) / 2,
        tx: dx / length, ty: dy / length, length,
      };
    } else if (best.length < 0) {
      best.x = end.x;
      best.y = end.y;
    }
    previous = end;
  }
  let nx = -best.ty, ny = best.tx;
  if (ny > 0) { nx = -nx; ny = -ny; }
  return { x: best.x + nx * 9, y: best.y + ny * 9, tx: best.tx, ty: best.ty };
}

/** Limits obstacle checks to cells that intersect the route. */
export function createObstacleIndex<T extends { left: number; right: number; top: number; bottom: number }>(boxes: T[]) {
  const cells = new Map<string, T[]>();
  const size = 160;
  for (const box of boxes) {
    for (let x = Math.floor(box.left / size); x <= Math.floor(box.right / size); x++) {
      for (let y = Math.floor(box.top / size); y <= Math.floor(box.bottom / size); y++) {
        const key = `${x}:${y}`;
        const cell = cells.get(key);
        if (cell) cell.push(box);
        else cells.set(key, [box]);
      }
    }
  }
  return {
    query(left: number, top: number, right: number, bottom: number): T[] {
      const candidates = new Set<T>();
      const width = Math.floor(right / size) - Math.floor(left / size) + 1;
      const height = Math.floor(bottom / size) - Math.floor(top / size) + 1;
      // A very long route must not scan an unbounded number of empty cells.
      if (width * height > cells.size) boxes.forEach(box => candidates.add(box));
      else for (let x = Math.floor(left / size); x <= Math.floor(right / size); x++) {
        for (let y = Math.floor(top / size); y <= Math.floor(bottom / size); y++) {
          cells.get(`${x}:${y}`)?.forEach(box => candidates.add(box));
        }
      }
      return [...candidates].filter(box => box.left <= right && box.right >= left && box.top <= bottom && box.bottom >= top);
    },
  };
}
