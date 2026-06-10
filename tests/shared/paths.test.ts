import { describe, it, expect } from "vitest";
import { paths } from "../../src/shared/paths.js";

describe("paths", () => {
  it("derives data sub-paths from a base dir", () => {
    const p = paths("/tmp/wa");
    expect(p.dataDir).toBe("/tmp/wa");
    expect(p.dbFile).toBe("/tmp/wa/whatsapp.db");
    expect(p.authDir).toBe("/tmp/wa/auth");
    expect(p.mediaDir).toBe("/tmp/wa/media");
    expect(p.configFile).toBe("/tmp/wa/config.json");
  });
});
