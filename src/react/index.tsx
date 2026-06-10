import React, { useEffect, useRef, useState } from 'react';
import { renderDiagram } from '../core/render.js';
import { generateInteractiveHTML, HTMLGeneratorOptions } from '../core/html.js';

export interface DiagramViewerProps extends Omit<HTMLGeneratorOptions, 'offlineMode' | 'width' | 'height'> {
  /** The raw Mermaid source code (e.g. `flowchart LR ...`) */
  mermaidSource: string;
  /** Width of the iframe wrapper (e.g. '100%', '800px') */
  width?: string | number;
  /** Height of the iframe wrapper (e.g. '600px') */
  height?: string | number;
  /** Additional CSS class names */
  className?: string;
  /** Callback fired when generation fails */
  onError?: (error: Error) => void;
}

export function DiagramViewer({
  mermaidSource,
  width = '100%',
  height = '600px',
  className = '',
  onError,
  ...options
}: DiagramViewerProps) {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function generate() {
      try {
        setLoading(true);
        // Render the diagram to extract SVG for the HTML generator
        const result = await renderDiagram(mermaidSource, ['svg'], {
          theme: options.theme,
          darkMode: options.darkMode,
        });

        if (!result.svg) {
          throw new Error('Failed to generate SVG from Mermaid source.');
        }

        const html = generateInteractiveHTML(result.svg, mermaidSource, options);
        
        if (isMounted) {
          setHtmlContent(html);
        }
      } catch (err: any) {
        if (isMounted) {
          if (onError) onError(err);
          else console.error('DiagramViewer error:', err);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    generate();
    
    return () => {
      isMounted = false;
    };
  }, [mermaidSource, JSON.stringify(options)]);

  return (
    <div 
      className={`diagramify-viewer-container ${className}`.trim()} 
      style={{ width, height, position: 'relative', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}
    >
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.8)', zIndex: 10 }}>
          <span>Loading diagram...</span>
        </div>
      )}
      {!loading && htmlContent && (
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          title="Architecture Diagram"
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
