# Trading Desk Sentinel

An incident-response agent, built on [TrueForge](https://github.com/truefoundry/trueforge),
that investigates anomalies in a paper-trading account — a drawdown, an
unexpected position, a risk-limit breach — and pauses for a human's
explicit approval before doing anything irreversible.

Built for **The Agent Harness Hackathon** (WeMakeDevs × TrueFoundry × Qodo),
targeting three tracks directly:

- **Best Use of TrueForge** — the approval gate is enforced by the harness's
  own MCP-annotation policy, not a prompt instruction; the skill and sandbox
  surfaces are used as documented, not worked around.
- **Best Code Quality** — npm workspaces, ESLint (zero errors across the
  repo), a real test suite (8 passing tests in `mcp-server`, including a
  live-server MCP protocol integration test; a jsdom end-to-end test in
  `ui`), CI on every PR, and a documented Qodo review process.
- **Best UI** — a web dashboard (`ui/`) that streams the investigation live
  and shows a dedicated approval card before any destructive action.

It targets the hackathon's "Incident responder" hero project idea, applied
to a real domain: the same Alpaca paper account traded autonomously by a
separate project, **[Options Alpha Agent (OAA)](../oaa)** — closing the loop
between "an agent that trades" and "an agent that watches the agent that
trades."

## Why this qualifies as harness-central, not a thin wrapper

- **Real tools, not mocks.** `mcp-server/` is a real MCP server over the
  Alpaca Paper Trading API — account, positions, orders, portfolio history.
- **Destructive tools, correctly annotated.** `flatten_position` and
  `disable_strategy` are the only two tools marked `destructiveHint: true`.
  TrueForge's default policy (`require_approval_for_tools: ["@destructive"]`)
  resolves directly from those MCP annotations — the harness is deciding
  what to gate, not a prompt instructing the model to "please ask first."
- **Skills.** `skills/trading-incident-response/SKILL.md` is a git-backed
  investigation playbook the agent loads via the sandbox, not baked into
  the system prompt.
- **Sandbox.** The agent's instructions explicitly push drawdown/timestamp
  arithmetic into the sandbox rather than asking the model to eyeball it.
- **Approval, demonstrated end to end — twice.** Both `client/src/run-incident.ts`
  (CLI) and `ui/src/App.tsx` (web) independently catch `tool.approval_required`
  and block on a human decision before resuming — the harness-level version
  of the same "irreversible step always stops for a person" principle
  already built into OAA's own `execution/order_builder.py`.

## Architecture

```
mcp-server/   Remote MCP server (Streamable HTTP) over Alpaca's paper API.
              4 read-only tools + 2 destructive tools (flatten_position,
              disable_strategy), annotated so TrueForge gates the latter.
              8 passing tests: unit tests for the Alpaca client (mocked
              fetch) + a live-server integration test of the real MCP
              protocol handshake and tool annotations.

agent/        trading-desk-sentinel.json — the full TrueForge agent spec:
              model, instructions, mcp_servers, skills, sandbox config.

skills/       trading-incident-response/SKILL.md — the investigation
              playbook: establish state -> locate anomaly -> find
              responsible fills -> check exposure -> state root cause ->
              only then propose an action.

client/       TypeScript CLI (run-incident.ts) that opens a session,
              streams the investigation live, and prompts a human before
              any approval-gated tool call resumes. scripts/register.ts
              registers the MCP connector, skill, and agent against a
              running TrueForge server via its HTTP API.

ui/           React + TypeScript web dashboard. Talks directly to a
              TrueForge server via @truefoundry/trueforge-sdk (the
              built-in TrueForge UI adapter hasn't shipped yet as of this
              build — see "What's verified" below). Streams the transcript
              live and shows a dedicated approval card for destructive
              tool calls. Verified with a jsdom end-to-end test against an
              inline, schema-accurate mock TrueForge server, since no
              browser is available to screenshot in the build environment.
              (`mock-server/` is separate — a standalone fake-TrueForge
              server for manual `npm run dev` testing, not what the
              automated test runs against.)
```

## Setup

```bash
# 0. Install everything (root + all workspaces)
npm install

# 1. Start TrueForge (separate terminal)
npx @truefoundry/trueforge

# 2. Start the MCP server
cd mcp-server
ALPACA_API_KEY=... ALPACA_SECRET_KEY=... npm run dev

# 3. Register the connector, skill, and agent
#    SKILL_REPO_URL must be this repo's real, pushed GitHub URL — the skill
#    is git-backed, so TrueForge fetches skills/trading-incident-response/
#    from it directly.
cd ../client
TRUEFORGE_BASE_URL=http://localhost:8790 \
SKILL_REPO_URL=https://github.com/<org>/trading-desk-sentinel \
npm run register

# 4. Connect a model provider under Settings -> Models in the TrueForge chat UI
#    (anthropic/claude-sonnet-4-6, or any provider you've configured)

# 5a. Run an investigation from the CLI
ALERT="OAA equity dropped 4.2% in the last hour" npm start

# 5b. ...or from the web dashboard
cd ../ui
npm run dev   # proxies /truforge-api to TRUEFORGE_BASE_URL (default localhost:8790)
```

## Development

```bash
npm run lint                        # ESLint across every workspace — zero errors
npm run typecheck                   # tsc --noEmit across every workspace
npm run build --workspace mcp-server  # mcp-server's test suite spawns dist/index.js —
                                       # build it first on a fresh clone
npm run test                        # vitest — see mcp-server/src/*.test.ts, ui/src/App.e2e.test.tsx
npm run build                       # production build for mcp-server, client, and ui
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, the mcp-server pre-build,
test, and build — in that order — on every push and PR.

## What's verified vs. what needs a live TrueForge instance

Everything in this repo was actually run, type-checked, or tested against
real installed packages during development — not just written and assumed
correct:

- The MCP server was started and hit with real MCP protocol calls
  (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) —
  now codified as an automated integration test (`mcp-server/src/index.test.ts`)
  that spawns the real server and asserts all 6 tools list with the correct
  `readOnlyHint`/`destructiveHint` annotations, and that a failed Alpaca call
  degrades gracefully instead of crashing the server.
- `client/src/run-incident.ts` and `client/scripts/register.ts` are
  type-checked clean against `@truefoundry/trueforge-sdk@0.1.3` as actually
  published to npm. Two real naming mistakes were caught and fixed this way.
- `ui/src/App.tsx` is production-build-verified (`vite build` succeeds) and
  covered by a jsdom end-to-end test (`ui/src/App.e2e.test.tsx`) that drives
  the real component through landing page -> launch analyzer -> run
  investigation -> tool call -> approval gate -> approve -> done, against a
  schema-accurate mock TrueForge server **built inline in the test file**
  (a local `http.createServer`, not `mock-server/` — see the note below).
  Building that mock against the SDK's actual `.d.ts` files (rather than
  assumed shapes) caught two further real bugs: a missing `{data: ...}`
  response envelope, and a wrong assumption that tool calls arrive as a
  standalone `model.message` event — the real wire protocol only has
  `model.message.delta`. jsdom also doesn't implement `Element.scrollIntoView`
  (it doesn't do layout), so `ui/src/setupTests.ts` stubs it as a no-op —
  otherwise the transcript auto-scroll effect throws in every test.
- What has **not** been run: an actual TrueForge server instance, registering
  these against it live, and a full end-to-end investigation with a real
  model and real Alpaca paper credentials. That requires a running TrueForge
  process and live API keys that don't exist in the environment this was
  built in. No screenshot of the running UI exists either, for the same
  reason (Chromium isn't obtainable in that environment) — the e2e test is
  the honest substitute.

> **What `mock-server/` actually is:** it's a standalone fake-TrueForge HTTP
> server for *interactive* development — run it locally and point
> `ui`'s dev proxy (`TRUEFORGE_BASE_URL`, default `http://127.0.0.1:8790`) at
> it to click through the dashboard by hand, complete with real Yahoo
> Finance data for a realistic equity curve. It is **not** what
> `App.e2e.test.tsx` runs against — that test is fully self-contained. If
> you're touching event-shape assumptions, update both: the inline mock in
> the test file, and `mock-server/server.mjs` for manual testing.

## Qodo Code Review Evidence

*(Fill in once this repo is pushed to GitHub and Qodo is connected —
required by the hackathon rules for every submission, not only the
Best Code Quality track.)*

- Merged PR: `<link to a representative PR with meaningful hackathon code>`
- What Qodo surfaced: `<1-2 sentences — what it flagged, what you changed
  or intentionally dismissed and why>`
- Follow-up review: `<link showing a second Qodo pass against the final code>`

## Safety

- Every write against Alpaca's paper API goes through `flatten_position` or
  `disable_strategy` — both `destructiveHint: true`, both gated by
  TrueForge's default approval policy.
- `disable_strategy` only flips a local kill-switch file; it cannot place
  or modify orders itself.
- No live-trading endpoint appears anywhere in this codebase — only
  `paper-api.alpaca.markets` (configurable via `ALPACA_BASE_URL`, but
  never defaulted to anything else — see the dedicated test for this in
  `mcp-server/src/alpaca.test.ts`).
- Keys are read from environment variables only; nothing is committed to
  the repo (`.gitignore` excludes `.env*` and `strategy_state.json`).

## Disclaimer

Hackathon project. Paper trading only. Nothing here is investment advice.
