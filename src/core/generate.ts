import type { DiagramifyResult, GenerateOptions, DiagramType } from './types.js';
import { loadConfig } from './config.js';
import { resolveModel, callLLM } from './provider.js';
import { renderDiagram } from './render.js';
import { analyzeCodebase } from './analyze.js';

const SYSTEM_PROMPT = `You are a senior systems architect producing detailed, production-grade Mermaid architecture diagrams.

OUTPUT FORMAT
- Mermaid source only. No markdown fences. No commentary.
- Start with "flowchart LR" for typical service architectures (or "flowchart TD" only when the graph is naturally vertical, e.g. layered pipelines).
- IDs: alphanumeric + underscore only.
- Labels in square brackets: A[PostgreSQL]. Use the canonical service name VERBATIM — "PostgreSQL" not "Database", "Redis" not "Cache", "Kafka" not "Message Broker". Diagramify's icon registry matches by exact label, so generic words lose the brand icon.

DEPTH — favor completeness over brevity. 20-60 nodes is the right range for any non-trivial system.
- Every database, cache, queue, and message broker actually used.
- Every external service the code talks to (Stripe, Auth0, OpenAI, Anthropic, Twilio, SendGrid, Segment, etc.).
- Every observability component (Prometheus, Grafana, Datadog, Sentry, OpenTelemetry, New Relic).
- Every edge layer (CloudFront, Cloudflare, Vercel Edge, Fastly).
- Every CI/CD and runtime concern (Docker, Kubernetes, GitHub Actions, GitLab CI, Terraform).
- Frontend frameworks as their own nodes (React, Next.js, Vue, Svelte).
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
- Generic labels: "Database", "Service", "Cache", "Queue", "API", "Backend".
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

  if (options.input === 'codebase') {
    const path = options.path || process.cwd();
    const analysis = await analyzeCodebase(path);
    contextSummary = analysis.summary;
  } else if (options.input === 'description') {
    contextSummary = options.description || '';
  }

  const diagramTypeSpec =
    options.diagramType && options.diagramType !== 'auto'
      ? `Use the "${options.diagramType}" diagram type.`
      : 'Choose the most appropriate diagram type based on the content.';

  const userPrompt = `${diagramTypeSpec}

${contextSummary}

${options.extraContext ? `Additional instructions: ${options.extraContext}` : ''}

Generate a Mermaid diagram representing the above.`;

  const llmResult = await callLLM(
    model,
    SYSTEM_PROMPT,
    userPrompt,
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
    throw new Error(
      `Generated Mermaid source is invalid even after correction:\n${mermaidSource}`,
    );
  }

  const formats = options.config?.defaultOutput || config.defaultOutput || ['svg', 'mmd'];
  const renderResult = await renderDiagram(mermaidSource, formats, {
    theme: config.theme,
    darkMode: config.darkMode,
  });

  return {
    ...renderResult,
    tokensUsed: llmResult.tokensUsed,
  };
}
