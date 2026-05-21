// Provider-agnostic tool definition + implementation.
//
// `TOOL_DEFINITION` is one canonical shape; agent-claude.ts and
// agent-openai.ts each adapt it into the format their SDK expects
// (Anthropic uses `input_schema`, OpenAI nests under `function`).
//
// `callGetWeatherTool` is the actual work the tool does:
//   1. Call the mock x402 weather service
//   2. If it returns 402, parse the payment terms
//   3. Pay via Tally
//   4. Retry the request with the tx hash in `x-payment` header
//   5. Return the weather data (or an error)
//
// The agent code calls this when the LLM decides to use the tool.

import type { Tally } from "@tallyforagents/sdk";

export interface ToolContext {
  tally: Tally;
  agentId: string;
  walletAddress: string;
  serviceUrl: string;
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

interface X402PaymentTerms {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: string;
  asset: string;
}

interface X402Response {
  x402Version: number;
  error?: string;
  accepts?: X402PaymentTerms[];
}

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

  // Step 1: first call. Expect 402.
  console.log(`  → GET ${url}`);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach weather service: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  if (response.status === 200) {
    return { ok: true, data: await response.json() };
  }

  if (response.status !== 402) {
    const body = await response.text();
    return {
      ok: false,
      error: `Unexpected status ${response.status}: ${body.slice(0, 200)}`,
    };
  }

  // Step 2: parse the x402 payment terms.
  let paymentTerms: X402Response;
  try {
    paymentTerms = (await response.json()) as X402Response;
  } catch {
    return { ok: false, error: "Service returned invalid 402 body" };
  }

  const terms = paymentTerms.accepts?.[0];
  if (!terms) {
    return { ok: false, error: "402 response had no accepts[] terms" };
  }

  if (terms.network !== "base-sepolia") {
    return {
      ok: false,
      error: `Unsupported network: ${terms.network} (this agent is configured for base-sepolia)`,
    };
  }

  const atomicAmount = BigInt(terms.maxAmountRequired);
  const decimalAmount = formatAtomicUSDC(atomicAmount);

  console.log(
    `  ← 402 Payment Required: ${decimalAmount} USDC to ${terms.payTo}`,
  );

  // Step 3: pay via Tally.
  console.log(`  → tally.payments.create()`);
  let payment;
  try {
    payment = await ctx.tally.payments.create({
      agent_id: ctx.agentId,
      wallet: ctx.walletAddress,
      to: terms.payTo,
      amount_usdc: decimalAmount,
      memo: `x402:weather/${input.city}`,
      idempotency_key: `weather-${input.city}-${Date.now()}`,
    });
  } catch (e) {
    return {
      ok: false,
      error: `Payment failed: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  if (!payment.tx_hash) {
    return { ok: false, error: "Tally returned no tx_hash" };
  }
  console.log(`  ← payment submitted: ${payment.tx_hash}`);

  // Step 4: retry with payment proof. The server will block until the
  // tx is confirmed on-chain (a few seconds on Base Sepolia).
  console.log(`  → GET ${url}  (X-Payment: ${payment.tx_hash.slice(0, 16)}…)`);
  let retryResponse: Response;
  try {
    retryResponse = await fetch(url, {
      headers: { "x-payment": payment.tx_hash },
    });
  } catch (e) {
    return {
      ok: false,
      error: `Retry failed: ${e instanceof Error ? e.message : "unknown"}`,
      payment: payment.tx_hash,
    };
  }

  if (retryResponse.status !== 200) {
    const body = await retryResponse.text();
    return {
      ok: false,
      error: `Retry rejected (${retryResponse.status}): ${body.slice(0, 200)}`,
      payment: payment.tx_hash,
    };
  }

  console.log(`  ← 200 OK\n`);

  return {
    ok: true,
    data: await retryResponse.json(),
    payment: payment.tx_hash,
  };
}

function formatAtomicUSDC(atomic: bigint): string {
  // USDC has 6 decimals. Convert atomic → decimal string without
  // trailing zeros (so "50000" → "0.05", not "0.050000").
  const whole = atomic / 1_000_000n;
  const frac = atomic % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}
