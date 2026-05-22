# Paying weather agent

A self-contained example of an LLM agent that autonomously pays for
a paywalled API call. Demonstrates the [x402][x402] payment protocol
shape (HTTP 402 with payment terms, retry with payment proof) with
Tally providing the wallet + permission layer.

Runs against **Base Sepolia testnet**. No real money involved — but
the on-chain verification step is real (the mock server checks the
payment landed on-chain before returning data).

[x402]: https://www.x402.org

## What you'll see

```
$ pnpm weather-agent "what's the weather in Tokyo?"

→ Tally API at https://app.tallyforagents.com
→ Registering agent "weather-agent"...
→ Using wallet "Main Wallet" (0xD85b900A...)
  caps: $10/tx, $100/day

→ Weather service: http://localhost:4242
→ Provider: Anthropic Claude

Task: what's the weather in Tokyo?

────────────────────────────────────────────────────────────
  → GET http://localhost:4242/weather?city=Tokyo
  ← 402 Payment Required: 0.05 USDC to 0xDEAD...
  → tally.payments.create()
  ← payment submitted: 0xabc123...
  → GET http://localhost:4242/weather?city=Tokyo  (X-Payment: 0xabc123…)
  ← 200 OK

────────────────────────────────────────────────────────────

✓ Agent response (4.2s):

The weather in Tokyo is currently 14°C with light rain and 78% humidity.
```

The LLM decides to call the `get_weather` tool. The tool hits the
weather service, gets a 402, calls Tally to pay 0.05 USDC, retries
with the tx hash, and returns the data. The LLM formats a friendly
answer.

## Prerequisites

You'll need a Tally account with one **agent that has an active
permission** on a **funded wallet**. If you haven't done this yet,
the steps in the dashboard are:

1. **Sign in** at [app.tallyforagents.com](https://app.tallyforagents.com).
   First sign-in auto-provisions an account and a "Main Wallet."
2. **Fund the wallet** with a small amount of Base Sepolia USDC and
   ETH. ~$1 of USDC + ~0.01 ETH covers many runs:
   - USDC: [Circle's faucet](https://faucet.circle.com)
     → Base Sepolia → paste your Main Wallet address
   - ETH: [Alchemy's Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia)
3. **Register an agent.** Dashboard → Agents → "Register agent" →
   give it the ID `weather-agent` (the default this example
   registers — matches the `TALLY_AGENT_ID` default, so you won't
   need to override anything). Or use any name and set
   `TALLY_AGENT_ID=<your-id>` in `.env.local` later.
4. **Grant a permission** to that agent on your Main Wallet.
   Dashboard → Agents → click the agent → "Grant permission" → pick
   the wallet, accept the defaults ($10/tx, $100/day), approve via
   passkey. The mock weather service charges $0.05 per query, so the
   defaults are more than enough.
5. **Create an API key.** Dashboard → API keys → "Create new key" →
   copy the plaintext (shown once). You'll paste this in `.env.local`.

You'll also need one of these API keys for the LLM side:

- **Anthropic API key** (recommended — the example was built and
  tested against Claude), or
- **OpenAI API key** (works just as well)

The example auto-detects which you have. If you set both, Anthropic
wins; unset `ANTHROPIC_API_KEY` to force OpenAI for a run.

## Setup

From the repo root:

```bash
pnpm install
# Make sure the SDK is built (the `prepare` script handles this on
# fresh installs; if you've been editing the SDK source, rebuild):
pnpm --filter @tallyforagents/sdk build
```

Then in `examples/paying-weather-agent/`:

```bash
cp .env.example .env.local
# Fill in TALLY_API_KEY + one of ANTHROPIC_API_KEY / OPENAI_API_KEY
# If your agent ID isn't "weather-agent", also set TALLY_AGENT_ID.
```

## Run it

Two ways. Same agent, same payment flow — only the interface differs.

### Option A — chat UI (recommended for showing the demo)

```bash
pnpm --filter @tallyforagents/examples weather-chat
```

Opens an HTTP server on `http://localhost:4243`. Open that URL in a
browser and ask about the weather. Each assistant reply shows a chip
underneath with the amount paid + a link to the on-chain transaction
on Basescan. Override the port with `CHAT_PORT=<port>` if 4243 is
taken.

### Option B — single CLI invocation

By default the agent talks to Tally's hosted demo x402 endpoint, so
one terminal is enough:

```bash
pnpm --filter @tallyforagents/examples weather-agent "what's the weather in Tokyo?"
```

Try a few different cities. Seeded data covers Tokyo, San Francisco
(or SF), London, New York (or NYC), Los Angeles (or LA), Paris,
Berlin, and Sydney; unknown cities get a generic fallback.

### Optional: run your own x402 server

To learn how an x402 server works (or to modify the logic), the
included `server.ts` is a ~150-line standalone Node implementation
that does the same thing as the hosted endpoint.

Set `WEATHER_SERVICE_URL=http://localhost:4242/weather` in
`.env.local`, then in two terminals:

```bash
# Terminal 1
pnpm --filter @tallyforagents/examples weather-server

# Terminal 2 — either UI works
pnpm --filter @tallyforagents/examples weather-chat
# or:
pnpm --filter @tallyforagents/examples weather-agent "what's the weather in Tokyo?"
```

## Configuration

All env vars live in `.env.local`. See `.env.example` for the full
list. The defaults are sensible — you should only need to set the
ones marked **required**.

| Var | Required | Default | Notes |
|---|---|---|---|
| `TALLY_API_KEY` | yes | — | Get one from the Tally dashboard |
| `ANTHROPIC_API_KEY` | one of these two | — | Preferred if both are set |
| `OPENAI_API_KEY` | one of these two | — | Used when ANTHROPIC_API_KEY is unset |
| `TALLY_BASE_URL` | no | `https://app.tallyforagents.com` | Set to localhost:3000 for dev |
| `TALLY_AGENT_ID` | no | `weather-agent` | The agent the example registers |
| `WEATHER_SERVICE_URL` | no | hosted demo endpoint | Set to `http://localhost:4242/weather` to use the local `server.ts` |
| `WEATHER_SERVICE_WALLET` | no | `0x...dEaD` | Only used by `server.ts` if you run it locally |
| `BASE_SEPOLIA_RPC_URL` | no | public endpoint | Set to your Alchemy key for less rate-limiting |
| `CLAUDE_MODEL` | no | `claude-sonnet-4-5` | Pick a different Claude model |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Pick a different OpenAI model |

## How it works

1. **Agent registration.** `tally.agents.upsert({ id })` registers
   (or finds) the agent. The response includes `agent.wallets[]` —
   the wallets the agent has been granted permission to spend from.
   For most setups you'll grant one wallet per agent, and the
   example uses `wallets[0]` directly.
2. **LLM tool loop.** The agent is given one tool: `get_weather`.
   The LLM decides when to call it based on the user's task.
3. **The tool calls the weather service.** First call returns
   `402 Payment Required` with an x402-shaped body specifying:
   amount (`0.05` USDC), recipient address, network (Base Sepolia),
   asset (USDC contract).
4. **The tool pays via Tally.** `tally.payments.create({ agent_id,
   wallet, to, amount_usdc })`. Tally checks the permission, signs
   via the agent's authorization key (stored in AWS KMS, decrypted
   in-memory only for this call), and broadcasts through Privy's
   enclave. Returns a tx hash.
5. **The tool retries with the tx hash** in the `X-Payment` header.
6. **The server verifies on-chain.** `viem`'s
   `waitForTransactionReceipt` waits for confirmation (a few
   seconds on Base Sepolia), then walks the receipt logs for a USDC
   `Transfer` event with the right recipient and at-least amount.
7. **The server returns the weather data.** The LLM gets it back as
   a tool result and writes a final answer.

## Demo simplifications (vs. real x402)

This example is intentionally not 100% spec-compliant — it's an
educational starting point, not a production-ready x402 client. If
you're integrating with a real x402 service, you'll need:

| Demo | Real x402 |
|---|---|
| Bare tx hash in `X-Payment` header | Base64-encoded payment payload with full proof |
| No replay protection | Server tracks used tx hashes |
| No request-window check | Server rejects txs older than a few minutes |
| Single payment scheme (`exact`) | Multiple schemes; client picks one |
| Hardcoded USDC + Base Sepolia | Negotiated from `accepts[]` array |

The agent-side flow is unchanged — the LLM, the tool definition,
the Tally payment call all work identically against a real x402
service.

## Troubleshooting

**`Agent "weather-agent" has no active permissions on any wallet`**
Sign into the dashboard, find the agent (it'll be there after the
first run — `upsert` registered it), grant it a permission on a
funded wallet.

**`Payment verification failed: No matching USDC Transfer`**
The verifier didn't find a matching log in the receipt. Most likely
the `WEATHER_SERVICE_WALLET` in your `.env.local` doesn't match the
one the server is running with. They have to be the same address.

**`Could not fetch receipt`**
The public Base Sepolia RPC may be rate-limiting you. Set
`BASE_SEPOLIA_RPC_URL` to an Alchemy / QuickNode endpoint and try
again.

**LLM refuses to call the tool**
Some models are skittish about paying without confirmation. Try a
more capable model (e.g., `CLAUDE_MODEL=claude-sonnet-4-5` or
`OPENAI_MODEL=gpt-4o`).
