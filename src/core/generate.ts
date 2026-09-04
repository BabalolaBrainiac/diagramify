import type { DiagramifyResult, GenerateOptions } from './types.js';
import { loadConfig } from './config.js';
import {
  resolveModel,
  resolveProviderAndModel,
  callLLM,
  callLLMForObject,
  hasCredentials,
} from './provider.js';
import { renderDiagram } from './render.js';
import { basename, resolve } from 'path';
import { analyzeCodebase } from './analyze.js';
import {
  type ArchitectureGraph,
  architectureGraphSchema,
  normalizeGraph,
  validateGraph,
} from './ir.js';
import { graphToMermaid, mermaidToGraph } from './ir-mermaid.js';
import { analysisToGraph } from './ir-analyzer.js';
import { summarizeEvidence } from './evidence.js';

/**
 * Prompt for schema-constrained output.
 *
 * It is far shorter than the free-text prompt below, because the schema already
 * states the shape. The prompt only has to say what to include, not how to
 * format it. That is why the result no longer changes with the provider.
 */
const IR_SYSTEM_PROMPT = `You are a senior systems architect. You map a system into a structured graph.

COVERAGE - favour completeness. 20 to 60 nodes suits any non-trivial system.
- Every database, cache, queue, and message broker the code actually uses.
- Every external service the code calls: Stripe, Auth0, OpenAI, Twilio, SendGrid.
- Every observability component: Prometheus, Grafana, Datadog, Sentry, OpenTelemetry.
- Every edge component: CloudFront, Cloudflare, Vercel Edge, Fastly.
- Every frontend framework, as its own node.
- Each microservice or module as its own node. Never merge them into one node.

NAMES - use the real product name. Write "PostgreSQL", not "Database". Write
"Redis", not "Cache". Split a cloud provider into the services in use, such as
Lambda, S3, and RDS.

GROUPS - place every node in a tier: Frontend, Edge, Backend Services, Data
Layer, Cache, Messaging, Observability, Auth, AI Providers, External.

EDGES - every node needs at least one edge. Label each edge with what crosses
it: REST, gRPC, SQL, events, webhook, OIDC, inference. Mark a queue, an event,
and a webhook as "async". Wire a layered module explicitly: presentation calls
application, application calls domain and infrastructure, infrastructure reaches
the store.

DEPTH - a shallow diagram is a failed diagram. When the prompt lists confirmed
components, every one of them must appear as a node, wired to whatever uses it.
Split a layered module into the layers the code actually has. Show a worker, a
scheduler, and a consumer separately from the service that enqueues to them.
Name the concrete component, not the category: "Kinde", not "Auth Provider".

Return the graph only. Add no commentary.`;

const SYSTEM_PROMPT = `You are a senior systems architect. Produce detailed, production-grade architecture diagrams in Mermaid format.

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

EDGES — this is the most critical part. Every node MUST have at least one edge. No floating isolated nodes.
- Solid:  A -->|REST| B            for synchronous HTTP / gRPC / SQL / cache lookups
- Dashed: A -.->|events| B         for async / pub-sub / queues / webhooks / event-driven
- Always LABEL the edge with what crosses it: REST, gRPC, SQL, events, webhook, scrapes, cache, inference, SSR, OIDC, OAuth, calls, uses, imports.

INTRA-BACKEND WIRING (critical — this is always missing and must be explicit):
- For every module or service that follows Clean Architecture / DDD / layered architecture (Presentation → Application → Domain → Infrastructure), you MUST wire those layers explicitly:
    ModuleX_Presentation -->|calls| ModuleX_Application
    ModuleX_Application -->|calls| ModuleX_Domain
    ModuleX_Application -->|calls| ModuleX_Infrastructure
    ModuleX_Infrastructure -->|SQL| PostgreSQL
- The API host MUST have edges INTO each module's presentation or controller layer.
- Shared/Common layers (Common.Application, Common.Domain, Common.Infrastructure) must be explicitly connected FROM each module that depends on them:
    ModuleX_Application -->|uses| Common_Application
    ModuleX_Domain -->|extends| Common_Domain
- Middleware components must connect from the host to whatever they validate against (e.g. AuthMiddleware -->|OIDC| Keycloak).
- Workers, consumers, and background jobs must connect to the queues or schedulers they consume from.
- Do NOT leave any node floating without at least one incoming or outgoing edge.

ANTI-PATTERNS — do not do these.
- Generic labels: "Database", "Service", "Cache", "Queue", "API", "Backend", "Frontend". Use specific, precise names.
- Lumping multiple internal microservices into one node. They must be separate nodes to show internal architecture.
- Lumping multiple services into one node: split "AWS" into the specific services (Lambda, S3, RDS).
- Skipping observability or auth because they are "boring infrastructure" — include them.
- Fewer than 15 nodes for any non-trivial codebase.
- Unlabeled edges when a label would clarify the protocol or async/sync semantics.
- Nodes that have ZERO edges. Every node must be connected.`;

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

/** Builds the graph, then renders it. The graph is the product; formats follow. */
export async function generateGraph(
  options: GenerateOptions,
): Promise<{ graph: ArchitectureGraph; tokensUsed: number }> {
  const config = await loadConfig(options.config);

  let analysis: Awaited<ReturnType<typeof analyzeCodebase>> | null = null;
  let contextSummary = '';
  const title = options.path ? basename(resolve(options.path)) : undefined;
  // Mermaid treats TB and TD as the same direction. The IR keeps one name.
  const direction = (config.direction === 'TB' ? 'TD' : config.direction) ?? 'LR';

  if (options.input === 'codebase') {
    analysis = await analyzeCodebase(options.path || process.cwd());
    contextSummary = analysis.summary;
  } else {
    contextSummary = options.description || '';
  }

  // Path 1: no model. The analyzer alone fills the graph.
  if (options.noLLM) {
    if (!analysis) {
      throw new Error(
        'Offline mode needs a codebase to analyze. Pass --path, or drop --no-llm to use a description.',
      );
    }
    return {
      graph: analysisToGraph(analysis, { title, direction }),
      tokensUsed: 0,
    };
  }

  if (!hasCredentials(config)) {
    throw new Error(
      'No provider key found. Set a key for Anthropic, OpenAI, or Google, ' +
        'or run with --no-llm to build the diagram from the codebase alone.',
    );
  }

  // Ask the provider which models this key reaches, and take the newest that
  // fits the tier. A name pinned at release time goes stale; this does not.
  const resolved = await resolveProviderAndModel(config, (notice) => console.error(notice));
  const model = resolved.model;
  console.error(`Using ${resolved.provider} / ${resolved.modelId}`);

  const userPrompt = buildUserPrompt(contextSummary, analysis, options, direction);

  // Path 2: schema-constrained output. This is the default.
  try {
    const result = await callLLMForObject(
      model,
      IR_SYSTEM_PROMPT,
      userPrompt,
      architectureGraphSchema,
      config.maxTokens,
      config.temperature,
    );

    const graph = normalizeGraph(result.object, {
      source: config.provider,
      language: analysis?.language,
      framework: analysis?.framework,
    });
    graph.title = graph.title ?? title;

    if (graph.nodes.length > 0) {
      return { graph, tokensUsed: result.tokensUsed };
    }
  } catch (error) {
    // A provider without structured output support falls through to text.
    if (process.env.DIAGRAMIFY_DEBUG) {
      console.error('Structured output failed, falling back to text:', error);
    }
  }

  // Path 3: free-text Mermaid. Kept only for a provider that cannot do path 2.
  const textResult = await generateMermaidByText(model, userPrompt, config);
  const graph = mermaidToGraph(textResult.mermaid, title);
  graph.meta = { source: `${config.provider} (text fallback)`, language: analysis?.language };

  return { graph, tokensUsed: textResult.tokensUsed };
}

export async function generateDiagram(options: GenerateOptions): Promise<DiagramifyResult> {
  const config = await loadConfig(options.config);
  const { graph, tokensUsed } = await generateGraph(options);

  const problems = validateGraph(graph);
  if (problems.length > 0 && process.env.DIAGRAMIFY_DEBUG) {
    console.error(`Graph warnings:\n  ${problems.join('\n  ')}`);
  }

  const mermaidSource = graphToMermaid(graph);
  const formats = options.config?.defaultOutput || config.defaultOutput || ['svg', 'mmd'];

  const renderResult = await renderDiagram(mermaidSource, formats, {
    theme: config.theme,
    darkMode: config.darkMode,
    backgroundColor: config.backgroundColor,
    offlineMode: config.offlineMode,
    title: graph.title,
    graph,
  });

  return {
    ...renderResult,
    mermaid: mermaidSource,
    graph,
    tokensUsed,
  };
}

function buildUserPrompt(
  contextSummary: string,
  analysis: Awaited<ReturnType<typeof analyzeCodebase>> | null,
  options: GenerateOptions,
  direction: string,
): string {
  const hints: string[] = [];

  if (analysis?.detectedServices?.length) {
    hints.push(
      `Services detected in the codebase: ${analysis.detectedServices.join(', ')}. ` +
        'Use these exact names as node labels, so icons match.',
    );
  }
  if (analysis?.apiEndpoints?.length) {
    hints.push(
      `API endpoints detected: ${analysis.apiEndpoints
        .slice(0, 10)
        .map((e) => `${e.method ?? 'ANY'} ${e.path}`)
        .join(', ')}.`,
    );
  }
  if (analysis?.serviceDirectories?.length) {
    hints.push(`Confirmed internal components: ${analysis.serviceDirectories.join(', ')}. Give each one a node.`);
  }
  // Evidence is the strongest signal available. It names a component and the
  // file that proves it, so the model wires a real thing rather than a guess.
  if (analysis?.evidence?.length) {
    const lines = summarizeEvidence(analysis.evidence);
    hints.push(
      'CONFIRMED components, each proved by a file in the repository. Include ' +
        `every one of these as a node:\n${lines.map((l) => `  - ${l}`).join('\n')}`,
    );
  }
  if (analysis?.internalLinks?.length) {
    hints.push(
      `Internal dependencies (A depends on B): ${analysis.internalLinks
        .map((l) => `${l.from} -> ${l.to}`)
        .join(', ')}.`,
    );
  }
  if (analysis?.serviceLinks?.length) {
    hints.push(
      'Confirmed runtime connections. Preserve each source, target, label, and edge type:\n' +
        analysis.serviceLinks
          .slice(0, 80)
          .map((link) =>
            `  - ${link.from} -> ${link.to} [${link.label}, ${link.kind}; proved by ${link.source}]`,
          )
          .join('\n'),
    );
  }

  return [
    contextSummary,
    hints.join('\n'),
    options.extraContext ? `Additional instructions: ${options.extraContext}` : '',
    `Use direction "${direction}".`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The old text path. Reached only when a provider cannot fill a schema. */
async function generateMermaidByText(
  model: ReturnType<typeof resolveModel>,
  userPrompt: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<{ mermaid: string; tokensUsed: number }> {
  const llmResult = await callLLM(
    model,
    SYSTEM_PROMPT,
    `${userPrompt}\n\nGenerate a Mermaid diagram representing the above.`,
    config.maxTokens,
    config.temperature,
  );

  let mermaidSource = stripMarkdownFences(llmResult.text);

  if (!validateMermaidSource(mermaidSource)) {
    const corrected = await retryWithCorrection(model, mermaidSource, SYSTEM_PROMPT);
    if (validateMermaidSource(corrected)) {
      mermaidSource = corrected;
    }
  }

  if (!validateMermaidSource(mermaidSource)) {
    throw new Error(`Generated Mermaid source is invalid even after correction:\n${mermaidSource}`);
  }

  return { mermaid: mermaidSource, tokensUsed: llmResult.tokensUsed };
}
