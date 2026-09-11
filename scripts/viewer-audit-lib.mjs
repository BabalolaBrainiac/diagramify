export function gridFixture(rows, columns = 6, direction = 'LR') {
  const lines = [`flowchart ${direction}`];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const id = `N${column}_${row}`;
      lines.push(`${id}[Service ${column} ${row}]`);
      if (column < columns - 1) {
        lines.push(`${id} -->|request| N${column + 1}_${row}`);
        if (row < rows - 1) lines.push(`${id} -.->|events| N${column + 1}_${row + 1}`);
      }
    }
  }
  return lines.join('\n');
}

// This function runs in the browser. Sample curve interiors at two canvas pixels.
export function auditGeometry() {
  const nodes = Array.from(document.querySelectorAll('.dfy-node')).filter(n => n.offsetWidth && n.style.display !== 'none');
  const boxes = nodes.map(n => ({ id: n.dataset.id, left: +n.dataset.cx - n.offsetWidth / 2,
    right: +n.dataset.cx + n.offsetWidth / 2, top: +n.dataset.cy - n.offsetHeight / 2,
    bottom: +n.dataset.cy + n.offsetHeight / 2 }));
  const hits = [], paths = [], labels = [];
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const path of document.querySelectorAll('.edge-path')) {
    const group = path.closest('.edge-group'), bounds = path.getBBox();
    const extent = { left: bounds.x, right: bounds.x + bounds.width, top: bounds.y, bottom: bounds.y + bounds.height };
    const candidates = boxes.filter(box => box.left < extent.right + 1 && box.right > extent.left - 1 && box.top < extent.bottom + 1 && box.bottom > extent.top - 1);
    const found = new Set(), length = path.getTotalLength();
    for (let distance = 0; distance <= Math.ceil(length / 2); distance++) {
      const p = path.getPointAtLength(Math.min(length, distance * 2));
      for (const box of candidates) {
        if (p.x > box.left + 1 && p.x < box.right - 1 && p.y > box.top + 1 && p.y < box.bottom - 1) found.add(box.id);
      }
    }
    for (const id of found) hits.push({ from: group.dataset.from, to: group.dataset.to, node: id,
      endpoint: id === group.dataset.from || id === group.dataset.to });
    paths.push({ from: group.dataset.from, to: group.dataset.to, d: path.getAttribute('d') });
  }
  for (const label of document.querySelectorAll('.edge-label-text')) {
    if (+getComputedStyle(label).opacity === 0) continue;
    const b = label.getBBox();
    labels.push({ text: label.textContent, left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height });
  }
  let labelPairs = 0, labelNodes = 0;
  labels.forEach((label, i) => {
    labelPairs += labels.slice(i + 1).filter(other => overlap(label, other)).length;
    labelNodes += boxes.filter(box => overlap(label, box)).length;
  });
  const segments = paths.flatMap((path, index) => {
    let previous;
    return [...path.d.matchAll(/([MLQ])([^MLQ]*)/g)].flatMap(([, command, values]) => {
      const numbers = values.trim().split(/[ ,]+/).map(Number), point = numbers.slice(-2);
      const segment = command === 'L' && previous ? { index, a: previous, b: point } : null;
      previous = point;
      return segment ? [segment] : [];
    });
  });
  let sharedSegments = 0;
  segments.forEach((s, i) => segments.slice(i + 1).forEach(t => {
    if (s.index === t.index) return;
    for (const axis of [0, 1]) {
      const other = 1 - axis;
      if (s.a[axis] === s.b[axis] && t.a[axis] === t.b[axis] && Math.abs(s.a[axis] - t.a[axis]) < 1 &&
        Math.min(Math.max(s.a[other], s.b[other]), Math.max(t.a[other], t.b[other])) -
        Math.max(Math.min(s.a[other], s.b[other]), Math.min(t.a[other], t.b[other])) > 8) sharedSegments++;
    }
  }));
  const groups = [...document.querySelectorAll('.dfy-subgraph')].filter(g => g.offsetWidth).map(group => {
    const members = boxes.filter(box => nodes.find(n => n.dataset.id === box.id)?.dataset.subgraph === group.dataset.id);
    return { id: group.dataset.id, padding: members.length ? [Math.min(...members.map(b => b.left)) - parseFloat(group.style.left),
      Math.min(...members.map(b => b.top)) - parseFloat(group.style.top),
      parseFloat(group.style.left) + group.offsetWidth - Math.max(...members.map(b => b.right)),
      parseFloat(group.style.top) + group.offsetHeight - Math.max(...members.map(b => b.bottom))] : [] };
  });
  return { nodes: nodes.length, edges: paths.length, hits, labelPairs, labelNodes, sharedSegments, groups,
    clippedLabels: nodes.filter(n => { const l = n.querySelector('.dfy-label'); return l.scrollWidth > l.clientWidth; }).map(n => n.dataset.id),
    types: [...new Set(nodes.map(n => n.dataset.type))].sort(),
    legend: [...document.querySelectorAll('#type-legend [data-type]')].filter(n => n.style.display !== 'none').map(n => n.dataset.type).sort(), paths };
}

export function auditStyles() {
  const rgb = color => {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return +( (Math.max(x, y) + .05) / (Math.min(x, y) + .05)).toFixed(3); };
  const blend = (a, b, alpha) => a.map((v, i) => v * alpha + b[i] * (1 - alpha));
  const root = getComputedStyle(document.body), bg = rgb(root.getPropertyValue('--bg')), surface = rgb(root.getPropertyValue('--surface'));
  const node = document.querySelector('.dfy-node'), label = node.querySelector('.dfy-label');
  const transition = node.style.transition;
  node.style.transition = 'none';
  node.classList.add('dimmed');
  const opacity = +getComputedStyle(node).opacity, dimColor = rgb(getComputedStyle(label).color);
  const dimContrast = ratio(blend(dimColor, bg, opacity), blend(surface, bg, opacity));
  node.classList.remove('dimmed');
  node.style.transition = transition;
  const edgeLabel = document.querySelector('.edge-label-text');
  const properties = {};
  for (const [selector, property] of [['.edge-path', 'stroke'], ['.dfy-node', 'borderColor'], ['.dfy-label', 'color'],
    ['.legend-detail', 'color'], ['.canvas-wrap', 'backgroundColor'], ['.dfy-minimap-viewport', 'borderColor'],
    ['.dfy-minimap-viewport', 'backgroundColor'], ['#dfy-search', 'borderColor'], ['.dfy-subgraph', 'borderColor'],
    ['.dfy-detail-panel', 'backgroundColor'], ['.sidebar', 'padding'], ['.header', 'padding'], ['.dfy-node', 'padding'],
    ['.legend-item', 'padding'], ['.canvas-wrap', 'scrollbarColor']]) {
    const element = document.querySelector(selector);
    if (element) properties[`${selector}:${property}`] = getComputedStyle(element)[property];
  }
  return { dimContrast, textContrast: ratio(rgb(getComputedStyle(label).color), surface),
    mutedContrast: ratio(rgb(root.getPropertyValue('--text-muted')), surface),
    edgeContrast: ratio(rgb(getComputedStyle(document.querySelector('.edge-path')).stroke), bg),
    edgeLabelContrast: edgeLabel ? ratio(blend(rgb(getComputedStyle(edgeLabel).fill), bg, +getComputedStyle(edgeLabel).opacity), bg) : null,
    legendKeyboard: [...document.querySelectorAll('#type-legend [data-type]')].every(n => n.tabIndex >= 0), properties,
    viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    headerOverflow: document.querySelector('.header').scrollWidth - document.querySelector('.header').clientWidth,
    canvasWidth: document.querySelector('.canvas-wrap').clientWidth };
}
