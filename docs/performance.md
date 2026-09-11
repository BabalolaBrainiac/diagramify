# Browser benchmark

Measured on 9 September 2026 with Chrome 152.0.7977.83, macOS ARM64, and Apple M5 Max.
The baseline is commit `679566300`.
Each test moves one node with 30 real mouse steps across separate animation frames.

| Nodes | Connections | Baseline redraw p95 | Current redraw p95 | Retained connections |
|---|---|---|---|---|
| 30 | 45 | 8.4 ms | 1.5 ms | 45 of 45 |
| 120 | 195 | 31.9 ms | 1.7 ms | 195 of 195 |

The p95 value is the 95th percentile of redraw durations.
Each sample measures connection updates and the minimap callback.
It excludes browser painting, page load, server layout, and model inference.
These local results are not a guarantee for other devices or graph structures.

The current renderer made no SVG path measurement calls during either drag.
The baseline made 25,282 calls for the smaller graph and 105,075 calls for the larger graph.
Both versions processed 31 redraws per drag.
This comparison therefore measures reduced work per frame, beyond event batching alone.

Graph history records one change after each drag. It does not store a snapshot for every pointer movement.
The shared preview skips automatic layout when all nodes already have positions.

## Reproduce

```bash
npm ci
npm run build
npx playwright install chromium
npm run test:browser
npm run benchmark:viewer
```

To use an installed Chrome browser:

```bash
DIAGRAMIFY_BROWSER_CHANNEL=chrome npm run test:browser
DIAGRAMIFY_BROWSER_CHANNEL=chrome npm run benchmark:viewer
```

The benchmark reads the baseline without changing Git state.
It writes machine details and measured values to `.benchmark-results/viewer.json`.
This directory is excluded from Git.
