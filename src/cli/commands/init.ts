import { Command } from 'commander';
import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const CONFIG_TEMPLATE = `import type { DiagramifyConfig } from 'diagramify-ai';

export default {
  // LLM Provider: 'anthropic' | 'openai' | 'google'
  provider: 'anthropic',

  // Model ID (defaults to provider-specific model if not specified)
  // Examples:
  // - Anthropic: 'claude-opus-4-1', 'claude-sonnet-4-6', 'claude-haiku-3-5'
  // - OpenAI: 'gpt-4', 'gpt-4o', 'gpt-3.5-turbo'
  // - Google: 'gemini-2.5-flash', 'gemini-2.5-pro'
  model: 'claude-sonnet-4-6',

  // Diagram theme from beautiful-mermaid
  // Options: 'default', 'dark', 'light', 'tokyo-night', 'catppuccin-latte', etc.
  theme: 'default',

  // Default output formats
  // Options: 'svg', 'png', 'jpeg', 'mmd'
  defaultOutput: ['svg', 'mmd'],

  // LLM parameters
  temperature: 0.7,
  maxTokens: 4096,

  // Optional: API key (can also be set via environment variables)
  // apiKey: 'your-key-here',
} satisfies DiagramifyConfig;
`;

export const initCommand = new Command()
  .name('init')
  .description('Create a diagramify.config.ts in the current directory')
  .action(async () => {
    const configPath = resolve(process.cwd(), 'diagramify.config.ts');

    if (existsSync(configPath)) {
      console.error(`Config file already exists at ${configPath}`);
      process.exit(1);
    }

    try {
      writeFileSync(configPath, CONFIG_TEMPLATE);
      console.log(`Created config file: ${configPath}`);
      console.log('\nNext steps:');
      console.log('1. Edit the config file with your preferences');
      console.log('2. Set your API key via environment variable or in the config');
      console.log('3. Run: diagramify generate --path . --out svg,png');
    } catch (error) {
      console.error('Error creating config file:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
