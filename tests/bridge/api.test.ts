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

function baseDeps(overrides: Partial<Parameters<typeof createBridgeApi>[0]> = {}) {
  return {
    token: "secret",
    sendText: async () => "i",
    sendMedia: async () => "i",
    downloadMedia: async () => "/x",
    status: () => ({ state: "connected", qr: null, pairingCode: null }),
    relink: async () => {},
    logout: async () => {},
    ...overrides,
  };
}

async function get(port: number, path: string, token?: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("bridge api", () => {
  it("rejects requests without the bearer token", async () => {
    const sent: any[] = [];
    server = createBridgeApi(baseDeps({
      sendText: async (jid, text) => { sent.push({ jid, text }); return "id1"; },
      sendMedia: async () => "id2",
      downloadMedia: async () => "/x",
      status: () => ({ state: "connected", qr: null, pairingCode: null }),
    })).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/send", { to: "1@s.whatsapp.net", text: "hi" });
    expect(r.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("sends text when authorized", async () => {
    const sent: any[] = [];
    server = createBridgeApi(baseDeps({
      sendText: async (jid, text) => { sent.push({ jid, text }); return "id1"; },
      sendMedia: async () => "id2",
      downloadMedia: async () => "/x",
      status: () => ({ state: "connected", qr: null, pairingCode: null }),
    })).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/send", { to: "1@s.whatsapp.net", text: "hi" }, "secret");
    expect(r.status).toBe(200);
    expect(sent).toEqual([{ jid: "1@s.whatsapp.net", text: "hi" }]);
  });

  it("downloads media when authorized", async () => {
    server = createBridgeApi(baseDeps({
      downloadMedia: async (id: string) => `/data/media/${id}`,
    })).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/download-media", { messageId: "m1" }, "secret");
    expect(r.status).toBe(200);
    expect(r.json.path).toBe("/data/media/m1");
  });

  it("POST /relink requires the token and forwards the pair option", async () => {
    const calls: Array<string | undefined> = [];
    server = createBridgeApi(baseDeps({ relink: async (p?: string) => { calls.push(p); } })).listen(0);
    const port = (server.address() as any).port;

    const unauth = await call(port, "/relink", {});
    expect(unauth.status).toBe(401);

    const ok = await call(port, "/relink", { pair: "5215512345678" }, "secret");
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ ok: true });
    expect(calls).toEqual(["5215512345678"]);
  });

  it("POST /logout requires the token and calls logout", async () => {
    let called = false;
    server = createBridgeApi(baseDeps({ logout: async () => { called = true; } })).listen(0);
    const port = (server.address() as any).port;

    const unauth = await call(port, "/logout", {});
    expect(unauth.status).toBe(401);
    expect(called).toBe(false);

    const ok = await call(port, "/logout", {}, "secret");
    expect(ok.status).toBe(200);
    expect(called).toBe(true);
  });

  it("GET /qr requires the token and returns the QR + pairing code", async () => {
    server = createBridgeApi(baseDeps({
      status: () => ({ state: "qr_available", qr: "QRDATA", pairingCode: "ABCD-1234" }),
    })).listen(0);
    const port = (server.address() as any).port;

    const unauth = await get(port, "/qr");
    expect(unauth.status).toBe(401);

    const ok = await get(port, "/qr", "secret");
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ state: "qr_available", qr: "QRDATA", pairingCode: "ABCD-1234" });
  });

  it("GET /status never exposes the QR", async () => {
    server = createBridgeApi(baseDeps({
      status: () => ({ state: "qr_available", qr: "QRDATA", pairingCode: "ABCD-1234" }),
    })).listen(0);
    const port = (server.address() as any).port;
    const r = await get(port, "/status");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ state: "qr_available" });
  });
});
