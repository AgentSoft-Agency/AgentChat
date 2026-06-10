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

  it("uses AGENT_CHAT_HOME/data when the env var is set", () => {
    const prev = process.env.AGENT_CHAT_HOME;
    process.env.AGENT_CHAT_HOME = "/opt/agent-chat";
    try {
      const p = paths();
      expect(p.dataDir).toBe("/opt/agent-chat/data");
      expect(p.configFile).toBe("/opt/agent-chat/data/config.json");
    } finally {
      if (prev === undefined) delete process.env.AGENT_CHAT_HOME;
      else process.env.AGENT_CHAT_HOME = prev;
    }
  });

  it("an explicit dataDir argument overrides AGENT_CHAT_HOME", () => {
    const prev = process.env.AGENT_CHAT_HOME;
    process.env.AGENT_CHAT_HOME = "/opt/agent-chat";
    try {
      expect(paths("/tmp/x").dataDir).toBe("/tmp/x");
    } finally {
      if (prev === undefined) delete process.env.AGENT_CHAT_HOME;
      else process.env.AGENT_CHAT_HOME = prev;
    }
  });
});
