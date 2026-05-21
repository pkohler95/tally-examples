# tally-examples

Runnable examples for [Tally](https://www.tallyforagents.com), the
non-custodial financial layer for AI agents.

These examples use the published
[`@tallyforagents/sdk`](https://www.npmjs.com/package/@tallyforagents/sdk)
against the Tally public preview on Base Sepolia. Every example
makes real on-chain payments using testnet USDC — no production
funds at risk, but the integration is real end-to-end.

## What's in here

| Example | Demonstrates |
|---|---|
| [`research-bot.ts`](./research-bot.ts) | Bare SDK payment — register an agent, list, send a USDC transfer through a granted permission. No LLM. The simplest end-to-end demo. |
| [`paying-weather-agent/`](./paying-weather-agent) | LLM agent (Claude or OpenAI) that autonomously pays for paywalled API calls using the [x402](https://www.x402.org) protocol shape. Includes a mock x402 server with real on-chain payment verification via viem. |

## Prerequisites

1. **A Tally account** with an agent registered and a permission
   granted on a funded wallet. Walk through the
   [Quickstart](https://docs.tallyforagents.com/quickstart) to get
   set up.
2. **Sepolia USDC + ETH** in your Tally wallet. USDC from
   [Circle's faucet](https://faucet.circle.com), ETH from
   [Alchemy's Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia).
3. **Node.js 18+** and **pnpm** (or npm / yarn — adjust commands
   accordingly).

## Setup

```bash
git clone https://github.com/pkohler95/tally-examples.git
cd tally-examples
pnpm install
```

## Running an example

Each example has its own README with detailed instructions. The
short version:

**`research-bot.ts`** — single-shot SDK payment demo:

```bash
TALLY_API_KEY='tly_test_...' \
TALLY_BASE_URL='https://app.tallyforagents.com' \
TALLY_AGENT_ID='your-agent-id' \
TALLY_WALLET='0x...' \
TALLY_RECIPIENT='0x...' \
pnpm research-bot
```

**`paying-weather-agent/`** — LLM-powered x402 agent. See
[its README](./paying-weather-agent/README.md) for the full
walkthrough.

## Where to learn more

- **Docs**: https://docs.tallyforagents.com
- **SDK reference**: https://docs.tallyforagents.com/sdk/installation
- **Concepts**: https://docs.tallyforagents.com/overview
- **Marketing site**: https://www.tallyforagents.com

## Contributing

Bug reports + improvements welcome. File an issue or open a PR.

The examples here are kept in sync with the canonical source in the
Tally main repository (private during the public preview). If you
spot an issue, opening it here is the right place — we'll mirror
the fix.

## License

MIT. See [LICENSE](./LICENSE).
