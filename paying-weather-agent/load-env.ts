// Loads .env.local from this directory regardless of where pnpm was
// invoked from (repo root vs. paying-weather-agent/). Pure side
// effect — import this once at the top of any entry point that
// expects TALLY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
//
// Uses a path-aware lookup (relative to THIS file) rather than the
// default `dotenv/config` behavior (which is relative to process.cwd()).
// That way `pnpm weather-agent` from anywhere in the workspace finds
// the file.
//
// Pre-existing process.env values win over .env.local — if you
// export a key in your shell, that overrides the file.

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, ".env.local") });
