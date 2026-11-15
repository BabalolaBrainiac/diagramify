# Diagramify Design System

## Direction

Technical blueprint clarity. Surfaces stay flat, structured, and high-contrast so nodes, containers, and edges read at a glance across light and dark themes.

## Tokens and Palette

- Canvas background: `#F8FAFC` (light), `#0A0A0F` (dark), `#1A1B26` (Tokyo Night), `#2E3440` (Nord), `#1E1E2E` (Catppuccin).
- Card and chrome surface: `#FFFFFF` (light), `#15151F` (dark), pairing with 1px structural borders rather than heavy shadows.
- Primary ink and muted ink: `#0F172A` / `#475569` on light; `#E2E8F0` / `#94A3B8` on dark (minimum 4.5:1 text contrast and 3:1 stroke contrast).
- Accent color: `#2563EB` on light themes, `#60A5FA` on dark themes. Reserved for active states, selection rings, focus outlines, and primary actions.

## Typography and Hierarchy

- UI chrome uses `IBM Plex Sans`, falling back to `system-ui, sans-serif` in offline outputs.
- Viewer header stays single-bar with compact status metadata (`N services · M tiers`), grouped view/edit controls, and a single export menu plus primary reset button.
- Static SVG nodes use clear `13px` medium labels (`500`) inside soft-cornered (`rx=5`) containers; subgraph headers use `12px` semibold labels with clean header separation.

## Interaction and Restraint

- Avoid glow effects, multi-stop gradients, decorative blur badges, and overlapping floating toolbars.
- Keep action copy direct: remove filler hints that repeat control labels.
- Keep controls keyboard-accessible with visible focus rings and zero horizontal header overflow down to `375px` viewports.
