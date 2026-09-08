export interface GitLabCIOptions {
  outputPath?: string;       // default: 'diagrams'
  triggerBranch?: string;    // default: 'main'
  nodeVersion?: string;      // default: '20'
  commitDiagrams?: boolean;  // default: false
  /** Add a merge-request job that fails the pipeline when the architecture
   *  drifted from the committed baseline. Default: true. */
  gateOnPR?: boolean;
  /** Committed IR file `diagramify check` compares against. */
  baseline?: string;
}

export function generateGitLabCI(options: GitLabCIOptions): string {
  const branch = options.triggerBranch || 'main';
  const outPath = options.outputPath || 'diagrams';
  const nodeVer = options.nodeVersion || '20';
  
  let yaml = `diagramify:
  image: node:${nodeVer}
  stage: build
  only:
    - ${branch}
  script:
    - npm ci || npm install
    - npx diagramify-ai generate --path . --outdir ${outPath} --out html,svg,png
`;

  if (options.commitDiagrams) {
    yaml += `    - git config --global user.name "diagramify-bot"
    - git config --global user.email "bot@diagramify.dev"
    - git add ${outPath}
    - git commit -m "docs(arch): auto-update diagrams [skip ci]" || echo "No changes to commit"
    - git push "https://\${GITLAB_USER_LOGIN}:\${GITLAB_TOKEN}@\${CI_SERVER_HOST}/\${CI_PROJECT_PATH}.git" HEAD:${branch}
`;
  } else {
    yaml += `  artifacts:
    paths:
      - ${outPath}/
    expire_in: 30 days
`;
  }

  const gateOnPR = options.gateOnPR !== false;
  const baseline = options.baseline || 'diagrams/architecture.json';

  if (gateOnPR) {
    yaml += `
check-architecture:
  image: node:${nodeVer}
  stage: build
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - npm ci || npm install
    - npx diagramify-ai check --baseline ${baseline}
`;
  }

  return yaml;
}
