import React, { useEffect, useRef, useState } from 'react';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { generateInteractiveHTML, type HTMLGeneratorOptions } from '../core/html.js';
import { graphToMermaid, mermaidToGraph } from '../core/ir-mermaid.js';
import { attachLayout } from '../core/ir-layout.js';
import type { GraphSnapshot } from '../core/graph-session.js';
import type { installEditor } from '../viewer/editor.js';

type ViewerController = ReturnType<typeof installEditor>;
type ViewerWindow = Window & { diagramify?: ViewerController };

export interface DiagramViewerProps extends Omit<HTMLGeneratorOptions, 'width' | 'height'> {
  mermaidSource: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  onError?: (error: Error) => void;
  onChange?: (snapshot: GraphSnapshot) => void;
}

/** Keeps the iframe document and its edit history across source updates. */
export function DiagramViewer({ mermaidSource, width = '100%', height = '600px', className = '', onError, onChange, ...options }: DiagramViewerProps) {
  const [initialHTML, setInitialHTML] = useState('');
  const [errorText, setErrorText] = useState('');
  const iframe = useRef<HTMLIFrameElement>(null);
  const initialized = useRef(false);
  const initialRequest = useRef<{ source: string; optionsKey: string }>();
  const pending = useRef<{ source: string; options: HTMLGeneratorOptions }>();
  const unsubscribe = useRef<() => void>();
  const callbacks = useRef({ onError, onChange });
  const previousTheme = useRef<string>();
  callbacks.current = { onError, onChange };
  const optionsKey = JSON.stringify(options);

  function report(error: unknown) {
    const failure = error instanceof Error ? error : new Error('The diagram update failed.');
    setErrorText(failure.message); callbacks.current.onError?.(failure);
  }
  function applyPending() {
    const frame = iframe.current?.contentWindow as ViewerWindow | null;
    const next = pending.current;
    if (!frame?.diagramify || !next || frame.diagramify.isEditing()) return;
    try {
      const current = frame.diagramify.read();
      const graph = next.options.graph ?? mermaidToGraph(next.source, next.options.title);
      if (!next.options.graph) {
        const previous = new Map(current.graph.nodes.map(node => [node.id, node]));
        for (const node of graph.nodes) node.layout = previous.get(node.id)?.layout;
      }
      const laidOut = attachLayout(graph, renderMermaidSVG(graphToMermaid(graph)), true);
      frame.diagramify.replace(laidOut, current.revision);
      const theme = next.options.theme ?? (next.options.darkMode ? 'dark' : 'light');
      configure(frame, next.options, theme !== previousTheme.current ? theme : undefined);
      previousTheme.current = theme;
      pending.current = undefined; setErrorText('');
    } catch (error) { report(error); }
  }

  function configure(frame: ViewerWindow, value: HTMLGeneratorOptions, theme?: string) {
    const event = frame.document.createEvent('CustomEvent');
    event.initCustomEvent('diagramify:options', false, false, {
      theme, title: value.title ?? 'Architecture Diagram',
      showMinimap: value.showMinimap !== false, showSearch: value.showSearch !== false,
      showLayerPanel: value.showLayerPanel !== false, showNodeDetail: value.showNodeDetail !== false,
    });
    frame.dispatchEvent(event);
  }

  useEffect(() => {
    const nextOptions: HTMLGeneratorOptions = JSON.parse(optionsKey);
    pending.current = { source: mermaidSource, options: nextOptions };
    if (initialized.current) { applyPending(); return; }
    try {
      const graph = nextOptions.graph ?? mermaidToGraph(mermaidSource, nextOptions.title);
      const svg = renderMermaidSVG(nextOptions.graph ? graphToMermaid(graph) : mermaidSource);
      setInitialHTML(generateInteractiveHTML(svg, mermaidSource, { ...nextOptions, graph,
        showMinimap: true, showSearch: true, showLayerPanel: true, showNodeDetail: true }));
      initialRequest.current = { source: mermaidSource, optionsKey };
      previousTheme.current = nextOptions.theme ?? (nextOptions.darkMode ? 'dark' : 'light');
      initialized.current = true; setErrorText('');
    } catch (error) { report(error); }
  }, [mermaidSource, optionsKey]);

  useEffect(() => () => { unsubscribe.current?.(); }, []);

  function loaded() {
    const frame = iframe.current?.contentWindow as ViewerWindow | null;
    unsubscribe.current?.();
    if (frame?.diagramify) {
      unsubscribe.current = frame.diagramify.subscribe(snapshot => callbacks.current.onChange?.(snapshot));
      frame.addEventListener('diagramify:idle', applyPending);
      if (pending.current?.source === initialRequest.current?.source && JSON.stringify(pending.current?.options) === initialRequest.current?.optionsKey) {
        configure(frame, pending.current!.options);
        pending.current = undefined;
      } else applyPending();
    }
  }
  return <div className={`diagramify-viewer-container ${className}`.trim()}
    style={{ width, height, position: 'relative', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
    {errorText && <div role="alert" style={{ position: 'absolute', top: 0, zIndex: 20, background: '#fff', color: '#991b1b', padding: 8 }}>{errorText}</div>}
    {!initialHTML && !errorText && <div role="status">Loading diagram...</div>}
    {initialHTML && <iframe ref={iframe} srcDoc={initialHTML} onLoad={loaded}
      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      title={options.title ?? 'Architecture Diagram'} sandbox="allow-scripts allow-same-origin" />}
  </div>;
}
