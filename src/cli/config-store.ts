import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { parseConfig } from "../shared/config.js";

export type RawAllowlistEntry = string | { number: string; label?: string };

export interface RawConfig {
  allowlist: RawAllowlistEntry[];
  bridgeToken: string;
  bridgePort: number;
}

const DEFAULT_PORT = 7766;

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function createDefault(): RawConfig {
  return { allowlist: [], bridgeToken: generateToken(), bridgePort: DEFAULT_PORT };
}

export function normalizeNumber(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

function entryNumber(e: RawAllowlistEntry): string {
  return normalizeNumber(typeof e === "string" ? e : e.number);
}

export function readConfig(file: string): RawConfig {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  parseConfig(raw); // validate; throws if invalid
  return raw as RawConfig;
}

export function writeConfig(file: string, config: RawConfig): void {
  parseConfig(config); // validate before writing; never leave a broken file
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  chmodSync(file, 0o600);
}

export function addAllowlist(config: RawConfig, number: string, label?: string): RawConfig {
  const num = normalizeNumber(number);
  if (!num) throw new Error(`not a valid number: ${number}`);
  const allowlist = config.allowlist.filter((e) => entryNumber(e) !== num);
  allowlist.push(label ? { number: num, label } : num);
  return { ...config, allowlist };
}

export function removeAllowlist(config: RawConfig, number: string): RawConfig {
  const num = normalizeNumber(number);
  return { ...config, allowlist: config.allowlist.filter((e) => entryNumber(e) !== num) };
}

export function listAllowlist(config: RawConfig): { number: string; label?: string }[] {
  return config.allowlist.map((e) =>
    typeof e === "string" ? { number: e } : { number: e.number, label: e.label }
  );
}

export function setPort(config: RawConfig, port: number): RawConfig {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid port: ${port}`);
  return { ...config, bridgePort: port };
}

export function rotateToken(config: RawConfig): RawConfig {
  return { ...config, bridgeToken: generateToken() };
}
