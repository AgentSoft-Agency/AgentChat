import { join, resolve } from "node:path";

export interface Paths {
  dataDir: string;
  dbFile: string;
  authDir: string;
  mediaDir: string;
  configFile: string;
}

export function paths(dataDir = resolve(process.cwd(), "data")): Paths {
  return {
    dataDir,
    dbFile: join(dataDir, "whatsapp.db"),
    authDir: join(dataDir, "auth"),
    mediaDir: join(dataDir, "media"),
    configFile: join(dataDir, "config.json"),
  };
}
