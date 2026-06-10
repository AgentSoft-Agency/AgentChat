import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const numericString = z
  .string()
  .transform((s) => s.replace(/[^0-9]/g, ""))
  .refine((s) => s.length > 0 && /^[0-9]+$/.test(s), {
    message: "allowlist entries must be numeric (phone digits or group id)",
  });

// A bare numeric string OR { number, label?, confirm?, language? }.
// Both normalize to an AllowEntry; confirm defaults to true.
const allowlistEntry = z.union([
  numericString.transform((number) => ({ number, confirm: true })),
  z.object({
    number: numericString,
    label: z.string().optional(),
    confirm: z.boolean().default(true),
    language: z.string().min(1).optional(),
  }),
]);

const schema = z.object({
  allowlist: z.array(allowlistEntry).default([]),
  defaultLanguage: z.string().min(1).default("English"),
  bridgeToken: z.string().min(1),
  bridgePort: z.number().int().positive().default(7766),
});

export function parseConfig(raw: unknown): AppConfig {
  return schema.parse(raw);
}

export function loadConfig(configFile: string): AppConfig {
  return parseConfig(JSON.parse(readFileSync(configFile, "utf8")));
}
