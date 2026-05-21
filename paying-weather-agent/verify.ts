// On-chain verification for the mock x402 weather service.
//
// The service can't trust the agent's claim that "I paid you, here's
// the tx hash." It has to verify the transaction actually exists on
// Base Sepolia, transferred at least the required amount of USDC, and
// landed in the service's wallet.
//
// viem's waitForTransactionReceipt blocks until the tx is confirmed
// (or times out). Base Sepolia typically confirms within 2-5 seconds,
// so the wait isn't long — but it's real, not faked. The dev sees
// "yes, on-chain verification is exactly what happens in production
// x402 services."

import { createPublicClient, http, decodeEventLog, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

// USDC contract address on Base Sepolia. This is the same USDC the
// rest of Tally uses (see lib/chain.ts in the main app).
//
// Mainnet swap (when Tally live mode enables): replace this address
// with 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 and the imported
// `baseSepolia` chain below with `base`.
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// Reuse Tally's prod RPC if BASE_SEPOLIA_RPC_URL is set; otherwise
// fall back to the public endpoint. The public endpoint is rate-
// limited; if you're running this example heavily, point it at your
// Alchemy / QuickNode key.
const RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

export interface VerifyPaymentInput {
  /** EVM tx hash (0x-prefixed, 32-byte hex). */
  txHash: string;
  /** Expected recipient of the USDC transfer (lowercased EVM address). */
  expectedPayTo: string;
  /** Minimum amount the transfer must carry, in USDC atomic units (6 decimals). */
  expectedAmountAtomic: bigint;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verifies that `txHash` corresponds to a confirmed Base Sepolia
 * transaction whose logs include a USDC Transfer of at least
 * `expectedAmountAtomic` to `expectedPayTo`.
 *
 * Returns { ok: true } on success. Returns { ok: false, reason }
 * with a human-readable explanation otherwise.
 *
 * NOT included in this demo (would matter in production):
 *   - Replay protection: nothing stops the agent from submitting the
 *     same tx_hash twice. A real service would store used hashes.
 *   - Sender allowlist: any address can pay; the service doesn't
 *     check who sent the funds.
 *   - Recent-window check: the tx could be hours old. A real service
 *     would reject anything outside a reasonable window.
 *
 * These omissions are documented in the example README so a developer
 * reading this code knows what's intentional vs. what's missing.
 */
export async function verifyPayment(
  input: VerifyPaymentInput,
): Promise<VerifyResult> {
  if (!input.txHash.startsWith("0x") || input.txHash.length !== 66) {
    return { ok: false, reason: "Invalid tx hash format" };
  }

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: input.txHash as `0x${string}`,
      timeout: 30_000, // 30s — Base Sepolia is fast; this is generous
    });
  } catch (e) {
    return {
      ok: false,
      reason: `Could not fetch receipt: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  if (receipt.status !== "success") {
    return { ok: false, reason: "Transaction reverted on-chain" };
  }

  const expectedTo = input.expectedPayTo.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== USDC_BASE_SEPOLIA.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "Transfer") continue;
      const to = decoded.args.to.toLowerCase();
      const value = decoded.args.value;
      if (to === expectedTo && value >= input.expectedAmountAtomic) {
        return { ok: true };
      }
    } catch {
      // Not a Transfer event we can decode — skip this log
    }
  }

  return {
    ok: false,
    reason: `No matching USDC Transfer of ≥${input.expectedAmountAtomic} atomic units to ${input.expectedPayTo} found in tx ${input.txHash}`,
  };
}
