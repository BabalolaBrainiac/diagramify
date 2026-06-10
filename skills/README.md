# Diagramify Skill

The `diagramify` skill teaches coding agents to generate, revise, validate, render, compare, and automate diagrams with Diagramify.

## Install

Copy the entire skill directory so its references and agent metadata remain available:

```bash
mkdir -p ~/.claude/skills
cp -R skills/diagramify ~/.claude/skills/
```

For an installed npm package:

```bash
mkdir -p ~/.claude/skills
cp -R node_modules/diagramify/skills/diagramify ~/.claude/skills/
```

## Invoke

Examples:

```text
Use $diagramify to create and validate an architecture diagram for this repository.
```

```text
Use $diagramify to revise diagrams/system.mmd, render interactive HTML and SVG, and explain the material changes.
```
