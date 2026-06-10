import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { openDb } from "../shared/db.js";
import { Store } from "../shared/store.js";
import { DraftStore } from "../shared/drafts.js";
import { httpBridgeClient } from "./bridge-client.js";
import { ToolCore } from "./tools.js";
import { buildServer } from "./server.js";

const p = paths();
const config = loadConfig(p.configFile);
const store = new Store(openDb(p.dbFile));
const bridge = httpBridgeClient(config.bridgePort, config.bridgeToken);
const core = new ToolCore(store, bridge, new DraftStore(), config.allowlist.map((e) => e.number));

const server = buildServer(core);
await server.connect(new StdioServerTransport());
console.error("whatsapp-mcp server running on stdio");
