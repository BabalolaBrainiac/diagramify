---
name: statechart-verification
description: "Model asynchronous workers, event loops, and distributed workflows as formal statecharts with TLC safety invariants using Diagramify. Factored for pstack v0.15.36 /statechart workflows to detect concurrency bugs, deadlocks, and race conditions."
version: 1.0.0
user-invocable: true
argument-hint: "[path] [--verify] [--out html,png,svg]"
license: MIT
---

# Statechart Verification

Use this skill to model asynchronous background processes as formal state machines.
This skill combines statechart modeling with formal invariant verification.
It detects concurrency bugs, deadlocks, unhandled socket events, and race conditions before code deploys.

## Core Principles

1. **State Space Decomposition**:
   - Deconstruct background daemons into explicit discrete states.
   - Separate socket listen loops, row claims, thread pool dispatch, and retry backoffs.
2. **Four Formal Safety Invariants**:
   - **Atomic Lock Before Dispatch**: Every claimed row requires an atomic lock before execution (`SKIP LOCKED`).
   - **Bounded Concurrency**: Thread pools must define a strict concurrency ceiling (`workers ≤ N`).
   - **Bounded Retry Backoff**: Error reconnection loops must specify a maximum sleep ceiling.
   - **Graceful Task Drain**: Signal handlers (`SIGINT`, `SIGTERM`) must drain in-flight jobs before socket closure.
3. **Brand Token Styling**:
   - Render diagrams using the Babalola design system.
   - Background: Forge Black (`#0a0a0a`) with subtle structural rules.
   - Socket Loops: Earlybird Teal (`#16aab9`).
   - Atomic Claims: Construction Orange (`#ff6b00`).
   - Thread Senders: Amber (`#ff8c38`).
   - Error Backoff: Negative Red (`#d83c38`).
   - Never copy third-party blueprint palettes.

---

## Agent Workflow

### Step 1: Discover Stateful Code and Event Loops

1. Scan for background worker daemons, Celery tasks, and socket event loops.
2. Locate PostgreSQL `LISTEN / NOTIFY` channels, Redis pub/sub, or message queues.
3. Identify database locking mechanisms (`SELECT ... FOR UPDATE`).
4. Identify signal handling and graceful termination routines.

### Step 2: Invoke Diagramify Statechart CLI

Run the statechart extraction and verification command:

```bash
# Generate statechart and run TLC invariant verification
diagramify statechart earlybird/earlybird-portal-api --verify --out html,png,svg
```

For focused worker analysis:

```bash
# Target a specific worker file
diagramify statechart earlybird/earlybird-portal-api/earlybird/conversation_reminder_worker.py --verify
```

### Step 3: Run Interactive State Simulation

1. Open the generated interactive HTML suite.
2. Click `Step` to step through the state transitions manually.
3. Click `Inject Drop` to verify that the worker recovers gracefully via exponential backoff.
4. Verify that the TLC formal model checker reports zero deadlocks and zero unhandled states.

---

## Command Reference

| Flag | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `[path]` | string | Path to codebase root or worker source file | `.` |
| `--verify` | boolean | Run TLC invariant verification on the state machine | `true` |
| `--theme` | string | Visual palette: `brand` (forge/orange/teal) | `brand` |
| `--out` | string | Output formats: `html`, `png`, `svg` | `html,png` |
| `--name` | string | Base name for generated files | `statechart` |

---

## Integration with pstack /statechart

This skill integrates with `pstack v0.15.36` `/statechart`:
1. Lowers code logic into a formal state machine Intermediate Representation.
2. Validates safety properties using the embedded TLC model checker.
3. Generates verified statecharts rendered with our brand tokens.
