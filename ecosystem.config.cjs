// PM2 process definition for the agent-chat WhatsApp bridge daemon.
//
// Runs the TypeScript entry through tsx via Node's `--import` hook (works with
// ESM + Node 24 and avoids PM2 auto-selecting ts-node for the .ts script).
// `pm2 start ecosystem.config.cjs` keeps the bridge alive across crashes;
// `pm2 save` + `pm2 startup` make it survive reboots.
const repoRoot = __dirname;

module.exports = {
  apps: [
    {
      name: "agent-chat-bridge",
      script: "src/bridge/index.ts",
      cwd: repoRoot,
      interpreter: "node",
      node_args: "--import tsx",
      // AGENT_CHAT_HOME makes paths() resolve data/ from the repo regardless of
      // where PM2 resurrects the process from on reboot.
      env: {
        AGENT_CHAT_HOME: repoRoot,
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
