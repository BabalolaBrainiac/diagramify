import type { DiagramifyResult, GenerateOptions, DiagramType } from './types.js';
import { loadConfig } from './config.js';
import { resolveModel, callLLM } from './provider.js';
import { renderDiagram } from './render.js';
import { analyzeCodebase } from './analyze.js';

const SYSTEM_PROMPT = `You are a software architecture expert. Your task is to produce a syntactically valid Mermaid diagram that accurately represents the provided codebase or system description.

Rules:
1. Output ONLY the raw Mermaid source code — no markdown fences, no explanation text.
2. Start with the diagram type declaration (e.g. "flowchart TD" or "sequenceDiagram").
3. Use meaningful, concise node labels. Avoid special characters that break Mermaid parsing.
4. Limit to 30 nodes maximum for readability.
5. Ensure all IDs contain only alphanumeric characters and underscores.
6. Use square bracket syntax for node labels with spaces: A[User Service]
7. Group related nodes with subgraphs where applicable.`;

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
