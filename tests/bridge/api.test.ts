import { describe, it, expect, afterEach } from "vitest";
import { createBridgeApi } from "../../src/bridge/api.js";
import type { Server } from "node:http";

let server: Server;
afterEach(() => server?.close());

async function call(port: number, path: string, body: any, token?: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("bridge api", () => {
  it("rejects requests without the bearer token", async () => {
    const sent: any[] = [];
    server = createBridgeApi({
      token: "secret",
      sendText: async (jid, text) => { sent.push({ jid, text }); return "id1"; },
      sendMedia: async () => "id2",
      downloadMedia: async () => "/x",
      status: () => ({ state: "connected", qr: null }),
    }).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/send", { to: "1@s.whatsapp.net", text: "hi" });
    expect(r.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("sends text when authorized", async () => {
    const sent: any[] = [];
    server = createBridgeApi({
      token: "secret",
      sendText: async (jid, text) => { sent.push({ jid, text }); return "id1"; },
      sendMedia: async () => "id2",
      downloadMedia: async () => "/x",
      status: () => ({ state: "connected", qr: null }),
    }).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/send", { to: "1@s.whatsapp.net", text: "hi" }, "secret");
    expect(r.status).toBe(200);
    expect(sent).toEqual([{ jid: "1@s.whatsapp.net", text: "hi" }]);
  });

  it("downloads media when authorized", async () => {
    server = createBridgeApi({
      token: "secret",
      sendText: async () => "i",
      sendMedia: async () => "i",
      downloadMedia: async (id: string) => `/data/media/${id}`,
      status: () => ({ state: "connected" }),
    }).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/download-media", { messageId: "m1" }, "secret");
    expect(r.status).toBe(200);
    expect(r.json.path).toBe("/data/media/m1");
  });
});
