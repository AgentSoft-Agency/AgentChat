export interface BridgeClient {
  sendText: (jid: string, text: string) => Promise<string>;
  sendMedia: (jid: string, filePath: string, caption?: string) => Promise<string>;
  status: () => Promise<{ state: string }>;
  downloadMedia: (messageId: string) => Promise<string>;
}

export function httpBridgeClient(port: number, token: string): BridgeClient {
  const base = `http://127.0.0.1:${port}`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`bridge ${path} failed: ${res.status}`);
    return res.json();
  };
  return {
    sendText: async (to, text) => (await post("/send", { to, text })).id,
    sendMedia: async (to, filePath, caption) => (await post("/send-media", { to, filePath, caption })).id,
    downloadMedia: async (messageId) => (await post("/download-media", { messageId })).path,
    status: async () => {
      const res = await fetch(base + "/status");
      if (!res.ok) throw new Error(`bridge /status failed: ${res.status}`);
      return res.json();
    },
  };
}
