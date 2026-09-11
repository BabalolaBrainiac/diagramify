import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import {
  API_KEY_VARIABLES,
  PROVIDERS,
  availableProviders,
  clearModelCache,
  discoverModels,
  pickModel,
  resolveModelId,
  type ModelTier,
} from '../../core/models.js';
import type { ProviderName } from '../../core/types.js';

const TIERS: ModelTier[] = ['fast', 'balanced', 'best'];

/**
 * Reports which provider a key selects, and which model each tier resolves to.
 *
 * Running this before `generate` shows the choice without spending a token on
 * a diagram, which makes a wrong provider or a stale model easy to spot.
 */
export const modelsCommand = new Command()
  .name('models')
  .description('Show which provider and model a key resolves to')
  .option('--provider <name>', 'Inspect one provider: anthropic, openai, google')
  .option('--all', 'List every model the key can reach, not just the choice')
  .option('--refresh', 'Ignore the cached model list and ask the provider again')
  .action(async (options) => {
    try {
      if (options.refresh) {
        clearModelCache();
        console.log('Cleared the cached model list.');
      }

      const config = await loadConfig({ provider: options.provider });
      const found = availableProviders(config);

      if (found.length === 0) {
        console.log('No provider key found.\n');
        console.log('Set one of these, then run this command again:');
        for (const provider of PROVIDERS) {
          console.log(`  ${provider.padEnd(10)} ${API_KEY_VARIABLES[provider].join(' or ')}`);
        }
        console.log('\nWithout a key, "diagramify generate --no-llm" still builds a diagram.');
        return;
      }

      const targets: ProviderName[] = options.provider ? [options.provider as ProviderName] : found;

      console.log(`Keys found for: ${found.join(', ')}`);
      console.log(`Selected provider: ${config.provider}\n`);

      for (const provider of targets) {
        console.log(`${provider}`);

        const credential = config.provider === provider ? config.apiKey : undefined;
        if (!credential) {
          console.log('  No key for this provider.\n');
          continue;
        }

        let discovered: string[] = [];
        try {
          discovered = await discoverModels(provider, credential);
          console.log(`  ${discovered.length} models reachable`);
        } catch (error) {
          console.log(
            `  Model list unavailable (${error instanceof Error ? error.message : String(error)}).`,
          );
          console.log('  Falling back to pinned names.');
        }

        for (const tier of TIERS) {
          const chosen =
            discovered.length > 0
              ? pickModel(provider, discovered, tier)
              : await resolveModelId(provider, { tier, discover: false });
          const marker = tier === (config.tier ?? 'balanced') ? ' <- default' : '';
          console.log(`    ${tier.padEnd(9)} ${chosen ?? 'none'}${marker}`);
        }

        if (options.all && discovered.length > 0) {
          console.log('\n  All reachable models:');
          for (const id of [...discovered].sort()) {
            console.log(`    ${id}`);
          }
        }

        console.log('');
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
