/**
 * Generates inline brand icons from `simple-icons` at build time.
 *
 * The viewer used to fetch an icon from a content delivery network whenever it
 * had no inline copy. That broke a saved diagram with no network, leaked the
 * reader's address to a third party, and left offline mode drawing letters.
 *
 * `simple-icons` is a development dependency, so the icons are baked in and the
 * published package needs no network at all.
 *
 * Run with: npm run build:icons
 */

import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as simpleIcons from 'simple-icons';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** Turns a service name into the key `simple-icons` uses. */
function iconKey(slug) {
  const cleaned = slug.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `si${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

/**
 * Every name worth an icon: the slugs the registry already uses, plus the
 * components the evidence scanner can prove.
 */
function wantedSlugs() {
  const wanted = new Set();

  // Slugs named by the service registry.
  const registry = readFileSync(join(root, 'src/icons/services.ts'), 'utf-8');
  for (const match of registry.matchAll(/simpleIconSlug:\s*'([^']+)'/g)) wanted.add(match[1]);
  for (const match of registry.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)) wanted.add(match[1]);
  for (const match of registry.matchAll(/icon:\s*'([^']+)'/g)) wanted.add(match[1]);

  // Components the evidence scanner names.
  const evidence = readFileSync(join(root, 'src/core/evidence.ts'), 'utf-8');
  for (const match of evidence.matchAll(/service:\s*'([^']+)'/g)) wanted.add(match[1]);

  // Names that appear constantly and are worth having whatever the registry says.
  const common = [
    'react', 'nextdotjs', 'vuedotjs', 'svelte', 'angular', 'nodedotjs', 'deno', 'bun',
    'typescript', 'javascript', 'python', 'go', 'rust', 'ruby', 'php', 'dotnet',
    'django', 'flask', 'fastapi', 'express', 'nestjs', 'spring', 'laravel', 'rails',
    'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite', 'elasticsearch', 'clickhouse',
    'apachekafka', 'rabbitmq', 'nats', 'celery',
    'docker', 'kubernetes', 'terraform', 'nginx', 'githubactions', 'gitlab', 'jenkins',
    'amazonwebservices', 'googlecloud', 'microsoftazure', 'cloudflare', 'vercel', 'netlify',
    'firebase', 'supabase', 'auth0', 'okta', 'keycloak', 'clerk',
    'stripe', 'paypal', 'twilio', 'sendgrid', 'mailgun', 'resend',
    'sentry', 'datadog', 'grafana', 'prometheus', 'opentelemetry', 'newrelic',
    'openai', 'anthropic', 'googlegemini', 'huggingface', 'langchain', 'pinecone',
    'segment', 'posthog', 'amplitude', 'algolia', 'slack', 'shopify', 'hubspot',
    'elevenlabs', 'graphql', 'prisma', 'swagger', 'jsonwebtokens', 'socketdotio',
  ];
  for (const name of common) wanted.add(name);

  return [...wanted].filter(Boolean);
}

const icons = {};
const missing = [];

for (const slug of wantedSlugs()) {
  const icon = simpleIcons[iconKey(slug)];
  if (icon?.path) {
    icons[slug] = { p: icon.path, h: `#${icon.hex}` };
  } else {
    missing.push(slug);
  }
}

const entries = Object.entries(icons)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([slug, { p, h }]) => `  '${slug}': { p: '${p.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', h: '${h}' },`)
  .join('\n');

const output = `/**
 * Brand icons, generated from \`simple-icons\` by scripts/build-icons.mjs.
 *
 * Do not edit by hand. Run \`npm run build:icons\` to refresh.
 *
 * Each entry holds the path data and the brand colour. Keeping them inline means
 * a saved diagram draws its icons with no network request, which is what offline
 * mode needs and what stops a reader's address reaching a third party.
 */

export interface BrandIcon {
  /** SVG path data, drawn in a 24 by 24 viewBox. */
  p: string;
  /** The brand colour, as a hex string. */
  h: string;
}

export const BRAND_ICONS: Record<string, BrandIcon> = {
${entries}
};

/** Builds a standalone SVG for a brand icon, in the colour given. */
export function brandIconSVG(slug: string, color?: string): string | null {
  const icon = BRAND_ICONS[slug];
  if (!icon) {
    return null;
  }
  const fill = color ?? icon.h;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    \`<path d="\${icon.p}" fill="\${fill}"/>\` +
    '</svg>'
  );
}
`;

writeFileSync(join(root, 'src/icons/generated-icons.ts'), output);

console.log(`Wrote ${Object.keys(icons).length} brand icons.`);
if (missing.length) {
  console.log(`No icon in simple-icons for ${missing.length}: ${missing.slice(0, 20).join(', ')}`);
}
