export function generatePrecommitHook(outPath: string = 'diagrams'): string {
  return `#!/bin/sh
# diagramify pre-commit hook

echo "Generating architecture diagrams..."
npx diagramify-ai generate --path . --outdir ${outPath} --out html,svg,png

if [ $? -ne 0 ]; then
  echo "Error: diagramify failed."
  exit 1
fi

git add ${outPath}
`;
}
