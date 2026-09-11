import { createGraphSession, type GraphOperation, type GraphSnapshot } from '../core/graph-session.js';
import type { ArchitectureGraph, IRNode } from '../core/ir.js';
import { classifyService } from '../icons/services.js';
import { getIconURL } from '../icons/simple-icons.js';

interface Card extends HTMLElement { containedNodes?: HTMLElement[] }
interface EditorHooks {
  canvas: HTMLElement;
  cards: Record<string, Card>;
  initial: ArchitectureGraph;
  getScale(): number;
  disablePan(disabled: boolean): void;
  selected(): HTMLElement | null;
  select(element: HTMLElement | null): void;
  editing(): boolean;
  snap(): boolean;
  draw(ids?: string[]): void;
  changed(snapshot: GraphSnapshot): void;
}

function createCard(node: IRNode): Card {
  const classification = classifyService(node.label);
  const card = document.createElement('div');
  const type = node.serviceType ?? classification.type;
  card.className = `dfy-node service-${type}`;
  card.dataset.type = type;
  card.style.setProperty('--brand', classification.color);
  card.style.setProperty('--brand-bg', classification.backgroundColor);
  const icon = document.createElement('div');
  icon.className = 'dfy-icon';
  const image = document.createElement('img');
  image.src = getIconURL(classification.simpleIconSlug || node.label, classification.color, true);
  image.alt = '';
  icon.append(image);
  const labelWrap = document.createElement('div');
  labelWrap.className = 'dfy-label-wrap';
  const label = document.createElement('div');
  label.className = 'dfy-label';
  labelWrap.append(label);
  card.append(icon, labelWrap);
  return card;
}

function setPosition(card: HTMLElement, x: number, y: number) {
  card.dataset.cx = String(x); card.dataset.cy = String(y);
  card.style.left = `${x}px`; card.style.top = `${y}px`;
}

function syncGroups(hooks: EditorHooks, graph: ArchitectureGraph) {
  const groups = new Map(Array.from(hooks.canvas.querySelectorAll<Card>('.dfy-subgraph')).map(group => [group.dataset.id!, group]));
  const ids = new Set(graph.groups.map(group => group.id));
  for (const [id, element] of groups) if (!ids.has(id)) element.remove();
  for (const group of graph.groups) {
    let element = groups.get(group.id);
    if (!element) {
      element = document.createElement('div'); element.className = 'dfy-subgraph';
      const label = document.createElement('div'); label.className = 'dfy-subgraph-label'; element.append(label);
      hooks.canvas.prepend(element);
    }
    element.dataset.id = group.id; element.dataset.subgraph = group.id; element.dataset.label = group.label;
    element.querySelector('.dfy-subgraph-label')!.textContent = group.label;
    element.containedNodes = group.nodeIds.map(id => hooks.cards[id]).filter(Boolean);
    fitGroup(element);
  }
}

function fitGroup(element: Card) {
  const members = element.containedNodes ?? [];
  if (!members.length) { element.style.display = 'none'; return; }
  if (!element.dataset.dfyHidden && !element.dataset.layerHidden) element.style.display = '';
  const left = Math.min(...members.map(card => Number(card.dataset.cx) - card.offsetWidth / 2)) - 24;
  const top = Math.min(...members.map(card => Number(card.dataset.cy) - card.offsetHeight / 2)) - 40;
  const right = Math.max(...members.map(card => Number(card.dataset.cx) + card.offsetWidth / 2)) + 24;
  const bottom = Math.max(...members.map(card => Number(card.dataset.cy) + card.offsetHeight / 2)) + 24;
  Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
}

function syncCards(hooks: EditorHooks, graph: ArchitectureGraph) {
  const ids = new Set(graph.nodes.map(node => node.id));
  for (const [id, card] of Object.entries(hooks.cards)) {
    if (!ids.has(id)) { card.remove(); delete hooks.cards[id]; }
  }
  for (const [index, node] of graph.nodes.entries()) {
    const card = hooks.cards[node.id] ?? createCard(node);
    const changedType = card.dataset.type !== (node.serviceType ?? classifyService(node.label).type);
    if ((card.dataset.label !== node.label || changedType) && hooks.cards[node.id]) {
      const replacement = createCard(node);
      card.querySelector('.dfy-icon')?.replaceWith(replacement.querySelector('.dfy-icon')!);
      card.style.setProperty('--brand', replacement.style.getPropertyValue('--brand'));
      card.style.setProperty('--brand-bg', replacement.style.getPropertyValue('--brand-bg'));
      card.classList.remove(`service-${card.dataset.type}`);
      card.dataset.type = replacement.dataset.type;
      card.classList.add(`service-${card.dataset.type}`);
    }
    card.dataset.id = node.id; card.dataset.nodeId = node.id; card.dataset.label = node.label;
    card.dataset.subgraph = node.groupId ?? '';
    const label = card.querySelector<HTMLElement>('.dfy-label')!;
    if (!label.isContentEditable) label.textContent = node.label;
    label.title = node.label;
    card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `Inspect ${node.label}`);
    const layout = node.layout ?? { x: 80 + index % 5 * 200, y: 80 + Math.floor(index / 5) * 100, width: 160, height: 50 };
    setPosition(card, layout.x + layout.width / 2, layout.y + layout.height / 2);
    hooks.cards[node.id] = card;
    if (!card.isConnected) hooks.canvas.append(card);
  }
}

function withInitialLayout(hooks: EditorHooks): ArchitectureGraph {
  const graph = structuredClone(hooks.initial);
  for (const node of graph.nodes) {
    const card = hooks.cards[node.id];
    if (!card || node.layout) continue;
    node.layout = { x: Number(card.dataset.cx) - card.offsetWidth / 2, y: Number(card.dataset.cy) - card.offsetHeight / 2,
      width: card.offsetWidth, height: card.offsetHeight };
  }
  return graph;
}

/** Connects graph history to delegated browser input. */
export function installEditor(hooks: EditorHooks) {
  const session = createGraphSession(withInitialLayout(hooks));
  const defaults = new Map(session.read().graph.nodes.map(node => [node.id, node.layout]));
  const abort = new AbortController();
  const events = { signal: abort.signal };
  let clipboard: IRNode | undefined;
  let dragging: { element: Card; pointerId: number; x: number; y: number; revision: number; nodes: Card[]; moved: boolean } | undefined;
  let edit: { element: HTMLElement; before: string; id: string; group: boolean; revision: number } | undefined;
  let pending: ArchitectureGraph | undefined;
  function idle() { window.dispatchEvent(new Event('diagramify:idle')); }
  const notice = document.createElement('div');
  notice.id = 'dfy-update-notice'; notice.setAttribute('role', 'status'); notice.hidden = true;
  hooks.canvas.parentElement!.append(notice);

  function report(message: string) { notice.hidden = false; notice.textContent = message; }
  function sync(snapshot: GraphSnapshot) {
    const selected = hooks.selected();
    const selectedId = selected?.dataset.id;
    const selectedEdge = selected?.dataset.edgeKey;
    syncCards(hooks, snapshot.graph); syncGroups(hooks, snapshot.graph);
    if (selected && !selected.isConnected) hooks.select(null);
    if (selectedId) hooks.select(hooks.cards[selectedId] ?? hooks.canvas.querySelector<Card>(`.dfy-subgraph[data-id="${selectedId}"]`));
    hooks.changed(snapshot); hooks.draw();
    if (selectedEdge) requestAnimationFrame(() => hooks.select(hooks.canvas.querySelector<HTMLElement>(`.edge-group[data-edge-key="${selectedEdge}"]`)));
  }
  const unsubscribe = session.subscribe(sync);
  function assertIdle() {
    if (dragging || edit) throw new Error('Finish the current edit before applying an update.');
  }
  function apply(operations: GraphOperation[], revision = session.getRevision()) {
    assertIdle();
    try { return session.apply(operations, revision); }
    catch (error) { sync(session.read()); throw error; }
  }
  function safely(action: () => unknown) {
    try { action(); notice.hidden = true; }
    catch (error) { report(error instanceof Error ? error.message : 'The diagram edit failed.'); }
  }
  function undo(revision: number) { assertIdle(); return session.undo(revision); }
  function redo(revision: number) { assertIdle(); return session.redo(revision); }

  function finishDrag(event: PointerEvent, cancel = false) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const gesture = dragging; dragging = undefined;
    gesture.element.classList.remove('dragging'); hooks.disablePan(false);
    if (gesture.element.hasPointerCapture(event.pointerId)) gesture.element.releasePointerCapture(event.pointerId);
    if (cancel || !gesture.moved) { sync(session.read()); idle(); return; }
    const nodes = new Map(session.read().graph.nodes.map(node => [node.id, node]));
    const operations: GraphOperation[] = gesture.nodes.map(card => {
      const node = nodes.get(card.dataset.id!)!;
      const width = node.layout?.width ?? card.offsetWidth, height = node.layout?.height ?? card.offsetHeight;
      const snap = (value: number) => hooks.snap() ? Math.round(value / 20) * 20 : value;
      return { type: 'node.update', id: node.id, changes: { layout: {
        x: snap(Number(card.dataset.cx)) - width / 2, y: snap(Number(card.dataset.cy)) - height / 2, width, height,
      } } };
    });
    safely(() => apply(operations, gesture.revision));
    idle();
  }

  hooks.canvas.addEventListener('pointerdown', event => {
    const target = event.target as HTMLElement;
    const element = target.closest<Card>('.dfy-node, .dfy-subgraph');
    if (!element || event.button !== 0 || edit || target.closest('.dfy-label, .dfy-subgraph-label, button')) return;
    event.preventDefault(); hooks.select(element); hooks.disablePan(true); element.classList.add('dragging');
    dragging = { element, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      revision: session.getRevision(), nodes: element.classList.contains('dfy-node') ? [element] : element.containedNodes ?? [], moved: false };
    element.setPointerCapture(event.pointerId);
  }, events);
  hooks.canvas.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const dx = (event.clientX - dragging.x) / hooks.getScale(), dy = (event.clientY - dragging.y) / hooks.getScale();
    dragging.x = event.clientX; dragging.y = event.clientY; dragging.moved ||= dx !== 0 || dy !== 0;
    for (const card of dragging.nodes) setPosition(card, Number(card.dataset.cx) + dx, Number(card.dataset.cy) + dy);
    if (dragging.element.classList.contains('dfy-subgraph')) fitGroup(dragging.element);
    hooks.draw(dragging.nodes.map(card => card.dataset.id!));
  }, events);
  hooks.canvas.addEventListener('pointerup', event => finishDrag(event), events);
  hooks.canvas.addEventListener('pointercancel', event => finishDrag(event, true), events);

  function finishEdit(cancel = false) {
    if (!edit) return;
    const current = edit; edit = undefined;
    current.element.contentEditable = 'false';
    const label = cancel ? current.before : current.element.textContent?.trim() || current.before;
    current.element.textContent = label;
    safely(() => apply([current.group ? { type: 'group.update', id: current.id, label } :
      { type: 'node.update', id: current.id, changes: { label } }], current.revision));
    idle();
  }
  hooks.canvas.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const label = target.closest<HTMLElement>('.dfy-label, .dfy-subgraph-label');
    if (!label || !hooks.editing()) return;
    event.stopImmediatePropagation();
    const parent = label.closest<HTMLElement>('[data-id]')!;
    edit = { element: label, id: parent.dataset.id!, before: label.textContent ?? '',
      group: parent.classList.contains('dfy-subgraph'), revision: session.getRevision() };
    label.contentEditable = 'true'; label.focus();
    const range = document.createRange(); range.selectNodeContents(label);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  }, { ...events, capture: true });
  hooks.canvas.addEventListener('focusout', event => { if (event.target === edit?.element) finishEdit(); }, events);

  function deleteSelection() {
    const selected = hooks.selected();
    if (!selected) return;
    const operation = selected.classList.contains('dfy-node') ? { type: 'node.remove' as const, id: selected.dataset.id! } :
      selected.classList.contains('dfy-subgraph') ? { type: 'group.remove' as const, id: selected.dataset.id! } :
      { type: 'edge.remove' as const, id: selected.dataset.edgeKey! };
    apply([operation]); hooks.select(null);
  }
  function paste() {
    if (!clipboard) return;
    const node = structuredClone(clipboard);
    const ids = new Set(session.read().graph.nodes.map(item => item.id));
    let suffix = 1;
    while (ids.has(`${clipboard.id}_copy_${suffix}`)) suffix++;
    node.id = `${clipboard.id}_copy_${suffix}`;
    node.status = 'proposed'; delete node.evidence; delete node.groupId;
    if (node.layout) { node.layout.x += 30; node.layout.y += 30; }
    apply([{ type: 'node.add', node }]); hooks.select(hooks.cards[node.id]);
  }
  document.addEventListener('keydown', event => {
    if (edit && (event.key === 'Enter' || event.key === 'Escape')) { event.preventDefault(); finishEdit(event.key === 'Escape'); return; }
    const target = event.target as HTMLElement;
    if (target.isContentEditable || target.closest('input,textarea,select')) return;
    const key = event.key.toLowerCase(), modified = event.ctrlKey || event.metaKey;
    if (modified && (key === 'z' || key === 'y')) {
      event.preventDefault(); safely(() => key === 'y' || event.shiftKey ? redo(session.getRevision()) : undo(session.getRevision()));
    } else if (!hooks.editing() && ['Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault(); safely(deleteSelection);
    } else if (modified && key === 'c' && hooks.selected()?.classList.contains('dfy-node')) {
      event.preventDefault(); clipboard = session.read().graph.nodes.find(node => node.id === hooks.selected()?.dataset.id);
    } else if (modified && key === 'v' && clipboard) { event.preventDefault(); safely(paste); }
    else if (!modified && (event.key === 'Enter' || event.key === ' ') && target.classList.contains('dfy-node')) {
      event.preventDefault();
      if (hooks.editing()) target.querySelector<HTMLElement>('.dfy-label')?.click();
      else target.click();
    }
  }, events);

  function replace(graph: ArchitectureGraph, expectedRevision: number, preserveEdits = true) {
    assertIdle();
    try { return session.replace(graph, expectedRevision, preserveEdits); }
    catch (error) {
      pending = graph;
      report(error instanceof Error ? error.message : 'The source update failed.');
      const button = document.createElement('button'); button.textContent = 'Replace with source';
      button.addEventListener('click', () => safely(() => { session.replace(pending, session.getRevision(), false); pending = undefined; }));
      notice.append(button); throw error;
    }
  }
  sync(session.read());
  return {
    read: session.read, getRevision: session.getRevision, apply, replace, undo, redo,
    acknowledge: session.acknowledge,
    isEditing: () => Boolean(dragging || edit),
    subscribe: session.subscribe,
    resetLayout() {
      const operations = session.read().graph.nodes.flatMap(node => defaults.get(node.id) ?
        [{ type: 'node.update' as const, id: node.id, changes: { layout: defaults.get(node.id) } }] : []);
      safely(() => apply(operations));
    },
    dispose() { abort.abort(); unsubscribe(); notice.remove(); },
  };
}
