// examples/research-bot.ts
//
// Run with:
//   TALLY_API_KEY=tly_... pnpm --filter @tallyforagents/examples research-bot
//
// Against production (instead of local dev):
//   TALLY_BASE_URL=https://app.tallyforagents.com
//
// To reuse an existing agent instead of creating "research-bot":
//   TALLY_AGENT_ID=my-existing-agent-id
//
// Optional, for the payment step:
//   TALLY_WALLET=0x... TALLY_RECIPIENT=0x... TALLY_AMOUNT=0.01
//
// What this demonstrates:
//   1. Authenticating with a Tally API key from any external process.
//   2. Registering an agent (Phase 2). Idempotent on `id`.
//   3. Listing the agents on your Tally account.
//   4. Moving USDC on-chain through a granted permission (Phase 4):
//      `tally.payments.create()` returns a Payment with status=pending
//      and a `tx_hash` the moment Privy accepts the signed RPC.
//
// Prerequisite for step 4: in the Tally dashboard, grant this agent
// permission to spend from one of your wallets, then pass that
// wallet's address as TALLY_WALLET and a recipient as TALLY_RECIPIENT.

import {
  Tally,
  AuthenticationError,
  ValidationError,
  TallyError,
} from "@tallyforagents/sdk";

const apiKey = process.env.TALLY_API_KEY;
const baseUrl = process.env.TALLY_BASE_URL ?? "http://localhost:3000";
const agentId = process.env.TALLY_AGENT_ID ?? "research-bot";
const walletAddress = process.env.TALLY_WALLET;
const recipient = process.env.TALLY_RECIPIENT;
const amount = process.env.TALLY_AMOUNT ?? "0.01";

if (!apiKey) {
  console.error("Set TALLY_API_KEY in the environment.");
  console.error("Generate one in the dashboard under 'API keys'.");
  process.exit(1);
}

const tally = new Tally({ apiKey, baseUrl });

async function main() {
  console.log(`→ Tally API at ${baseUrl}\n`);

  // Step 1: register the agent. Idempotent on `id`.
  const agent = await tally.agents.upsert({ id: agentId });
  console.log("✓ Agent registered:");
  console.log(`    id              ${agent.id}`);
  console.log(`    mode            ${agent.mode}`);
  console.log(`    status          ${agent.status}`);
  console.log(`    active_signers  ${agent.active_signers}`);
  console.log(`    pending_signers ${agent.pending_signers}`);
  console.log(`    created_at      ${agent.created_at}\n`);

  // Step 2: prove idempotency. Re-running with the same id is safe.
  const again = await tally.agents.upsert({ id: agentId });
  console.log(
    again.id === agent.id
      ? "✓ Re-running upsert returned the same agent (idempotent)\n"
      : "✗ Re-run created a new agent — this should not happen\n",
  );

  // Step 3: list the agents on this account.
  const all = await tally.agents.list();
  console.log(`✓ ${all.length} agent${all.length === 1 ? "" : "s"} on this account (${agent.mode} mode):`);
  for (const a of all) {
    console.log(`    - ${a.id}  [${a.status}]`);
  }
  console.log("");

  // Step 4 (optional): move USDC if env vars are set.
  if (!walletAddress || !recipient) {
    console.log(
      "Skip payment: set TALLY_WALLET=0x… TALLY_RECIPIENT=0x… (and optionally\n" +
        "TALLY_AMOUNT) to demo a real on-chain transfer through the agent's grant.",
    );
    return;
  }
  if (agent.active_signers === 0) {
    console.log(
      `Skip payment: '${agent.id}' has no active permission grants yet. Grant\n` +
        "one in the dashboard, then re-run.",
    );
    return;
  }

  console.log(
    `→ Submitting payment: ${amount} USDC from ${walletAddress} → ${recipient}…\n`,
  );
  const payment = await tally.payments.create({
    agent_id: agent.id,
    wallet: walletAddress,
    to: recipient,
    amount_usdc: amount,
    memo: "research-bot example",
    idempotency_key: `research-bot-${Date.now()}`,
  });
  console.log("✓ Payment submitted to Privy:");
  console.log(`    id          ${payment.id}`);
  console.log(`    status      ${payment.status}`);
  console.log(`    tx_hash     ${payment.tx_hash}`);
  console.log(`    amount_usdc ${payment.amount_usdc}`);
  console.log(`    to          ${payment.to}`);
  console.log(`    from        ${payment.from}`);
}

main().catch((err) => {
  if (err instanceof AuthenticationError) {
    console.error("✗ Authentication failed.");
    console.error("  Your TALLY_API_KEY is missing, malformed, or revoked.");
  } else if (err instanceof ValidationError) {
    console.error(`✗ Validation error: ${err.message}`);
    if (err.details) console.error("  Details:", err.details);
  } else if (err instanceof TallyError) {
    console.error(`✗ Tally error (${err.type}, ${err.status}): ${err.message}`);
  } else {
    console.error("✗ Unexpected error:", err);
  }
  process.exit(1);
});
