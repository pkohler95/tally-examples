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
| [`paying-weather-agent/`](./paying-weather-agent) | LLM agent (Claude or OpenAI) that autonomously pays for paywalled API calls using the [x402](https://www.x402.org) protocol shape. Ships with a browser chat UI, a CLI mode, and a runnable local x402 server. Real on-chain payment verification via viem; live weather data via Open-Meteo. |

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

The full walkthrough lives in
[`paying-weather-agent/README.md`](./paying-weather-agent/README.md).
Quick start:

```bash
cd paying-weather-agent
cp .env.example .env.local    # fill in TALLY_API_KEY + ANTHROPIC_API_KEY (or OPENAI_API_KEY)
cd ..

# Browser chat UI (recommended):
pnpm weather-chat
# Then open http://localhost:4243

# Or a one-shot CLI:
pnpm weather-agent "what's the weather in Tokyo?"
```

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
