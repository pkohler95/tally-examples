// Mock x402-style weather service. Run this in one terminal:
//
//   pnpm --filter @tallyforagents/examples weather-server
//
// Then run the agent in another. The shape of the 402 response and
// the X-Payment retry follows Coinbase's x402 spec closely enough
// that the same pattern works against real x402 services — the
// developer-facing flow is identical.
//
// Demo simplifications (called out in the README too):
//   - X-Payment header carries a bare tx hash (not the full base64-
//     encoded payment payload the spec defines)
//   - Weather data is hardcoded for a handful of cities
//   - No replay protection (same tx hash works repeatedly)
//   - No request-window check (tx could be hours old)
// All real x402 services should add the above.

import { createServer } from "node:http";
import { URL } from "node:url";
import { verifyPayment } from "./verify";

const PORT = Number(process.env.PORT ?? 4242);

// The wallet address the agent must pay to. For the demo, set this
// to any Sepolia address you control — the funds just need to land
// somewhere verifiable. The Base Sepolia "junk" address works fine
// since this is testnet USDC.
const SERVICE_WALLET =
  process.env.WEATHER_SERVICE_WALLET ??
  "0x000000000000000000000000000000000000dEaD";

// 50,000 atomic units = 0.05 USDC (6 decimals). Sized to fit
// comfortably under typical agent permission caps ($10/tx by default).
const PRICE_ATOMIC = "50000";
const PRICE_DECIMAL = "0.05";

// Base Sepolia USDC contract — same one the agent's permission
// allows it to call.
//
// When Tally enables live mode (mainnet), the chain swap is:
//   - USDC address: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
//   - network field in the 402 response: "base"
//   - viem chain in verify.ts: `base` instead of `baseSepolia`
// The agent code is unchanged — same SDK calls, same protocol shape.
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Hardcoded "premium" weather data. In a real service this would be
// a paid API integration, scraping, or proprietary dataset.
const WEATHER_DATA: Record<
  string,
  { temp_c: number; conditions: string; humidity: number }
> = {
  tokyo: { temp_c: 14, conditions: "light rain", humidity: 78 },
  "san francisco": { temp_c: 16, conditions: "fog clearing", humidity: 82 },
  sf: { temp_c: 16, conditions: "fog clearing", humidity: 82 },
  london: { temp_c: 9, conditions: "overcast", humidity: 71 },
  "new york": { temp_c: 6, conditions: "clear", humidity: 54 },
  nyc: { temp_c: 6, conditions: "clear", humidity: 54 },
  "los angeles": { temp_c: 22, conditions: "sunny", humidity: 38 },
  la: { temp_c: 22, conditions: "sunny", humidity: 38 },
  paris: { temp_c: 11, conditions: "partly cloudy", humidity: 65 },
  berlin: { temp_c: 8, conditions: "rain", humidity: 80 },
  sydney: { temp_c: 24, conditions: "clear", humidity: 58 },
};

function paymentRequiredBody(resource: string): string {
  return JSON.stringify(
    {
      x402Version: 1,
      error: "X-Payment header required",
      accepts: [
        {
          scheme: "exact",
          network: "base-sepolia",
          maxAmountRequired: PRICE_ATOMIC,
          resource,
          description: "Premium weather data",
          mimeType: "application/json",
          payTo: SERVICE_WALLET,
          maxTimeoutSeconds: 60,
          asset: USDC_BASE_SEPOLIA,
          extra: null,
        },
      ],
    },
    null,
    2,
  );
}

const server = createServer(async (req, res) => {
  // CORS — agents calling from anywhere should work. The demo doesn't
  // care about cross-origin restrictions.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, x-payment",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method !== "GET" || url.pathname !== "/weather") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const city = url.searchParams.get("city")?.toLowerCase().trim();
  if (!city) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "missing city query param" }));
    return;
  }

  const payment = req.headers["x-payment"];
  if (!payment || typeof payment !== "string") {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(paymentRequiredBody(url.pathname + url.search));
    return;
  }

  console.log(`[server] verifying payment for ${city}: ${payment}`);
  const result = await verifyPayment({
    txHash: payment,
    expectedPayTo: SERVICE_WALLET,
    expectedAmountAtomic: BigInt(PRICE_ATOMIC),
  });

  if (!result.ok) {
    console.log(`[server] payment failed: ${result.reason}`);
    res.writeHead(402, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        x402Version: 1,
        error: `Payment verification failed: ${result.reason}`,
      }),
    );
    return;
  }

  console.log(`[server] payment verified, returning weather for ${city}`);

  const data = WEATHER_DATA[city] ?? {
    temp_c: 18,
    conditions: "no data for that city; here's a reasonable guess",
    humidity: 60,
  };

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      {
        city,
        ...data,
        unit: "celsius",
        payment_verified: payment,
      },
      null,
      2,
    ),
  );
});

server.listen(PORT, () => {
  console.log(`\nWeather x402 service`);
  console.log(`  listening on http://localhost:${PORT}`);
  console.log(`  pay-to wallet: ${SERVICE_WALLET}`);
  console.log(`  price per query: ${PRICE_DECIMAL} USDC (${PRICE_ATOMIC} atomic)\n`);
});
