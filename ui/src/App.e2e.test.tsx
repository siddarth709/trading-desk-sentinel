import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import http from "node:http";
import App from "./App";

expect.extend(matchers);

const PORT = 8790;
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const url = req.url || "";
      if (req.method === "POST" && (url.endsWith("/sessions") || url === "/api/v1/sessions")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              id: "session-mock-123",
              agent: { type: "reference", name: "trading-desk-sentinel", id: "agent-123" },
              createdAt: new Date().toISOString(),
              status: "idle",
            },
          }),
        );
        return;
      }

      if (req.method === "POST" && (url.includes("/turns") || url.endsWith("/turns"))) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const parsed = JSON.parse(body || "{}");
        const inputs = parsed.input || [];
        const isApproval = inputs.some((i: { type: string }) => i.type === "user.tool_approval");

        if (!isApproval) {
          // First turn: read-only tool call, then destructive tool call requiring approval
          const events = [
            {
              id: "evt-1",
              type: "model.message.delta",
              thread_id: "main",
              created_at: new Date().toISOString(),
              tool_calls: [
                {
                  id: "call-1",
                  index: 0,
                  type: "function",
                  function: { name: "get_recent_orders", arguments: '{"limit":5}' },
                },
              ],
            },
            {
              id: "evt-2",
              type: "tool.response",
              thread_id: "main",
              created_at: new Date().toISOString(),
              tool_call_id: "call-1",
              content: "[]",
            },
            {
              id: "evt-3",
              type: "model.message.delta",
              thread_id: "main",
              created_at: new Date().toISOString(),
              tool_calls: [
                {
                  id: "call-2",
                  index: 0,
                  type: "function",
                  function: { name: "flatten_position", arguments: '{"symbol":"AAPL"}' },
                },
              ],
            },
            {
              id: "evt-4",
              type: "tool.approval_required",
              thread_id: "main",
              created_at: new Date().toISOString(),
              tool_calls: [{ id: "call-2", source_event_id: "evt-3" }],
            },
          ];

          for (const ev of events) {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          }
          res.end();
        } else {
          // Second turn: approval granted, position closed
          const events = [
            {
              id: "evt-5",
              type: "tool.response",
              thread_id: "main",
              created_at: new Date().toISOString(),
              tool_call_id: "call-2",
              content: '{"status":"closed"}',
            },
            {
              id: "evt-6",
              type: "model.message.delta",
              thread_id: "main",
              created_at: new Date().toISOString(),
              content: "Position closed successfully at market.",
            },
          ];

          for (const ev of events) {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          }
          res.end();
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
});

afterAll(() => {
  server.close();
});

describe("Trading Desk Sentinel dashboard (against the mock TrueForge server)", () => {
  it("streams an investigation and reaches the approval gate for a destructive tool call", async () => {
    render(<App />);

    expect(screen.getByText(/Trading Desk Sentinel/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Launch Incident Analyzer/i }));
    expect(screen.getByTestId("status-pill")).toHaveTextContent("Standing by");
    await user.click(screen.getByRole("button", { name: /Run Investigation/i }));

    // Status flips to Investigating almost immediately.
    await waitFor(() => expect(screen.getByTestId("status-pill")).toHaveTextContent("Investigating"), { timeout: 3000 });

    // The mock server streams a read-only tool call first...
    await waitFor(() => expect(screen.getByText("get_recent_orders")).toBeInTheDocument(), { timeout: 5000 });

    // ...then proposes flatten_position, which must pause for approval —
    // this is the assertion that actually matters for the Control & Safety criterion.
    await waitFor(() => expect(screen.getByTestId("status-pill")).toHaveTextContent("Waiting for you"), { timeout: 5000 });
    await waitFor(() => expect(screen.getAllByText("flatten_position").length).toBeGreaterThan(0));
    expect(screen.getByText(/Nothing has been changed yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deny/i })).toBeInTheDocument();

    // Approve — the turn resumes and the mock server reports the position closed.
    await user.click(screen.getByRole("button", { name: /Approve/i }));
    await waitFor(() => expect(screen.getByTestId("status-pill")).toHaveTextContent("Investigation complete"), { timeout: 5000 });
    expect(screen.getByText(/Position closed/i)).toBeInTheDocument();
  }, 15000);
});
