import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseMermaidSource } from '../core/parse.js';
import { renderDiagram } from '../core/render.js';
import { readExtent } from '../core/ir-layout.js';

const NESTED_ARCH_AND_SM = `flowchart TB
  subgraph ARCH["AI-VM Layered MVC Architecture"]
    direction TB

    subgraph FE["Frontend (React + TypeScript)"]
      direction LR
      FE_PAGES["Pages & Components<br/>Environment, People, Sessions, Templates, Volumes"]
      FE_API["API Hooks & Types<br/>src/api/queries.ts, client.ts, types.ts"]
      FE_PAGES --> FE_API
    end

    subgraph BE["Backend (FastAPI + Python MVC)"]
      direction TB
      CTRL["Controllers (app/controllers/)<br/>HTTP routes, dependencies, middleware<br/>No direct repository imports"]
      WRK["Workers (app/workers/)<br/>lifecycle_worker, drift_scan_worker, retention_worker"]
      VIEWS["Views (app/views/)<br/>schemas/ (Pydantic I/O) & presenters/ (read models)"]
      SVC["Services (app/services/)<br/>lifecycle/, templates/, agent_service, volume_service,<br/>session_service, people_service, alert_service"]
      REPO["Repositories (app/repositories/)<br/>Store, UnitOfWork, SQLAlchemy queries"]
      GW["Gateways (app/gateways/)<br/>seeweb/, identity/ (aivb_provider + aivb_transport),<br/>email/, database/, bootstrap"]
      MOD["Models (app/models/)<br/>entities.py, enums.py, pure rules/"]

      CTRL --> VIEWS
      CTRL --> SVC
      WRK --> SVC
      SVC --> REPO
      SVC --> GW
      SVC --> MOD
      REPO --> MOD
      GW --> MOD
      VIEWS --> MOD
    end

    subgraph EXT["Infrastructure & External Systems"]
      direction LR
      DB[("PostgreSQL<br/>Sessions, Templates, Volumes, Audit")]
      SEEWEB["Seeweb Cloud API<br/>Servers, Templates, Private Network"]
      AIVB["AIVB / Keycloak<br/>OIDC Auth & User Directory"]
    end

    subgraph VM["Guest VM (Seeweb Instance)"]
      direction LR
      BOOT["boot.sh + before-ssh unit<br/>Clear access group, regen host keys & machine-id,<br/>write sshd_config"]
      AGENT["vm/agent/ (rnd-agent)<br/>ssh.py, accounts.py, storage.py,<br/>release.py, report.py"]
      KEYS["/run/rnd-agent/keys<br/>0711 dir, 0644 authorized_keys"]
      FSTAB["/etc/fstab managed block<br/>+ /proc/self/mountinfo bind-mount cleanup"]
      BOOT --> AGENT
      AGENT --> KEYS
      AGENT --> FSTAB
    end

    FE_API -->|"HTTPS REST + SSE"| CTRL
    REPO --> DB
    GW --> SEEWEB
    GW --> AIVB
    SEEWEB -.->|"Cloud-init provisions"| BOOT
    AGENT <-->|"Bearer token: desired-state & report"| CTRL
  end

  subgraph SM["VM Session & Release State Machine"]
    direction TB
    START(("Start"))
    CREATING["CREATING<br/>Submit Seeweb server + cloud-init<br/>Wait for IPv4 & agent ready"]
    FAILED(["FAILED<br/>No server exists"])
    ACTIVE["ACTIVE<br/>Users join, mount NFS volumes,<br/>SSH via /run/rnd-agent/keys"]
    CLOSING["CLOSING<br/>Evaluate change_answers (needs_save)"]
    DESTROYING["DESTROYING<br/>Delete Seeweb server"]
    SAVING["SAVING<br/>1. Wait agent release cleanup (prepare_requested_at)<br/>2. 3m timeout -> warning alert + proceed<br/>3. Submit Seeweb template save"]
    SAVE_FAILED(["SAVE_FAILED<br/>Keep VM + raise admin alert"])
    CLOSED(["CLOSED<br/>Session complete"])

    START --> CREATING
    CREATING -->|"Provision / boot error"| FAILED
    CREATING -->|"Agent reports ready"| ACTIVE
    ACTIVE -->|"All participants leave or admin/policy release"| CLOSING
    CREATING -->|"Cancelled before ready"| CLOSING
    CLOSING -->|"never booted / no changes"| DESTROYING
    CLOSING -->|"changes declared or unknown (FR-06)"| SAVING
    SAVING -->|"Seeweb template READY"| DESTROYING
    SAVING -->|"Save error or timeout"| SAVE_FAILED
    SAVE_FAILED -->|"Admin destroys VM"| DESTROYING
    DESTROYING -->|"Server deleted"| CLOSED
  end

  ARCH ~~~ SM`;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function parseSubgraphBoxes(svg: string): Map<string, Rect> {
  const boxes = new Map<string, Rect>();
  const re = /<g class="subgraph" data-id="([^"]+)"[^>]*>\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g;
  for (const m of svg.matchAll(re)) {
    boxes.set(m[1], { x: +m[2], y: +m[3], width: +m[4], height: +m[5] });
  }
  return boxes;
}

function parseNodeBoxes(svg: string): Rect[] {
  const boxes: Rect[] = [];
  const re = /<g class="node" data-id="[^"]+"[^>]*>\s*(?:<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"|<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)")/g;
  for (const m of svg.matchAll(re)) {
    if (m[1]) {
      boxes.push({ x: +m[1], y: +m[2], width: +m[3], height: +m[4] });
    } else {
      const r = +m[7];
      boxes.push({ x: +m[5] - r, y: +m[6] - r, width: r * 2, height: r * 2 });
    }
  }
  return boxes;
}

describe('hierarchical subgraph layout and high-DPI raster export', () => {
  it('parses ~~~ ordering links without creating phantom subgraph nodes', () => {
    const parsed = parseMermaidSource(NESTED_ARCH_AND_SM);
    const ids = new Set(parsed.nodes.map((n) => n.id));
    expect(ids.has('ARCH')).toBe(false);
    expect(ids.has('SM')).toBe(false);
    expect(parsed.nodes).toHaveLength(25);
    expect(parsed.edges).toHaveLength(30);
  });

  it('stacks ARCH above SM, keeps cross-subgraph edges inside ARCH, and clears borders for labels', async () => {
    const result = await renderDiagram(
      NESTED_ARCH_AND_SM,
      ['svg', 'png', 'jpeg', 'html', 'mmd', 'pdf', 'drawio', 'excalidraw', 'json'],
      { offlineMode: true, title: 'arch-sm-regression' },
    );

    expect(result.svg).toBeDefined();
    const svg = result.svg!;
    const extent = readExtent(svg);
    expect(extent.minX).toBe(0);
    expect(extent.minY).toBe(0);

    const groups = parseSubgraphBoxes(svg);
    const arch = groups.get('ARCH')!;
    const sm = groups.get('SM')!;
    expect(arch).toBeDefined();
    expect(sm).toBeDefined();

    // ARCH stacks cleanly above SM under top-level flowchart TB.
    expect(arch.y + arch.height).toBeLessThan(sm.y);

    // Every nested subgraph sits inside ARCH.
    for (const childId of ['FE', 'BE', 'EXT', 'VM']) {
      const box = groups.get(childId)!;
      expect(box.x).toBeGreaterThanOrEqual(arch.x);
      expect(box.y).toBeGreaterThanOrEqual(arch.y);
      expect(box.x + box.width).toBeLessThanOrEqual(arch.x + arch.width);
      expect(box.y + box.height).toBeLessThanOrEqual(arch.y + arch.height);
    }

    // All edge segments are orthogonal, stay within viewBox, and intra-ARCH edges stay inside ARCH.
    const archNodes = new Set([
      'FE_PAGES', 'FE_API', 'CTRL', 'WRK', 'VIEWS', 'SVC', 'REPO', 'GW', 'MOD',
      'DB', 'SEEWEB', 'AIVB', 'BOOT', 'AGENT', 'KEYS', 'FSTAB',
    ]);
    const edgeRe = /<polyline class="edge" data-from="([^"]+)" data-to="([^"]+)"[^>]*points="([^"]+)"/g;
    for (const m of svg.matchAll(edgeRe)) {
      const pts = m[3].trim().split(/\s+/).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i].x - pts[i - 1].x);
        const dy = Math.abs(pts[i].y - pts[i - 1].y);
        expect(Math.min(dx, dy)).toBeLessThanOrEqual(1.5);
      }
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(extent.width);
        expect(p.y).toBeLessThanOrEqual(extent.height);
        if (archNodes.has(m[1]) && archNodes.has(m[2])) {
          expect(p.x).toBeGreaterThanOrEqual(arch.x);
          expect(p.y).toBeGreaterThanOrEqual(arch.y);
          expect(p.x).toBeLessThanOrEqual(arch.x + arch.width);
          expect(p.y).toBeLessThanOrEqual(arch.y + arch.height);
          expect(overlaps({ x: p.x, y: p.y, width: 1, height: 1 }, sm)).toBe(false);
        }
      }
    }

    // Edge label pills do not collide with node boxes, subgraph borders/headers, or each other.
    const nodeBoxes = parseNodeBoxes(svg);
    const labelBoxes: Rect[] = [];
    const labelRe = /<g class="edge-label"[^>]*>\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g;
    for (const m of svg.matchAll(labelRe)) {
      labelBoxes.push({ x: +m[1], y: +m[2], width: +m[3], height: +m[4] });
    }
    expect(labelBoxes.length).toBeGreaterThanOrEqual(13);

    for (let i = 0; i < labelBoxes.length; i++) {
      const lbl = labelBoxes[i];
      for (const n of nodeBoxes) expect(overlaps(lbl, n)).toBe(false);
      for (const g of groups.values()) {
        const header: Rect = { x: g.x, y: g.y, width: g.width, height: 28 };
        const top: Rect = { x: g.x, y: g.y - 2, width: g.width, height: 4 };
        const bot: Rect = { x: g.x, y: g.y + g.height - 2, width: g.width, height: 4 };
        const left: Rect = { x: g.x - 2, y: g.y, width: 4, height: g.height };
        const right: Rect = { x: g.x + g.width - 2, y: g.y, width: 4, height: g.height };
        for (const bar of [header, top, bot, left, right]) {
          expect(overlaps(lbl, bar)).toBe(false);
        }
      }
      for (let j = i + 1; j < labelBoxes.length; j++) {
        expect(overlaps(lbl, labelBoxes[j])).toBe(false);
      }
    }

    // Auto raster scale produces sharp high-resolution PNG and JPEG without downscaling to 1200px.
    const pngMeta = await sharp(result.png!).metadata();
    const jpegMeta = await sharp(result.jpeg!).metadata();
    expect(pngMeta.width!).toBeGreaterThan(extent.width);
    expect(pngMeta.height!).toBeGreaterThan(extent.height);
    expect(jpegMeta.width).toBe(pngMeta.width);

    // Every requested export artifact is generated and excludes phantom ARCH node.
    expect(result.html).toContain('AI-VM Layered MVC Architecture');
    expect(result.pdf?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.drawio).toContain('<mxfile');
    expect(JSON.parse(result.excalidraw!).elements.length).toBeGreaterThan(0);
    const ir = JSON.parse(result.json!);
    expect(ir.nodes.some((n: { id: string }) => n.id === 'ARCH')).toBe(false);
  }, 15_000);

  it('keeps explicit raster width overrides intact when provided', async () => {
    const result = await renderDiagram(NESTED_ARCH_AND_SM, ['png'], { width: 800 });
    const meta = await sharp(result.png!).metadata();
    expect(meta.width).toBe(800);
  });
});
