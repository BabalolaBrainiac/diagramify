/** Updates a running viewer without replacing its document. */
function connectLiveViewer() {
  const target = window as unknown as { diagramify?: {
    read(): { revision: number; graph: unknown };
    getRevision(): number;
    replace(graph: unknown, revision: number, preserve?: boolean): unknown;
    acknowledge(graph: unknown, revision: number): void;
    isEditing(): boolean;
    subscribe(listener: (value: { graph: unknown }) => void): () => void;
  } };
  if (!target.diagramify || !['http:', 'https:'].includes(location.protocol)) return;
  const editor = target.diagramify;
  let socket: WebSocket, revision = 0, ready = false, inFlight = false, suppress = false, blocked = false;
  let pending: unknown;
  let deferred: unknown;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const status = document.createElement('div');
  status.id = 'dfy-live-status'; status.setAttribute('role', 'status');
  Object.assign(status.style, { position: 'fixed', right: '20px', top: '70px', zIndex: '50', padding: '8px', background: 'var(--surface)', color: 'var(--text)' });
  document.body.append(status);
  function show(text: string) { status.replaceChildren(document.createTextNode(text)); }
  function send() {
    if (!ready || inFlight || blocked || deferred || !pending || socket.readyState !== WebSocket.OPEN) return;
    const graph = pending; pending = undefined; inFlight = true;
    socket.send(JSON.stringify({ type: 'edit', expectedRevision: revision, graph }));
    show('Saving changes...');
  }
  function apply(graph: unknown, preserve = true) {
    suppress = true;
    try { editor.replace(graph, editor.getRevision(), preserve); }
    finally { suppress = false; }
  }
  function conflict(graph: unknown) {
    blocked = true;
    const notice = document.getElementById('dfy-update-notice');
    if (notice) notice.hidden = true;
    show('The shared graph changed. Your edits remain in this viewer.');
    const useShared = document.createElement('button'); useShared.textContent = 'Use shared graph';
    useShared.onclick = () => {
      try { apply(graph, false); pending = undefined; blocked = false; show('Connected'); }
      catch { show('Finish the current edit. Then reconnect to load the shared graph.'); }
    };
    status.append(useShared);
  }
  function receive(graph: unknown) {
    if (editor.isEditing()) { deferred = graph; show('Source update pending. Finish the current edit.'); return; }
    if (blocked) { conflict(graph); return; }
    try {
      apply(graph);
      if (pending) pending = editor.read().graph;
      show('Connected'); send();
    } catch { conflict(graph); }
  }
  window.addEventListener('diagramify:idle', () => {
    if (deferred) { const graph = deferred; deferred = undefined; receive(graph); }
  });
  function connect() {
    const address = new URL('/updates', location.href);
    address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(address);
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'error') { show('The source update failed. The current diagram is available.'); return; }
        if (!Number.isInteger(message.revision) || message.revision < 0) throw new Error('Invalid graph revision.');
        revision = message.revision;
        if (message.type === 'ack') {
          editor.acknowledge(message.graph, editor.getRevision());
          inFlight = false; show('Saved'); send(); return;
        }
        if (message.type === 'rejected' || message.type === 'conflict') { inFlight = false; conflict(message.graph); return; }
        if (message.type !== 'graph') return;
        ready = true;
        receive(message.graph);
      } catch { show('The viewer received an invalid update.'); }
    };
    socket.onclose = () => {
      ready = false;
      if (inFlight) { pending = editor.read().graph; inFlight = false; }
      show('Disconnected. Local edits remain available.');
      retry = setTimeout(connect, 1000);
    };
  }
  const unsubscribe = editor.subscribe(snapshot => {
    if (suppress) return;
    pending = snapshot.graph; send();
  });
  window.addEventListener('pagehide', () => {
    unsubscribe(); clearTimeout(retry); socket.onclose = null; socket.close();
  }, { once: true });
  connect();
}

export function liveClientScript(): string {
  return `<script>(${connectLiveViewer.toString()})();</script>`;
}
