/**
 * Deep evidence collection.
 *
 * The dependency list alone gives a shallow picture. A real system also states
 * what it uses in its environment file, its container file, its deployment
 * descriptor, and its infrastructure code. This module reads those, so the
 * diagram shows the components that actually exist.
 *
 * Safety: an environment file is read for variable NAMES only. A value is never
 * read, never stored, and never sent to a provider.
 */

import { readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import fastGlob from 'fast-glob';

type GlobPatterns = Parameters<typeof fastGlob>[0];
type GlobOptions = NonNullable<Parameters<typeof fastGlob>[1]>;

/**
 * fast-glob follows symbolic links by default. A symlink inside an analyzed
 * codebase could point outside the codebase root, at a real secret file
 * (see the class-level note above on why env values are never read — a
 * followed symlink named like an env/infra file would bypass that filename
 * based care). Every glob call in this file goes through this wrapper so
 * symlinks are never followed.
 */
function glob(patterns: GlobPatterns, options: GlobOptions = {}): Promise<string[]> {
  return fastGlob(patterns, { ...options, followSymbolicLinks: false });
}

export interface Evidence {
  /** Service name, as the icon registry spells it. */
  service: string;
  /** Where the proof was found, so a reader can check it. */
  source: string;
  /** The exact token that matched, never a secret value. */
  hint: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Environment variable names
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Maps an environment variable name to the component it proves.
 *
 * A name is strong evidence. `KINDE_CLIENT_ID` means the system authenticates
 * through Kinde, whatever the dependency file says.
 */
export const ENV_NAME_PATTERNS: Array<{ pattern: RegExp; service: string }> = [
  // Data stores
  { pattern: /\b(POSTGRES|PG_(URI|HOST|USER)|PGHOST)\b/i, service: 'PostgreSQL' },
  { pattern: /\bMYSQL|MARIADB\b/i, service: 'MySQL' },
  { pattern: /\bMONGO(DB)?_(URI|URL|HOST)\b/i, service: 'MongoDB' },
  { pattern: /\bREDIS_(URL|URI|HOST|TLS)\b/i, service: 'Redis' },
  { pattern: /\bMEMCACHED?_/i, service: 'Memcached' },
  { pattern: /\bDYNAMODB|DYNAMO_TABLE\b/i, service: 'DynamoDB' },
  { pattern: /\bCASSANDRA|SCYLLA\b/i, service: 'Cassandra' },
  { pattern: /\bCLICKHOUSE\b/i, service: 'ClickHouse' },
  { pattern: /\bELASTIC(SEARCH)?_|OPENSEARCH_/i, service: 'Elasticsearch' },
  { pattern: /\bNEON_/i, service: 'Neon' },
  { pattern: /\bPLANETSCALE_/i, service: 'PlanetScale' },
  { pattern: /\bSUPABASE_(URL|KEY|ANON)/i, service: 'Supabase' },
  { pattern: /\bUPSTASH_/i, service: 'Upstash' },
  { pattern: /\bSNOWFLAKE_/i, service: 'Snowflake' },
  { pattern: /\bBIGQUERY_/i, service: 'BigQuery' },

  // Messaging
  { pattern: /\bKAFKA_|CONFLUENT_/i, service: 'Kafka' },
  { pattern: /\bRABBITMQ_|AMQP_/i, service: 'RabbitMQ' },
  { pattern: /\bSQS_|AWS_SQS/i, service: 'Amazon SQS' },
  { pattern: /\bSNS_TOPIC|AWS_SNS/i, service: 'Amazon SNS' },
  { pattern: /\bNATS_/i, service: 'NATS' },
  { pattern: /\bPUBSUB_|GOOGLE_PUBSUB/i, service: 'Google Pub/Sub' },
  { pattern: /\bTEMPORAL_/i, service: 'Temporal' },
  { pattern: /\bCELERY_|BROKER_URL/i, service: 'Celery' },

  // Identity
  { pattern: /\bKINDE_/i, service: 'Kinde' },
  { pattern: /\bAUTH0_/i, service: 'Auth0' },
  { pattern: /\bCLERK_/i, service: 'Clerk' },
  { pattern: /\bOKTA_/i, service: 'Okta' },
  { pattern: /\bKEYCLOAK_/i, service: 'Keycloak' },
  { pattern: /\bCOGNITO_|AWS_USER_POOL/i, service: 'Amazon Cognito' },
  { pattern: /\bWORKOS_/i, service: 'WorkOS' },
  { pattern: /\bSTYTCH_/i, service: 'Stytch' },
  { pattern: /\bFIREBASE_/i, service: 'Firebase' },
  { pattern: /\bENTRA_|AZURE_AD_/i, service: 'Microsoft Entra' },

  // Payments
  { pattern: /\bSTRIPE_/i, service: 'Stripe' },
  { pattern: /\bPAYSTACK_/i, service: 'Paystack' },
  { pattern: /\bFLUTTERWAVE_/i, service: 'Flutterwave' },
  { pattern: /\bRAZORPAY_/i, service: 'Razorpay' },
  { pattern: /\bADYEN_|BRAINTREE_/i, service: 'Adyen' },
  { pattern: /\bPLAID_/i, service: 'Plaid' },
  { pattern: /\bPAYPAL_/i, service: 'PayPal' },

  // Messaging and mail
  { pattern: /\bTWILIO_/i, service: 'Twilio' },
  { pattern: /\bSENDGRID_/i, service: 'SendGrid' },
  { pattern: /\bMAILGUN_/i, service: 'Mailgun' },
  { pattern: /\bPOSTMARK_/i, service: 'Postmark' },
  { pattern: /\bRESEND_/i, service: 'Resend' },
  { pattern: /\bSES_|AWS_SES/i, service: 'Amazon SES' },
  { pattern: /\bSMTP_/i, service: 'SMTP' },
  { pattern: /\bTERMII_|AFRICASTALKING_/i, service: 'Termii' },

  // Storage and delivery
  { pattern: /\bS3_(BUCKET|KEY|REGION)|AWS_S3|BUCKET_NAME/i, service: 'Amazon S3' },
  { pattern: /\bR2_|CLOUDFLARE_R2_/i, service: 'Cloudflare R2' },
  { pattern: /\bCLOUDFLARE_|CF_ACCOUNT/i, service: 'Cloudflare' },
  { pattern: /\bCLOUDINARY_/i, service: 'Cloudinary' },
  { pattern: /\bGCS_|GOOGLE_CLOUD_STORAGE/i, service: 'Google Cloud Storage' },
  { pattern: /\bAZURE_STORAGE/i, service: 'Azure Blob Storage' },

  // Model providers
  { pattern: /\bOPENAI_/i, service: 'OpenAI' },
  { pattern: /\bANTHROPIC_/i, service: 'Anthropic' },
  { pattern: /\bGEMINI_|GOOGLE_GENERATIVE/i, service: 'Google Gemini' },
  { pattern: /\bCOHERE_/i, service: 'Cohere' },
  { pattern: /\bMISTRAL_/i, service: 'Mistral' },
  { pattern: /\bGROQ_/i, service: 'Groq' },
  { pattern: /\bHUGGINGFACE_|HF_TOKEN/i, service: 'Hugging Face' },
  { pattern: /\bREPLICATE_/i, service: 'Replicate' },
  { pattern: /\bPINECONE_/i, service: 'Pinecone' },
  { pattern: /\bWEAVIATE_/i, service: 'Weaviate' },
  { pattern: /\bQDRANT_/i, service: 'Qdrant' },
  { pattern: /\bCHROMA_/i, service: 'Chroma' },
  { pattern: /\bLANGFUSE_/i, service: 'Langfuse' },
  { pattern: /\bLANGSMITH_|LANGCHAIN_TRACING/i, service: 'LangSmith' },
  { pattern: /\bDEEPGRAM_|ASSEMBLYAI_/i, service: 'Deepgram' },
  { pattern: /\bELEVENLABS_/i, service: 'ElevenLabs' },

  // Observability
  { pattern: /\bSENTRY_/i, service: 'Sentry' },
  { pattern: /\bDATADOG_|DD_API_KEY|DD_AGENT/i, service: 'Datadog' },
  { pattern: /\bNEW_RELIC_|NEWRELIC_/i, service: 'New Relic' },
  { pattern: /\bHONEYCOMB_/i, service: 'Honeycomb' },
  { pattern: /\bOTEL_|OPENTELEMETRY_/i, service: 'OpenTelemetry' },
  { pattern: /\bPROMETHEUS_/i, service: 'Prometheus' },
  { pattern: /\bGRAFANA_|LOKI_/i, service: 'Grafana' },
  { pattern: /\bSEQ_(URL|SERVER)|SERILOG_/i, service: 'Seq' },
  { pattern: /\bROLLBAR_|BUGSNAG_/i, service: 'Rollbar' },

  // Product analytics and flags
  { pattern: /\bSEGMENT_/i, service: 'Segment' },
  { pattern: /\bMIXPANEL_/i, service: 'Mixpanel' },
  { pattern: /\bAMPLITUDE_/i, service: 'Amplitude' },
  { pattern: /\bPOSTHOG_/i, service: 'PostHog' },
  { pattern: /\bLAUNCHDARKLY_|LD_SDK/i, service: 'LaunchDarkly' },

  // Search and other
  { pattern: /\bALGOLIA_/i, service: 'Algolia' },
  { pattern: /\bTYPESENSE_/i, service: 'Typesense' },
  { pattern: /\bMEILISEARCH_/i, service: 'Meilisearch' },
  { pattern: /\bSLACK_/i, service: 'Slack' },
  { pattern: /\bHUBSPOT_/i, service: 'HubSpot' },
  { pattern: /\bSALESFORCE_/i, service: 'Salesforce' },
  { pattern: /\bSHOPIFY_/i, service: 'Shopify' },
];

/**
 * Files that state the environment a system needs.
 * A file holding real values is read for names only.
 */
const ENV_FILE_NAMES = [
  '.env.example',
  '.env.template',
  '.env.sample',
  '.env.dist',
  '.env.defaults',
  '.env.local.example',
  '.env.test.example',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
];

/** Reads variable names from an environment file. A value is never returned. */
export function environmentNames(content: string): string[] {
  const names: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    // Take only what sits left of the first `=`. The value never leaves here.
    const separator = trimmed.indexOf('=');
    const name = (separator === -1 ? trimmed : trimmed.slice(0, separator))
      .replace(/^export\s+/, '')
      .trim();

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      names.push(name);
    }
  }

  return names;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Infrastructure descriptors
 * ──────────────────────────────────────────────────────────────────────────── */

interface InfraRule {
  /** Files or directories that identify this platform. */
  files: string[];
  service: string;
  /** Further services proven by content inside the file. */
  content?: Array<{ pattern: RegExp; service: string }>;
}

const INFRA_RULES: InfraRule[] = [
  {
    files: ['serverless.yml', 'serverless.yaml', 'serverless.ts'],
    service: 'AWS Lambda',
    content: [
      { pattern: /\bdynamodb\b/i, service: 'DynamoDB' },
      { pattern: /\bs3\b/i, service: 'Amazon S3' },
      { pattern: /\bsqs\b/i, service: 'Amazon SQS' },
      { pattern: /\bsns\b/i, service: 'Amazon SNS' },
      { pattern: /\bapigateway|httpApi\b/i, service: 'Amazon API Gateway' },
      { pattern: /\bstepFunctions|stateMachine\b/i, service: 'AWS Step Functions' },
      { pattern: /\beventBridge\b/i, service: 'Amazon EventBridge' },
    ],
  },
  { files: ['.ebextensions', '.elasticbeanstalk'], service: 'AWS Elastic Beanstalk' },
  { files: ['wrangler.toml', 'wrangler.jsonc', 'wrangler.json'], service: 'Cloudflare Workers',
    content: [
      { pattern: /\[\[\s*d1_databases/i, service: 'Cloudflare D1' },
      { pattern: /\[\[\s*kv_namespaces/i, service: 'Cloudflare KV' },
      { pattern: /\[\[\s*r2_buckets/i, service: 'Cloudflare R2' },
      { pattern: /\[\[\s*queues/i, service: 'Cloudflare Queues' },
      { pattern: /durable_objects/i, service: 'Durable Objects' },
    ],
  },
  { files: ['vercel.json'], service: 'Vercel' },
  { files: ['netlify.toml'], service: 'Netlify' },
  { files: ['fly.toml'], service: 'Fly.io' },
  { files: ['render.yaml'], service: 'Render' },
  { files: ['railway.json', 'railway.toml'], service: 'Railway' },
  { files: ['app.yaml'], service: 'Google App Engine' },
  { files: ['Dockerfile', 'Containerfile'], service: 'Docker' },
  { files: ['nginx.conf'], service: 'Nginx' },
  { files: ['Chart.yaml', 'values.yaml'], service: 'Helm' },
  { files: ['skaffold.yaml'], service: 'Kubernetes' },
];

/** Terraform and Kubernetes resources that name a component. */
const RESOURCE_PATTERNS: Array<{ pattern: RegExp; service: string }> = [
  { pattern: /aws_db_instance|aws_rds/i, service: 'Amazon RDS' },
  { pattern: /aws_dynamodb_table/i, service: 'DynamoDB' },
  { pattern: /aws_s3_bucket/i, service: 'Amazon S3' },
  { pattern: /aws_sqs_queue/i, service: 'Amazon SQS' },
  { pattern: /aws_sns_topic/i, service: 'Amazon SNS' },
  { pattern: /aws_lambda_function/i, service: 'AWS Lambda' },
  { pattern: /aws_ecs_|aws_fargate/i, service: 'Amazon ECS' },
  { pattern: /aws_eks_/i, service: 'Amazon EKS' },
  { pattern: /aws_elasticache/i, service: 'Redis' },
  { pattern: /aws_cloudfront/i, service: 'CloudFront' },
  { pattern: /aws_api_gateway|aws_apigatewayv2/i, service: 'Amazon API Gateway' },
  { pattern: /google_sql_database/i, service: 'Cloud SQL' },
  { pattern: /google_storage_bucket/i, service: 'Google Cloud Storage' },
  { pattern: /azurerm_postgresql/i, service: 'PostgreSQL' },
  { pattern: /kind:\s*Deployment/i, service: 'Kubernetes' },
  { pattern: /kind:\s*Ingress/i, service: 'Kubernetes' },
];

/** Base images in a Dockerfile that name a component. */
const IMAGE_PATTERNS: Array<{ pattern: RegExp; service: string }> = [
  { pattern: /\bpostgres(:|\s|$)/i, service: 'PostgreSQL' },
  { pattern: /\bmysql(:|\s|$)/i, service: 'MySQL' },
  { pattern: /\bredis(:|\s|$)/i, service: 'Redis' },
  { pattern: /\bmongo(:|\s|$)/i, service: 'MongoDB' },
  { pattern: /\brabbitmq(:|\s|$)/i, service: 'RabbitMQ' },
  { pattern: /\bnginx(:|\s|$)/i, service: 'Nginx' },
  { pattern: /\bnode(:|\s|$)/i, service: 'Node.js' },
  { pattern: /\bpython(:|\s|$)/i, service: 'Python' },
  { pattern: /\bgolang(:|\s|$)/i, service: 'Go' },
  { pattern: /\belasticsearch(:|\s|$)/i, service: 'Elasticsearch' },
  { pattern: /\bminio(:|\s|$)/i, service: 'MinIO' },
  { pattern: /\bkeycloak(:|\s|$)/i, service: 'Keycloak' },
  { pattern: /\bclickhouse(:|\s|$)/i, service: 'ClickHouse' },
];

const MAX_FILE_BYTES = 256 * 1024;

async function readCapped(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      return null;
    }
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Collects every component the repository states it uses.
 *
 * Each result carries the file it came from, so the model can wire the
 * component to the right place instead of guessing.
 */
export async function collectEvidence(rootPath: string): Promise<Evidence[]> {
  const found: Evidence[] = [];
  const seen = new Set<string>();

  const add = (service: string, source: string, hint: string) => {
    const key = `${service}|${source}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    found.push({ service, source, hint });
  };

  const ignored = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.venv/**',
    '**/__pycache__/**',
  ];

  // 1. Environment variable names, including independent services in a workspace.
  const envFiles = await glob(
    ENV_FILE_NAMES.flatMap((name) => [name, `**/${name}`]),
    { cwd: rootPath, dot: true, onlyFiles: true, ignore: ignored, deep: 5 },
  );

  for (const name of [...new Set(envFiles)].slice(0, 160)) {
      const content = await readCapped(join(rootPath, name));
      if (!content) {
        continue;
      }
      const source = relative(rootPath, join(rootPath, name)) || name;
      for (const variable of environmentNames(content)) {
        for (const rule of ENV_NAME_PATTERNS) {
          if (rule.pattern.test(variable)) {
            add(rule.service, source, variable);
          }
        }
      }
  }

  // 2. Platform descriptors, including descriptors inside service folders.
  for (const rule of INFRA_RULES) {
    const matches = await glob(
      rule.files.flatMap((name) => [name, `**/${name}`]),
      { cwd: rootPath, dot: true, ignore: ignored, deep: 5, onlyFiles: false },
    );
    for (const name of [...new Set(matches)].slice(0, 160)) {
      const path = join(rootPath, name);
      add(rule.service, name, name.split('/').pop() ?? name);

      const content = await readCapped(path);
      if (content && rule.content) {
        for (const inner of rule.content) {
          if (inner.pattern.test(content)) {
            add(inner.service, name, inner.pattern.source);
          }
        }
      }
      if (content && /Dockerfile|Containerfile/i.test(name)) {
        for (const image of IMAGE_PATTERNS) {
          if (image.pattern.test(content)) {
            add(image.service, name, 'base image');
          }
        }
      }
    }
  }

  // 3. Infrastructure code and workflows.
  const infraFiles = await glob(
    [
      '**/terraform/**/*.{tf,tfvars}',
      '**/infra/**/*.{tf,tfvars,yml,yaml,json}',
      '**/infrastructure/**/*.{tf,tfvars,yml,yaml,json}',
      '**/deploy/**/*.{tf,tfvars,yml,yaml,json}',
      '**/k8s/**/*.{yml,yaml,json}',
      '**/kubernetes/**/*.{yml,yaml,json}',
      '.github/workflows/*.{yml,yaml}',
    ],
    { cwd: rootPath, dot: true, onlyFiles: true, ignore: ignored, deep: 7 },
  );
  for (const name of infraFiles.slice(0, 300)) {
    const content = await readCapped(join(rootPath, name));
    if (!content) {
      continue;
    }
    for (const rule of RESOURCE_PATTERNS) {
      if (rule.pattern.test(content)) {
        add(rule.service, name, rule.pattern.source);
      }
    }
  }

  return found;
}

/** Groups evidence into one line per component, naming where it was proved. */
export function summarizeEvidence(evidence: Evidence[]): string[] {
  const bySource = new Map<string, Set<string>>();

  for (const item of evidence) {
    if (!bySource.has(item.service)) {
      bySource.set(item.service, new Set());
    }
    bySource.get(item.service)!.add(item.source);
  }

  return [...bySource.entries()].map(
    ([service, sources]) => `${service} (proved by ${[...sources].slice(0, 3).join(', ')})`,
  );
}
