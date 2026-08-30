<div align="center">

# Trading Desk Sentinel

**An AI incident-response agent that watches over your paper-trading desk, 
investigates anomalies in real time, and pauses for human approval 
before touching anything irreversible.**

[![CI](https://github.com/your-org/trading-desk-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/trading-desk-sentinel/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![TrueForge](https://img.shields.io/badge/Built%20on-TrueForge-6d28d9?logo=truefoundry&logoColor=white)](https://github.com/truefoundry/trueforge)
[![Alpaca MCP](https://img.shields.io/badge/MCP-Alpaca%20Paper%20API-10e598?logoColor=white)](https://alpaca.markets)
[![License](https://img.shields.io/badge/License-MIT-f59e0b)](./LICENSE)

Built for the **Agent Harness Hackathon** — WeMakeDevs × TrueFoundry × Qodo 
*Best Use of TrueForge · Best Code Quality · Best UI*

</div>

---

## What It Does

1. **Detects** — You or an upstream system fires an alert (e.g. *"OAA equity dropped 4.2% in the last hour"*). 
2. **Investigates** — The agent autonomously walks a 6-stage playbook: account state → anomaly location → responsible fills → risk exposure → root cause → proposed action. 
3. **Pauses** — Every destructive tool (`flatten_position`, `disable_strategy`) is annotated `destructiveHint: true`. TrueForge's default policy blocks execution and surfaces a **human-in-the-loop approval card** in the UI. 
4. **Acts** — Only after you click **Approve** does the agent proceed.

---

## Architecture

```

 Trading Desk Sentinel 

 mcp-server/ agent/ skills/ client/ 
 
 Streamable TrueForge agent Git-backed CLI runner 
 HTTP MCP spec with model, investigation + register 
 server over mcp_servers, playbook script 
 Alpaca Paper skills, sandbox (SKILL.md) 
 API config 
 
 4 read-only 
 + 2 write 
 tools 

 ui/ (React + Vite) 
 3-column dashboard · live SSE transcript · approval gate card 
 portfolio equity chart · position/order tables · stat panels 

```

| Workspace | Purpose |
|---|---|
| `mcp-server/` | Remote MCP server (Streamable HTTP) wrapping the Alpaca Paper Trading API. 4 read-only tools + `flatten_position` / `disable_strategy` (both `destructiveHint: true`). 8 passing tests including a live-protocol integration test. |
| `agent/` | `trading-desk-sentinel.json` — full TrueForge agent spec: model, instructions, MCP connectors, skills, sandbox config. |
| `skills/` | `trading-incident-response/SKILL.md` — git-backed investigation playbook the agent loads at runtime. |
| `client/` | TypeScript CLI (`run-incident.ts`) + `scripts/register.ts` to register connectors, skill and agent against a live TrueForge instance. |
| `ui/` | React + TypeScript dashboard. Streams transcript via TrueForge SDK, renders live charts and the approval card for destructive tool calls. |
| `mock-server/` | Standalone fake-TrueForge server for interactive local dev — pulls real Yahoo Finance candles for a realistic equity curve. |

---

## MCP Server

The MCP server exposes **6 tools** over Streamable HTTP at `http://localhost:8791/mcp`:

<table>
<thead>
<tr><th>Tool</th><th>Type</th><th>Description</th></tr>
</thead>
<tbody>
<tr><td><code>get_account</code></td><td> Read-only</td><td>Equity, cash, buying power, day-trade count</td></tr>
<tr><td><code>get_portfolio_history</code></td><td> Read-only</td><td>Equity time-series (1D / 1W / 1M periods, 15m bars)</td></tr>
<tr><td><code>get_positions</code></td><td> Read-only</td><td>Open positions with P&L and market value</td></tr>
<tr><td><code>get_orders</code></td><td> Read-only</td><td>Recent orders with fill prices and status</td></tr>
<tr><td><code>flatten_position</code></td><td> <strong>Destructive</strong></td><td>Market-sell an entire position — <strong>approval required</strong></td></tr>
<tr><td><code>disable_strategy</code></td><td> <strong>Destructive</strong></td><td>Write a local kill-switch file to halt the trading strategy — <strong>approval required</strong></td></tr>
</tbody>
</table>

> Destructive tools are annotated with `destructiveHint: true` in the MCP manifest. 
> TrueForge's `require_approval_for_tools: ["@destructive"]` policy picks this up automatically — **no prompt engineering required.**

---

## Quick Start

```bash
# 0. Install all workspaces
npm install

# 1. Start TrueForge (separate terminal)
npx @truefoundry/trueforge

# 2. Start the MCP server
ALPACA_API_KEY=<key> ALPACA_SECRET_KEY=<secret> \
 npm --workspace mcp-server run dev

# 3. Register connector, skill & agent
TRUEFORGE_BASE_URL=http://localhost:8790 \
SKILL_REPO_URL=https://github.com/<org>/trading-desk-sentinel \
 npm --workspace client run register

# 4. Connect a model provider
# → TrueForge UI → Settings → Models
# (anthropic/claude-sonnet-4-6, openai/gpt-4o, gemini/..., etc.)

# 5a. CLI investigation
ALERT="OAA equity dropped 4.2% in the last hour" \
 npm --workspace client start

# 5b. Web dashboard
npm --workspace ui run dev
# → http://127.0.0.1:5173
```

> **No API key yet?** Run `node mock-server/server.mjs` (port 8792) and set
> `TRUEFORGE_BASE_URL=http://127.0.0.1:8792` — the mock server streams a full
> simulated investigation with real Yahoo Finance equity data.

---

## Development

```bash
npm run lint # ESLint across all workspaces — zero errors
npm run typecheck # tsc --noEmit across all workspaces
npm run build --workspace mcp-server # build first (test suite spawns dist/)
npm run test # vitest — 8 MCP tests + 1 UI e2e test
npm run build # production build (mcp-server, client, ui)
```

CI (`.github/workflows/ci.yml`) runs **lint → typecheck → build(mcp-server) → test → build** on every push and PR.

---

## Safety

| Guarantee | How it's enforced |
|---|---|
| No live trading | Only `paper-api.alpaca.markets` — never defaulted to live (dedicated test in `alpaca.test.ts`) |
| Destructive ops need human approval | MCP `destructiveHint: true` + TrueForge policy — not a prompt instruction |
| `disable_strategy` can't place orders | Only writes a local `strategy_state.json` kill-switch file |
| No secrets committed | `.gitignore` excludes `.env*` and `strategy_state.json`; keys come from env vars only |

---

## Hackathon Track Alignment

<details>
<summary><strong>Best Use of TrueForge</strong></summary>

- Approval gating comes from MCP `destructiveHint` annotations → TrueForge's own policy, not a prompt instruction.
- Git-backed `SKILL.md` playbook loaded via the sandbox — not baked into the system prompt.
- Sandbox used for drawdown / timestamp arithmetic rather than asking the model to eyeball it.
- Both CLI and web UI independently implement the `tool.approval_required` workflow.

</details>

<details>
<summary><strong>Best Code Quality</strong></summary>

- npm workspaces monorepo, ESLint zero-error, strict TypeScript.
- Real test suite: 8 MCP tests (unit + live MCP protocol integration) + 1 UI e2e test (jsdom against an inline schema-accurate mock server).
- CI on every PR.
- Qodo review surfaced and fixed a real documentation/CI mismatch (PR #1).

</details>

<details>
<summary><strong>Best UI</strong></summary>

- 3-column glassmorphic dark dashboard.
- Live SSE transcript streaming with animated pulse.
- Real-time portfolio equity chart (Recharts).
- Dedicated approval card with Approve / Reject for destructive tool calls.
- No-glitch preloader (constrained SVG, critical inline CSS).

</details>

---

## Qodo Code Review Evidence

**Merged PR #1:** *Fix CI workflow and contributor guide command alignment*

Qodo flagged that `CONTRIBUTING.md` falsely claimed to document the exact CI sequence while CI omitted rebuilding `mcp-server` before tests. Resolved by aligning `.github/workflows/ci.yml` and `CONTRIBUTING.md` precisely.

---

## Disclaimer

Hackathon project. Paper trading only. Nothing here is investment advice.
