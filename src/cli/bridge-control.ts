export interface BridgeControl {
  /** GET /status; reachable:false when the bridge isn't listening. */
  probe: () => Promise<{ reachable: boolean; state?: string }>;
  relink: (pair?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** GET /qr (authenticated). */
  fetchQr: () => Promise<{ state: string; qr: string | null; pairingCode: string | null }>;
}

export function httpBridgeControl(port: number, token: string): BridgeControl {
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${token}` };
  const postJson = { "content-type": "application/json", ...auth };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: "POST", headers: postJson, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`bridge ${path} failed: ${res.status}`);
  };

  return {
    probe: async () => {
      try {
        const res = await fetch(base + "/status");
        if (!res.ok) return { reachable: false };
        const { state } = (await res.json()) as { state?: string };
        return { reachable: true, state };
      } catch {
        return { reachable: false }; // connection refused → bridge is down
      }
    },
    relink: async (pair?: string) => { await post("/relink", pair ? { pair } : {}); },
    logout: async () => { await post("/logout", {}); },
    fetchQr: async () => {
      const res = await fetch(base + "/qr", { headers: auth });
      if (!res.ok) throw new Error(`bridge /qr failed: ${res.status}`);
      return (await res.json()) as { state: string; qr: string | null; pairingCode: string | null };
    },
  };
}
