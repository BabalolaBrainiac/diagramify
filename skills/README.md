# Diagramify Agent Skills

This directory provides specialized agent skills for Diagramify:

| Skill | Purpose | Command |
| :--- | :--- | :--- |
| **[`diagramify`](./diagramify/SKILL.md)** | Baseline 2D Mermaid architecture and flow diagrams | `diagramify generate` |
| **[`spatial-architecture`](./spatial-architecture/SKILL.md)** | Tactile 3D spatial models and interactive digital twins | `diagramify spatial` |
| **[`statechart-verification`](./statechart-verification/SKILL.md)** | Formal state machines with TLC safety invariants | `diagramify statechart` |

## Installation

Copy the skills to your local agent skills directory:

```bash
mkdir -p ~/.claude/skills
cp -R skills/* ~/.claude/skills/
```
