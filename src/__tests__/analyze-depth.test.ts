import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { analyzeCodebase } from '../core/analyze.js';

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'diagramify-depth-'));
  roots.push(root);
  mkdirSync(join(root, 'src/payment'), { recursive: true });
  mkdirSync(join(root, 'src/redis'), { recursive: true });
  mkdirSync(join(root, 'workers/email'), { recursive: true });

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    dependencies: { stripe: '^20.0.0', ioredis: '^5.0.0' },
  }));
  writeFileSync(
    join(root, 'src/app.module.ts'),
    "import { PaymentModule } from './payment/payment.module';\n",
  );
  writeFileSync(
    join(root, 'src/payment/payment.module.ts'),
    "import { RedisModule } from '../redis/redis.module';\nexport class PaymentModule {}\n",
  );
  writeFileSync(
    join(root, 'src/payment/payment.service.ts'),
    "import Stripe from 'stripe';\nexport class PaymentService {}\n",
  );
  writeFileSync(
    join(root, 'src/redis/redis.module.ts'),
    'export class RedisModule {}\n',
  );
  writeFileSync(
    join(root, 'workers/email/serverless.yml'),
    'service: email-worker\nprovider:\n  name: aws\nfunctions:\n  send:\n    handler: handler.send\nresources:\n  Resources:\n    Files:\n      Type: AWS::S3::Bucket\n',
  );

  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('deep codebase analysis', () => {
  it('finds source modules and nested service roots', async () => {
    const result = await analyzeCodebase(fixture(), 100);
    const modules = result.serviceDirectories.map((name) => name.toLowerCase());

    expect(modules).toEqual(expect.arrayContaining(['payment module', 'redis module', 'email service']));
  });

  it('finds connections between source modules', async () => {
    const result = await analyzeCodebase(fixture(), 100);

    expect(result.internalLinks).toContainEqual({ from: 'payment module', to: 'redis module', source: 'src/payment/payment.module.ts' });
  });

  it('finds services in a nested deployment file', async () => {
    const result = await analyzeCodebase(fixture(), 100);
    const services = result.detectedServices.map((name) => name.toLowerCase());

    expect(services).toEqual(expect.arrayContaining(['aws lambda', 'amazon s3']));
  });

  it('links a service to the source module that uses it', async () => {
    const result = await analyzeCodebase(fixture(), 100);

    expect(result.serviceLinks).toContainEqual({
      from: 'payment module',
      to: 'Stripe',
      label: 'API calls',
      kind: 'sync',
      source: 'src/payment/payment.service.ts',
    });
  });
});
