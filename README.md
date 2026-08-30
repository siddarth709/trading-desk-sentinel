<div align="center">

# Trading Desk Sentinel

### A human-approved incident responder for paper-trading operations

Investigate an account anomaly, trace it to the relevant activity, and keep every consequential action behind an explicit approval gate.

[![CI](https://github.com/siddarth709/trading-desk-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/siddarth709/trading-desk-sentinel/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/Protocol-MCP-0F766E)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-F59E0B)](LICENSE)

> **Developer draft** — built as a hackathon prototype. It is intentionally designed for Alpaca **paper** accounts only and is not investment advice.

</div>

---

## Why this exists

An automated trading alert should lead to an explanation before it leads to an action. Trading Desk Sentinel turns an alert such as “equity dropped sharply during the last session” into a structured investigation:

1. Read the account and portfolio history.
2. Correlate the affected window with positions and orders.
3. State a plain-language root cause.
4. Propose an action only when the evidence supports it.
5. Pause for a person before running a destructive tool.

The approval boundary is part of the tool metadata and agent policy—not an instruction the model can simply ignore.

## What is in the repository

```text
                  ┌─────────────────────────┐
                  │  React dashboard / CLI   │
                  │  live transcript + gate  │
                  └────────────┬────────────┘
                               │ TrueForge events
                  ┌────────────▼────────────┐
                  │  Trading Desk Sentinel   │
                  │  agent + response skill  │
                  └────────────┬────────────┘
                               │ Streamable HTTP MCP
                  ┌────────────▼────────────┐
                  │    Alpaca Paper MCP      │
                  │ reads + approval-gated   │
                  │     destructive tools    │
                  └─────────────────────────┘
```

| Directory | Role |
| --- | --- |
| `mcp-server/` | Streamable HTTP MCP server for the Alpaca Paper API. |
| `agent/` | TrueForge agent manifest and tool-approval policy. |
| `skills/` | Git-backed incident-response playbook used by the agent. |
| `client/` | CLI runner plus registration script for a TrueForge instance. |
| `ui/` | React/Vite dashboard with streamed events and approval controls. |
| `mock-server/` | Lightweight TrueForge-compatible mock for UI development. |

## Tool surface and safety contract

The MCP service listens on `http://127.0.0.1:8791/mcp` by default.

| Tool | Access | Purpose |
| --- | --- | --- |
| `get_account` | Read-only | Account equity and buying-power context. |
| `get_portfolio_history` | Read-only | Locate the start and shape of an anomaly. |
| `get_positions` | Read-only | Inspect current exposure and P&L. |
| `get_recent_orders` | Read-only | Correlate an event with recent fills and order state. |
| `flatten_position` | Approval required | Close one named paper position at market. |
| `disable_strategy` | Approval required | Record a local kill-switch entry for a named symbol. |

`flatten_position` and `disable_strategy` have `destructiveHint: true`. The agent manifest requests approval for all destructive tools, and both the CLI and dashboard wait for the corresponding `tool.approval_required` event. No order is submitted before a user allows it.

## Quick start

### Prerequisites

- Node.js 20 or later
- An Alpaca **paper-trading** API key and secret
- A running TrueForge instance for live agent workflows

```bash
# Clone and install all npm workspaces.
git clone https://github.com/siddarth709/trading-desk-sentinel.git
cd trading-desk-sentinel
npm install

# Terminal 1 — launch the MCP server against Alpaca Paper.
ALPACA_API_KEY="your-paper-key" \
ALPACA_SECRET_KEY="your-paper-secret" \
npm run dev --workspace mcp-server

# Terminal 2 — start TrueForge.
npx @truefoundry/trueforge

# Terminal 3 — register the connector, skill, and agent.
TRUEFORGE_BASE_URL="http://127.0.0.1:8790" \
SKILL_REPO_URL="https://github.com/siddarth709/trading-desk-sentinel" \
npm run register --workspace client
```

Connect a model provider in the TrueForge settings, then choose either interface:

```bash
# CLI investigation
ALERT="Paper-account equity dropped noticeably in the last session. Investigate and report the root cause." \
npm run start --workspace client

# Browser dashboard
VITE_TRUEFORGE_BASE_URL="http://127.0.0.1:8790" npm run dev --workspace ui
# Open the URL printed by Vite (normally http://127.0.0.1:5173).
```

### UI-only development

You can exercise the dashboard without Alpaca credentials or a TrueForge instance:

```bash
PORT=8792 node mock-server/server.mjs
VITE_TRUEFORGE_BASE_URL="http://127.0.0.1:8792" npm run dev --workspace ui
```

The standalone mock server is for manual development. The UI test uses its own inline mock so that its expected event shapes remain explicit and self-contained.

## Developer workflow

Run these checks before opening a pull request:

```bash
npm run lint
npm run typecheck
npm run build --workspace mcp-server
npm run test
npm run build
```

The CI workflow runs the same sequence on pull requests and pushes to `main`.

## Design notes

- **Paper only:** the Alpaca integration is pinned to the paper endpoint; non-paper `ALPACA_BASE_URL` overrides are rejected at runtime.
- **Evidence first:** the agent playbook calls for account state, history, positions, and orders before it proposes an intervention.
- **Approval is structural:** destructive annotations and the TrueForge policy enforce the pause; it is not reliant on prompt wording.
- **Least surprise:** when the investigation is inconclusive, the intended behavior is to report uncertainty and stop.
- **Secrets stay local:** provide credentials through environment variables. Do not commit `.env` files or the generated `strategy_state.json` kill-switch state.

## Repository map

```bash
# MCP server
npm run dev --workspace mcp-server
npm run build --workspace mcp-server

# CLI and TrueForge registration
npm run dev --workspace client
npm run register --workspace client

# Dashboard
npm run dev --workspace ui
npm run test --workspace ui
```

## Contributing

Keep changes focused, type-safe, and verified. The complete local setup and verification expectations are in [CONTRIBUTING.md](CONTRIBUTING.md). In particular, test changes to MCP annotations or event handling against the actual installed SDK interfaces rather than relying on remembered protocol shapes.

## Disclaimer

This is an experimental developer project for paper-trading incident response. It does not provide financial advice, and it should not be used to operate a live trading account.
