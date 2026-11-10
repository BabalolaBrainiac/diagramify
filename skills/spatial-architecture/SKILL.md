---
name: spatial-architecture
description: "Generate tactile 3D spatial architecture models, multi-tier chassis substrates, and interactive digital twins with Diagramify. Use when an agent needs to model physical tier elevations, illuminated data highways, and non-overlapping 3D hardware components from a codebase or system specification."
version: 1.0.0
user-invocable: true
argument-hint: "[path] [--elevation stacked|exploded] [--out html,png,svg]"
license: MIT
---

# Spatial Architecture

Use this skill to transform flat system architecture into a tactile 3D digital twin.
The 3D spatial engine organizes components into elevated chassis platters and illuminated data highways.

## Core Principles

1. **Elevation by Responsibility**:
   - Deconstruct the architecture into four physical tiers.
   - Tier 3 (Elevation z = 390): Client Ingress, Edge Proxy, and SSL Termination.
   - Tier 2 (Elevation z = 270): WSGI or Application Core, API Routing, and Domain Blueprints.
   - Tier 1 (Elevation z = 140): Distributed Background Workers, Event Loops, and Message Brokers.
   - Tier 0 (Elevation z = 0): Relational Databases, Object Storage, and Persistent Caches.
2. **Tactile Hardware Modules**:
   - Model nodes as tactile server blades or chip modules.
   - Apply specular bevel edge highlights and active LED indicator bars.
   - Never stretch text across perspective planes. Use orthogonal 2D typography on top faces.
3. **Illuminated Data Highways**:
   - Route network conduits along isometric orthogonal axes.
   - Use high-contrast glowing cores with in-flight data pulse indicators.
   - Color code conduits by protocol: Ingress Orange (`#ff6b00`), Internal Teal (`#16aab9`), ACID Emerald (`#10b981`).
4. **Cardless HUD Telemetry**:
   - Display component properties using monospace typography and delicate leader lines.
   - Show exact protocol ports (`:443`, `:5432`) and pool limits.

---

## Agent Workflow

### Step 1: Scan and Classify the Codebase

1. Identify network entry points (ALB, Nginx, CloudFront).
2. Identify application controllers, frameworks, and modular blueprints.
3. Locate asynchronous workers, event queues, and background daemons.
4. Locate primary databases, Redis caches, and object storage buckets.

### Step 2: Invoke Diagramify Spatial CLI

Run the spatial generation command:

```bash
# Generate 3D spatial architecture assets
diagramify spatial . --elevation stacked --out html,png,svg --name system-spatial
```

For custom elevation and theme options:

```bash
# Generate exploded chassis with custom theme
diagramify spatial . --elevation exploded --theme forge --out html,png
```

### Step 3: Inspect and Verify Outputs

1. Verify that no chassis tiers occlude critical components.
2. Verify that all four physical tiers link through vertical structural pillars.
3. Open the generated interactive HTML file to verify orbit, pan, and zoom controls.

---

## Command Reference

| Flag | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `[path]` | string | Root directory of the codebase | `.` |
| `--elevation` | string | Chassis spacing: `stacked` or `exploded` | `stacked` |
| `--chassis` | string | Chassis style: `integrated` or `open-frame` | `integrated` |
| `--theme` | string | Visual palette: `forge`, `dark`, or `nord` | `forge` |
| `--out` | string | Output formats: `html`, `png`, `svg` | `html,png` |
| `--name` | string | Base name for generated files | `spatial-3d` |

---

## Interactive Viewer Capabilities

The generated interactive HTML file provides:
- Mouse drag to pan and orbit the 3D model.
- Scroll wheel to zoom from 0.15x to 3.0x magnification.
- Layer Peeler checkboxes to isolate individual chassis tiers.
- Click-to-inspect module telemetry with live parameter display.
