import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { parseConfig } from "../shared/config.js";

export type RawAllowlistEntry = string | { number: string; label?: string; confirm?: boolean; language?: string };

export interface RawConfig {
  allowlist: RawAllowlistEntry[];
  defaultLanguage?: string;
  bridgeToken: string;
  bridgePort: number;
}

export interface AllowOpts { label?: string; confirm?: boolean; language?: string; }

const DEFAULT_PORT = 7766;

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function createDefault(): RawConfig {
  return { allowlist: [], defaultLanguage: "English", bridgeToken: generateToken(), bridgePort: DEFAULT_PORT };
}

export function normalizeNumber(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

interface EntryFields { number: string; label?: string; confirm?: boolean; language?: string; }

function entryFields(e: RawAllowlistEntry): EntryFields {
  return typeof e === "string"
    ? { number: normalizeNumber(e) }
    : { number: normalizeNumber(e.number), label: e.label, confirm: e.confirm, language: e.language };
}

// Tidy serialization: bare string only when all-default; object otherwise.
function serializeEntry(f: EntryFields): RawAllowlistEntry {
  const hasLabel = !!f.label;
  const hasLang = !!f.language;
  const nonDefaultConfirm = f.confirm === false;
  if (!hasLabel && !hasLang && !nonDefaultConfirm) return f.number;
  const obj: { number: string; label?: string; confirm?: boolean; language?: string } = { number: f.number };
  if (hasLabel) obj.label = f.label;
  if (nonDefaultConfirm) obj.confirm = false;
  if (hasLang) obj.language = f.language;
  return obj;
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

/** Upsert that MERGES: provided fields override, unspecified ones are preserved. */
export function addAllowlist(config: RawConfig, number: string, opts: AllowOpts = {}): RawConfig {
  const num = normalizeNumber(number);
  if (!num) throw new Error(`not a valid number: ${number}`);
  const existing = config.allowlist.find((e) => entryFields(e).number === num);
  const prev = existing ? entryFields(existing) : { number: num };
  const merged: EntryFields = {
    number: num,
    label: opts.label ?? prev.label,
    confirm: opts.confirm ?? prev.confirm,
    language: opts.language ?? prev.language,
  };
  const allowlist = config.allowlist.filter((e) => entryFields(e).number !== num);
  allowlist.push(serializeEntry(merged));
  return { ...config, allowlist };
}

export function removeAllowlist(config: RawConfig, number: string): RawConfig {
  const num = normalizeNumber(number);
  return { ...config, allowlist: config.allowlist.filter((e) => entryFields(e).number !== num) };
}

export function listAllowlist(config: RawConfig): { number: string; label?: string; confirm: boolean; language?: string }[] {
  return config.allowlist.map((e) => {
    const f = entryFields(e);
    return {
      number: f.number,
      ...(f.label ? { label: f.label } : {}),
      confirm: f.confirm ?? true,
      ...(f.language ? { language: f.language } : {}),
    };
  });
}

export function setDefaultLanguage(config: RawConfig, language: string): RawConfig {
  const lang = language.trim();
  if (!lang) throw new Error("language must be non-empty");
  return { ...config, defaultLanguage: lang };
}

export function setPort(config: RawConfig, port: number): RawConfig {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid port: ${port}`);
  return { ...config, bridgePort: port };
}

export function rotateToken(config: RawConfig): RawConfig {
  return { ...config, bridgeToken: generateToken() };
}
