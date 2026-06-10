import { createServer, type Server } from "node:http";

export interface BridgeDeps {
  token: string;
  sendText: (jid: string, text: string) => Promise<string>;
  sendMedia: (jid: string, filePath: string, caption?: string) => Promise<string>;
  status: () => { state: string; qr?: string | null };
}

function readJson(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

export function createBridgeApi(deps: BridgeDeps): Server {
  return createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/status") {
        // Only expose connection state, never the raw QR (a linking credential),
        // on this unauthenticated endpoint. The bridge prints the QR to its own
        // terminal for linking.
        const { state } = deps.status();
        return send(200, { state });
      }
      if (req.headers.authorization !== `Bearer ${deps.token}`) {
        return send(401, { error: "unauthorized" });
      }
      const body = await readJson(req);
      if (req.method === "POST" && req.url === "/send") {
        const id = await deps.sendText(body.to, body.text);
        return send(200, { id });
      }
      if (req.method === "POST" && req.url === "/send-media") {
        const id = await deps.sendMedia(body.to, body.filePath, body.caption);
        return send(200, { id });
      }
      return send(404, { error: "not found" });
    } catch (err: any) {
      return send(500, { error: String(err?.message ?? err) });
    }
  });
}
