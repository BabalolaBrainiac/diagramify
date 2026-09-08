export interface GitHubActionsOptions {
  outputPath?: string;       // default: 'diagrams'
  triggerBranch?: string;    // default: 'main'
  nodeVersion?: string;      // default: '20'
  commitDiagrams?: boolean;  // default: false
  /** Add a pull_request job that fails the PR when the architecture drifted
   *  from the committed baseline, and comments the diff. Default: true. */
  gateOnPR?: boolean;
  /** Committed IR file `diagramify check` compares against. */
  baseline?: string;
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

  const gateOnPR = options.gateOnPR !== false;
  const baseline = options.baseline || 'diagrams/architecture.json';

  const gateJob = gateOnPR
    ? `

  check-architecture:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVer}'

      - name: Install dependencies
        run: npm ci || npm install

      - name: Check architecture drift
        id: drift
        run: |
          npx diagramify-ai check --baseline ${baseline} --json > drift.json || echo "drifted=true" >> "$GITHUB_OUTPUT"
          cat drift.json

      - name: Comment on pull request
        if: steps.drift.outputs.drifted == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('drift.json', 'utf8'));
            const lines = ['### Architecture drift detected', '', 'The committed diagram (\`${baseline}\`) no longer matches the code.', ''];
            const section = (title, entries, fmt) => {
              if (!entries.length) return;
              lines.push('**' + title + ' (' + entries.length + ')**');
              for (const e of entries) lines.push('- ' + fmt(e));
              lines.push('');
            };
            section('Services added', report.nodesAdded, (n) => '+ ' + n.label);
            section('Services removed', report.nodesRemoved, (n) => '- ' + n.label);
            section('Services changed', report.nodesChanged, (n) => '~ ' + n.label + ': ' + (n.changes || []).join('; '));
            section('Connections added', report.edgesAdded, (e) => '+ ' + e.from + ' \\u2192 ' + e.to + (e.label ? ' (' + e.label + ')' : ''));
            section('Connections removed', report.edgesRemoved, (e) => '- ' + e.from + ' \\u2192 ' + e.to + (e.label ? ' (' + e.label + ')' : ''));
            lines.push('Run \`diagramify check --update --baseline ${baseline}\` locally and commit the result to accept this change.');
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: lines.join('\\n'),
            });

      - name: Fail if architecture drifted
        if: steps.drift.outputs.drifted == 'true'
        run: exit 1`
    : '';

  const prTrigger = gateOnPR ? `
  pull_request:
    branches:
      - ${branch}` : '';

  return `name: Diagramify Auto-Generation

on:
  push:
    branches:
      - ${branch}${prTrigger}

jobs:
  generate-diagrams:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:${steps}${gateJob}
`;
}
