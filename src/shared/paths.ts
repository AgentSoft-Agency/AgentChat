import { join, resolve } from "node:path";

export interface Paths {
  dataDir: string;
  dbFile: string;
  authDir: string;
  mediaDir: string;
  configFile: string;
}

export function paths(dataDir = defaultDataDir()): Paths {
  return {
    dataDir,
    dbFile: join(dataDir, "whatsapp.db"),
    authDir: join(dataDir, "auth"),
    mediaDir: join(dataDir, "media"),
    configFile: join(dataDir, "config.json"),
  };
}

function defaultDataDir(): string {
  const home = process.env.AGENT_CHAT_HOME;
  return home ? join(home, "data") : resolve(process.cwd(), "data");
}
