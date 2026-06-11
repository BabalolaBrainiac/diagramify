import type { DiagramifyResult, GenerateOptions } from './types.js';
import { loadConfig } from './config.js';
import { resolveModel, callLLM } from './provider.js';
import { renderDiagram } from './render.js';
import { analyzeCodebase } from './analyze.js';

const SYSTEM_PROMPT = `You are a senior systems architect producing detailed, production-grade Mermaid architecture diagrams.

OUTPUT FORMAT
- Mermaid source only. No markdown fences. No commentary.
- IDs: alphanumeric + underscore only.
- For flowcharts, use the canonical service name VERBATIM — "PostgreSQL" not "Database", "Redis" not "Cache".
- DO NOT use special node shapes (cylinders, circles, hexagons) in flowcharts. Only use the default rectangle shape [ and ].
- If requested or if the architecture implies a temporal flow, use sequenceDiagram or other appropriate Mermaid types.

DEPTH — favor completeness over brevity. 20-60 nodes is the right range for any non-trivial system.
- Every database, cache, queue, and message broker actually used.
- Every external service the code talks to (Stripe, Auth0, OpenAI, Anthropic, Twilio, SendGrid, Segment, etc.).
- Every observability component (Prometheus, Grafana, Datadog, Sentry, OpenTelemetry, New Relic).
- Every edge layer (CloudFront, Cloudflare, Vercel Edge, Fastly).
- Every CI/CD and runtime concern (Docker, Kubernetes, GitHub Actions, GitLab CI, Terraform).
- Frontend frameworks as their own nodes (React, Next.js, Vue, Svelte).
- Monorepos and Microservices: Map internal module dependencies accurately. Represent each microservice or module as a specific node. Do not lump all internal code into one generic "Backend" node. Instead, explicitly define internal service nodes (e.g., "AccountConfigAuth", "CoreService", etc.) and the interactions between them.
- For codebases: scan package.json / requirements.txt / go.mod / Cargo.toml / Gemfile / pom.xml for ALL dependencies that imply external services or infrastructure.

GROUPING — always use subgraphs. Pick from this set; add domain-specific ones when warranted; omit empty groups.
  subgraph frontend [Frontend]           ← UI frameworks, mobile clients
  subgraph edge [Edge / CDN]             ← CloudFront, Cloudflare, gateway
  subgraph backend [Backend Services]    ← APIs, workers, microservices
  subgraph data [Data Layer]             ← databases, object stores
  subgraph cache [Cache]                 ← Redis, Memcached
  subgraph messaging [Streaming]         ← Kafka, RabbitMQ, SQS, NATS
  subgraph observability [Observability] ← monitoring, logging, tracing
  subgraph ai [AI Providers]             ← OpenAI, Anthropic, Cohere
  subgraph auth [Auth]                   ← Auth0, Cognito, Clerk
  subgraph external [External APIs]      ← Stripe, Twilio, etc.

EDGES — every edge tells a story.
- Solid:  A -->|REST| B            for synchronous HTTP / gRPC / SQL / cache lookups
- Dashed: A -.->|events| B         for async / pub-sub / queues / webhooks / event-driven
- Always LABEL the edge with what crosses it: REST, gRPC, SQL, events, webhook, scrapes, cache, inference, SSR, OIDC, OAuth.

ANTI-PATTERNS — do not do these.
- Generic labels: "Database", "Service", "Cache", "Queue", "API", "Backend", "Frontend". Use specific, precise names.
- Lumping multiple internal microservices into one node. They must be separate nodes to show internal architecture.
- Lumping multiple services into one node: split "AWS" into the specific services (Lambda, S3, RDS).
- Skipping observability or auth because they are "boring infrastructure" — include them.
- Fewer than 15 nodes for any non-trivial codebase.
- Unlabeled edges when a label would clarify the protocol or async/sync semantics.`;

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:mermaid)?\n?|\n?```$/gm, '').trim();
}

function validateMermaidSource(source: string): boolean {
  const trimmed = source.trim();

  const validStarts = [
    'flowchart',
    'graph',
    'sequenceDiagram',
    'classDiagram',
    'erDiagram',
    'stateDiagram',
    'xychart-beta',
  ];

  return validStarts.some((start) => trimmed.toLowerCase().startsWith(start.toLowerCase()));
}

async function retryWithCorrection(
  model: any,
  invalidSource: string,
  systemPrompt: string,
): Promise<string> {
  const correctionPrompt = `The following Mermaid source is invalid:\n\n${invalidSource}\n\nFix it and return ONLY the corrected Mermaid source, no explanation:`;

  const result = await callLLM(model, systemPrompt, correctionPrompt);

  return stripMarkdownFences(result.text);
}

export async function generateDiagram(options: GenerateOptions): Promise<DiagramifyResult> {
  const config = await loadConfig(options.config);
  const model = resolveModel(config);

  let contextSummary = '';
  let analysis: any = null;

  if (options.input === 'codebase') {
    const path = options.path || process.cwd();
    analysis = await analyzeCodebase(path);
    contextSummary = analysis.summary;
  } else if (options.input === 'description') {
    contextSummary = options.description || '';
  }

  const diagramTypeSpec =
    options.diagramType && options.diagramType !== 'auto'
      ? `Use the "${options.diagramType}" diagram type.`
      : 'Choose the most appropriate diagram type based on the content.';
  const startInstruction =
    options.diagramType === 'flowchart'
      ? `Start the diagram with "flowchart ${config.direction || 'LR'}".`
      : options.diagramType && options.diagramType !== 'auto'
        ? 'Start with the canonical Mermaid declaration for the requested diagram type.'
        : `Start with the canonical declaration for the chosen diagram type. If it is a flowchart, use direction "${config.direction || 'LR'}".`;

  const serviceHint = analysis?.detectedServices?.length > 0
    ? `\nDetected services in codebase: ${analysis.detectedServices.join(', ')}. Use these exact names as node labels for icon matching.`
    : '';

  const endpointHint = analysis?.apiEndpoints?.length > 0
    ? `\nDetected API endpoints: ${analysis.apiEndpoints.slice(0, 10).map((e: any) => `${e.method ?? 'ANY'} ${e.path}`).join(', ')}.`
    : '';

  const dirHint = analysis?.serviceDirectories?.length > 0
    ? `\nService directories detected: ${analysis.serviceDirectories.join(', ')}. Create subgraphs for each.`
    : '';

  const linksHint = analysis?.internalLinks?.length > 0
    ? `\nInternal Monorepo links detected (A depends on B): ${analysis.internalLinks.map((l: any) => `${l.from} -> ${l.to}`).join(', ')}.`
    : '';

  const userPrompt = `${diagramTypeSpec}

${contextSummary}
${serviceHint}${endpointHint}${dirHint}${linksHint}

${options.extraContext ? `Additional instructions: ${options.extraContext}` : ''}

Generate a Mermaid diagram representing the above.
IMPORTANT: ${startInstruction}`;

  const llmResult = await callLLM(
    model,
    SYSTEM_PROMPT,
    userPrompt,
    config.maxTokens,
    config.temperature,
  );

  let mermaidSource = stripMarkdownFences(llmResult.text);
  
  if (mermaidSource.startsWith('flowchart') || mermaidSource.startsWith('graph')) {
    mermaidSource = mermaidSource
      .replace(/\[\(([^)]+)\)\]/g, '[$1]')   // cylinders
      .replace(/\(\(([^)]+)\)\)/g, '[$1]')   // circles
      .replace(/\{([^{}]+)\}/g, '[$1]')      // diamonds
      .replace(/>([^\]]+)\]/g, '[$1]')       // flags
      .replace(/\(\[([^\]]+)\]\)/g, '[$1]'); // stadiums
  }

  if (!validateMermaidSource(mermaidSource)) {
    const corrected = await retryWithCorrection(model, mermaidSource, SYSTEM_PROMPT);
    if (validateMermaidSource(corrected)) {
      mermaidSource = corrected;
    }
  }

  if (!validateMermaidSource(mermaidSource)) {
    throw new Error(
      `Generated Mermaid source is invalid even after correction:\n${mermaidSource}`,
    );
  }

  // Add layout directives after validation so corrected source is what gets rendered.
  let finalMermaidSource = mermaidSource;
  if (finalMermaidSource.startsWith('flowchart') || finalMermaidSource.startsWith('graph')) {
    finalMermaidSource = `%%{init: {"flowchart": {"nodeSpacing": 100, "rankSpacing": 150}}}%%\n${finalMermaidSource}`;
  }

  const formats = options.config?.defaultOutput || config.defaultOutput || ['svg', 'mmd'];
  const renderResult = await renderDiagram(finalMermaidSource, formats, {
    theme: config.theme,
    darkMode: config.darkMode,
  });

  return {
    ...renderResult,
    mermaid: finalMermaidSource, // override with directive
    tokensUsed: llmResult.tokensUsed,
  };
}
