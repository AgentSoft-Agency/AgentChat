import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Remove everything inside `authDir`, leaving the directory itself in place. */
export function clearAuthDir(authDir: string): void {
  if (!existsSync(authDir)) return;
  for (const entry of readdirSync(authDir)) {
    rmSync(join(authDir, entry), { recursive: true, force: true });
  }
}
