export interface GitHubActionsOptions {
  outputPath?: string;       // default: 'diagrams'
  triggerBranch?: string;    // default: 'main'
  nodeVersion?: string;      // default: '20'
  commitDiagrams?: boolean;  // default: false
}

export function generateGitHubActionsWorkflow(options: GitHubActionsOptions): string {
  const branch = options.triggerBranch || 'main';
  const outPath = options.outputPath || 'diagrams';
  const nodeVer = options.nodeVersion || '20';
  
  let steps = `
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVer}'
          
      - name: Install dependencies
        run: npm ci || npm install
        
      - name: Generate Diagrams
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
        run: npx diagramify-ai generate --path . --outdir ${outPath} --out html,svg,png
  `;

  if (options.commitDiagrams) {
    steps += `
      - name: Commit diagrams
        run: |
          git config --global user.name "diagramify-bot"
          git config --global user.email "bot@diagramify.dev"
          git add ${outPath}
          git commit -m "docs(arch): auto-update diagrams [skip ci]" || echo "No changes to commit"
          git push
    `;
  } else {
    steps += `
      - name: Upload diagrams
        uses: actions/upload-artifact@v4
        with:
          name: architecture-diagrams
          path: ${outPath}/
    `;
  }

  return `name: Diagramify Auto-Generation

on:
  push:
    branches:
      - ${branch}

jobs:
  generate-diagrams:
    runs-on: ubuntu-latest
    steps:${steps}`;
}
