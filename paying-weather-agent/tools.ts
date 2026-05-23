// Provider-agnostic tool definition + implementation.
//
// `TOOL_DEFINITION` is one canonical shape; agent-claude.ts and
// agent-openai.ts each adapt it into the format their SDK expects
// (Anthropic uses `input_schema`, OpenAI nests under `function`).
//
// `callGetWeatherTool` is the actual work the tool does. The full
// x402 dance (initial fetch → parse 402 terms → pay via Tally → retry
// with X-Payment header) lives inside the SDK as `tally.x402.fetch`;
// this tool just calls it with a URL.
//
// The agent code calls this when the LLM decides to use the tool.

import type { Tally } from "@tallyforagents/sdk";
import { TallyError } from "@tallyforagents/sdk";

export interface ToolContext {
  tally: Tally;
  agentId: string;
  walletAddress: string;
  serviceUrl: string;
  /** Optional accumulator for payment receipts. When the caller sets
   *  this to an empty array, `callGetWeatherTool` pushes one entry per
   *  successful Tally payment. The chat UI server uses this to render
   *  receipt chips below the assistant's reply; the CLI doesn't set it
   *  and the field stays unused. */
  payments?: ToolPaymentReceipt[];
}

export interface ToolPaymentReceipt {
  txHash: string;
  amountUsdc: string;
  to: string;
  memo: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  payment?: string;
  error?: string;
}

export const TOOL_DEFINITION = {
  name: "get_weather",
  description:
    "Get the current weather for a city. This tool is paywalled: " +
    "the first call returns 402 Payment Required with an amount; the tool " +
    "automatically pays via the user's Tally wallet and retries. Use this " +
    "when the user wants accurate, current weather data.",
  parameters: {
    type: "object" as const,
    properties: {
      city: {
        type: "string" as const,
        description: "The city name (e.g., 'Tokyo', 'San Francisco', 'London')",
      },
    },
    required: ["city"],
  },
};

export async function callGetWeatherTool(
  ctx: ToolContext,
  input: { city: string },
): Promise<ToolResult> {
  // serviceUrl IS the full resource path; the example doesn't
  // assume a /weather subpath because the hosted endpoint
  // (https://app.tallyforagents.com/api/demo/x402-weather) is
  // already at the resource. For the local server.ts, set
  // WEATHER_SERVICE_URL=http://localhost:4242/weather (which the
  // server listens on).
  const url = `${ctx.serviceUrl}?city=${encodeURIComponent(input.city)}`;
  console.log(`  → GET ${url}`);

  let result;
  try {
    result = await ctx.tally.x402.fetch(url, {
      agent_id: ctx.agentId,
      wallet: ctx.walletAddress,
      memo: `x402:weather/${input.city}`,
      idempotency_key: `weather-${input.city}-${Date.now()}`,
    });
  } catch (e) {
    if (e instanceof TallyError) {
      return { ok: false, error: `${e.type}: ${e.message}` };
    }
    return {
      ok: false,
      error: `x402 fetch failed: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  if (result.payment) {
    console.log(
      `  ← 402 Payment Required: ${result.payment.amount_usdc} USDC to ${result.payment.to}`,
    );
    console.log(`  ← payment submitted: ${result.payment.tx_hash}`);
    console.log(
      `  → GET ${url}  (X-Payment: ${result.payment.tx_hash.slice(0, 16)}…)`,
    );

    // Record the receipt if the caller is collecting them (chat UI
    // does; CLI doesn't). Done after the SDK signals success so
    // partial-payment failures don't show up as completed receipts.
    ctx.payments?.push({
      txHash: result.payment.tx_hash,
      amountUsdc: result.payment.amount_usdc,
      to: result.payment.to,
      memo: `weather/${input.city}`,
    });
  }

  if (!result.response.ok) {
    const body = await result.response.text();
    return {
      ok: false,
      error: `Service returned ${result.response.status}: ${body.slice(0, 200)}`,
      payment: result.payment?.tx_hash,
    };
  }

  console.log(`  ← 200 OK\n`);
  return {
    ok: true,
    data: await result.response.json(),
    payment: result.payment?.tx_hash,
  };
}
