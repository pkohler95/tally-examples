// Chat UI server for the paying weather agent example.
//
// Boots a tiny stdlib HTTP server with two routes:
//   GET  /                → chat-ui.html (vanilla-JS chat front-end)
//   POST /api/chat        → runs the existing agent loop against the
//                            user's message and returns { text, payments }
//
// Reuses everything from the CLI (index.ts) — same Tally client, same
// agent + wallet lookup, same provider auto-detection. The only new
// surface is the HTTP server itself plus the payments-receipt
// accumulator on ToolContext (see tools.ts).
//
// Run with:
//   pnpm --filter @tallyforagents/examples weather-chat
// Then open http://localhost:4243 in your browser.
//
// Override the port with CHAT_PORT=<port> in .env.local if needed.

import "./load-env";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Tally } from "@tallyforagents/sdk";
import { runClaudeAgent } from "./agent-claude";
import { runOpenAIAgent } from "./agent-openai";
import type { ToolContext, ToolPaymentReceipt } from "./tools";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- env validation (mirrors index.ts) ----------------------------

const apiKey = process.env.TALLY_API_KEY;
const baseUrl =
  process.env.TALLY_BASE_URL ?? "https://app.tallyforagents.com";
const agentId = process.env.TALLY_AGENT_ID ?? "weather-agent";
const serviceUrl =
  process.env.WEATHER_SERVICE_URL ??
  "https://app.tallyforagents.com/api/demo/x402-weather";
const port = Number(process.env.CHAT_PORT ?? 4243);

if (!apiKey) {
  console.error("✗ Set TALLY_API_KEY in your environment.");
  console.error("  Get one from the Tally dashboard under 'API keys'.");
  process.exit(1);
}

const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAI = !!process.env.OPENAI_API_KEY;

if (!hasAnthropic && !hasOpenAI) {
  console.error(
    "✗ Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.",
  );
  console.error("  The example picks whichever is set; Anthropic wins ties.");
  process.exit(1);
}

const provider: "claude" | "openai" = hasAnthropic ? "claude" : "openai";

if (hasAnthropic && hasOpenAI) {
  console.log(
    "ℹ Both ANTHROPIC_API_KEY and OPENAI_API_KEY are set — using Anthropic.",
  );
}

// ---- boot: register agent + lookup wallet -------------------------

console.log(`→ Tally API at ${baseUrl}`);
console.log(`→ Registering agent "${agentId}"...`);

const tally = new Tally({ apiKey, baseUrl });
const agent = await tally.agents.upsert({ id: agentId });

if (agent.wallets.length === 0) {
  const dashboardUrl = `${baseUrl}/${agent.account_slug}/agents/${encodeURIComponent(agent.id)}`;
  console.error(
    `\n✗ Agent "${agentId}" has no active permissions on any wallet.`,
  );
  console.error(`  Grant one in the dashboard:`);
  console.error(`  ${dashboardUrl}`);
  console.error(``);
  console.error(
    `  Click "Grant permission", pick a funded wallet, accept the defaults`,
  );
  console.error(
    `  ($10/tx, $100/day), and approve via passkey. The weather service`,
  );
  console.error(`  charges 0.05 USDC per query.`);
  process.exit(1);
}

const wallet = agent.wallets[0];

console.log(
  `→ Using wallet "${wallet.display_name}" (${wallet.address.slice(0, 10)}…)`,
);
console.log(
  `  caps: $${wallet.max_per_tx_usdc}/tx, $${wallet.daily_cap_usdc ?? "uncapped"}/day`,
);
console.log(`→ Weather service: ${serviceUrl}`);
console.log(`→ Provider: ${provider === "claude" ? "Anthropic Claude" : "OpenAI"}\n`);

// ---- HTTP server --------------------------------------------------

// Load the UI page once at boot. Small enough to keep in memory.
const uiHtml = await readFile(resolve(__dirname, "chat-ui.html"), "utf8");

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // Cheap DoS guard. The chat input is short text; no legitimate
      // request needs more than a few KB.
      if (body.length > 16 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  // Root: serve the chat UI.
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(uiHtml);
    return;
  }

  // Health check / preflight.
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      agent: agent.id,
      wallet: wallet.address,
      provider,
    });
    return;
  }

  // Chat endpoint.
  if (req.method === "POST" && req.url === "/api/chat") {
    let parsed: unknown;
    try {
      parsed = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body." });
      return;
    }

    const message =
      typeof parsed === "object" && parsed && "message" in parsed
        ? (parsed as { message?: unknown }).message
        : undefined;

    if (typeof message !== "string" || message.trim().length === 0) {
      sendJson(res, 400, { error: "Missing 'message' field." });
      return;
    }

    const payments: ToolPaymentReceipt[] = [];
    const ctx: ToolContext = {
      tally,
      agentId: agent.id,
      walletAddress: wallet.address,
      serviceUrl,
      payments,
    };

    const start = Date.now();
    console.log(`\n[chat] user: ${message}`);
    try {
      const text =
        provider === "claude"
          ? await runClaudeAgent(message, ctx)
          : await runOpenAIAgent(message, ctx);
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[chat] assistant (${duration}s, ${payments.length} payment(s))`);
      sendJson(res, 200, { text, payments, duration_s: Number(duration) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent failed.";
      console.error(`[chat] error: ${msg}`);
      sendJson(res, 500, { error: msg });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`✓ Chat UI ready at http://localhost:${port}`);
  console.log("  Open it in your browser and ask about the weather.\n");
});
