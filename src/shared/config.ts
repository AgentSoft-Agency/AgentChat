import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AppConfig } from "./types.js";

// A number, after stripping non-digits, must be non-empty digits.
const numericString = z
  .string()
  .transform((s) => s.replace(/[^0-9]/g, ""))
  .refine((s) => s.length > 0 && /^[0-9]+$/.test(s), {
    message: "allowlist entries must be numeric (phone digits or group id)",
  });

// An entry is either a bare numeric string or { number, label? }; both
// normalize to the numeric string. The label is for readability only.
const allowlistEntry = z.union([
  numericString,
  z.object({ number: numericString, label: z.string().optional() }).transform((e) => e.number),
]);

const schema = z.object({
  allowlist: z.array(allowlistEntry).default([]),
  bridgeToken: z.string().min(1),
  bridgePort: z.number().int().positive().default(7766),
});

export function parseConfig(raw: unknown): AppConfig {
  return schema.parse(raw);
}

export function loadConfig(configFile: string): AppConfig {
  return parseConfig(JSON.parse(readFileSync(configFile, "utf8")));
}
