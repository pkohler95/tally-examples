// Entry point for the paying weather agent example.
//
// Run with:
//   pnpm --filter @tallyforagents/examples weather-agent "what's the weather in Tokyo?"

import "./load-env"; // Loads .env.local from this directory; see load-env.ts.
//
// What it does:
//   1. Detects which LLM provider to use (Anthropic preferred if both
//      keys are set; OpenAI otherwise)
//   2. Registers the configured agent on Tally (idempotent)
//   3. Looks up which wallet the agent can spend from (returned by
//      the enriched agent.wallets array — no TALLY_WALLET env needed)
//   4. Runs the agent loop with the user's task as the prompt
//   5. The LLM decides to call `get_weather`, which routes through
//      the x402 mock server. The tool handles the 402, calls
//      tally.payments.create(), then retries with the tx hash.
//   6. Prints the final LLM response.

import { Tally } from "@tallyforagents/sdk";
import { runClaudeAgent } from "./agent-claude";
import { runOpenAIAgent } from "./agent-openai";
import type { ToolContext } from "./tools";

const apiKey = process.env.TALLY_API_KEY;
const baseUrl =
  process.env.TALLY_BASE_URL ?? "https://app.tallyforagents.com";
const agentId = process.env.TALLY_AGENT_ID ?? "weather-agent";
// Defaults to Tally's hosted demo endpoint so the example is one-
// terminal clone-and-run. To use the local server.ts in this
// directory (e.g. to inspect / modify the server logic), set
// WEATHER_SERVICE_URL=http://localhost:4242 in .env.local and run
// `pnpm weather-server` in a second terminal.
const serviceUrl =
  process.env.WEATHER_SERVICE_URL ??
  "https://app.tallyforagents.com/api/demo/x402-weather";

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
  console.log("  Unset ANTHROPIC_API_KEY to force OpenAI for a run.\n");
}

const task = process.argv.slice(2).join(" ").trim();
if (!task) {
  console.error(
    '✗ Usage: pnpm --filter @tallyforagents/examples weather-agent "<your task>"',
  );
  console.error('  Example: "what\'s the weather in Tokyo?"');
  process.exit(1);
}

async function main() {
  const tally = new Tally({ apiKey: apiKey!, baseUrl });

  console.log(`→ Tally API at ${baseUrl}`);
  console.log(`→ Registering agent "${agentId}"...`);
  const agent = await tally.agents.upsert({ id: agentId });

  if (agent.wallets.length === 0) {
    console.error(
      `\n✗ Agent "${agentId}" has no active permissions on any wallet.`,
    );
    console.error(
      "  Open the Tally dashboard, find this agent, and grant it a",
    );
    console.error(
      "  permission on a funded wallet. Recommended caps: $10/tx, $100/day.",
    );
    console.error(`  The mock weather service charges 0.05 USDC per query.`);
    process.exit(1);
  }

  const wallet = agent.wallets[0];
  console.log(
    `→ Using wallet "${wallet.display_name}" (${wallet.address.slice(0, 10)}…)`,
  );
  console.log(
    `  caps: $${wallet.max_per_tx_usdc}/tx, $${wallet.daily_cap_usdc ?? "uncapped"}/day\n`,
  );

  console.log(`→ Weather service: ${serviceUrl}`);
  console.log(`→ Provider: ${provider === "claude" ? "Anthropic Claude" : "OpenAI"}\n`);

  console.log(`Task: ${task}\n`);
  console.log("─".repeat(60));

  const start = Date.now();
  const ctx: ToolContext = {
    tally,
    agentId: agent.id,
    walletAddress: wallet.address,
    serviceUrl,
  };

  const result =
    provider === "claude"
      ? await runClaudeAgent(task, ctx)
      : await runOpenAIAgent(task, ctx);

  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log("─".repeat(60));
  console.log(`\n✓ Agent response (${duration}s):\n`);
  console.log(result);
  console.log("");
}

main().catch((err) => {
  console.error(
    "\n✗ Error:",
    err instanceof Error ? `${err.name}: ${err.message}` : err,
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split("\n").slice(1, 4).join("\n"));
  }
  process.exit(1);
});
