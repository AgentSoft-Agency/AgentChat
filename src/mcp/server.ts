import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolCore } from "./tools.js";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

export function buildServer(core: ToolCore): McpServer {
  const server = new McpServer({ name: "whatsapp-mcp", version: "0.1.0" });

  server.registerTool("list_chats",
    { title: "List chats", description: "Recent WhatsApp chats", inputSchema: { limit: z.number().optional() } },
    async ({ limit }) => json(core.listChats(limit)));

  server.registerTool("get_messages",
    { title: "Get messages", description: "Messages in a chat (newest last)", inputSchema: { chat: z.string(), limit: z.number().optional(), before: z.number().optional() } },
    async ({ chat, limit, before }) => json(core.getMessages(chat, limit, before)));

  server.registerTool("search_messages",
    { title: "Search messages", description: "Full-text search across history", inputSchema: { query: z.string(), limit: z.number().optional() } },
    async ({ query, limit }) => json(core.searchMessages(query, limit)));

  server.registerTool("list_contacts",
    { title: "List contacts", description: "Find contacts by name/number", inputSchema: { query: z.string().optional() } },
    async ({ query }) => json(core.listContacts(query)));

  server.registerTool("get_new_messages",
    { title: "Get new messages", description: "Unseen incoming messages; marks them seen", inputSchema: { limit: z.number().optional() } },
    async ({ limit }) => json(core.getNewMessages(limit)));

  server.registerTool("whatsapp_status",
    { title: "WhatsApp status", description: "Connection state", inputSchema: {} },
    async () => json(await core.status()));

  server.registerTool("draft_message",
    { title: "Draft message", description: "Prepare a text message (does not send). Returns draftId.", inputSchema: { to: z.string(), text: z.string() } },
    async ({ to, text }) => json(core.draftMessage(to, text)));

  server.registerTool("draft_media",
    { title: "Draft media", description: "Prepare a media message (does not send). Returns draftId.", inputSchema: { to: z.string(), filePath: z.string(), caption: z.string().optional() } },
    async ({ to, filePath, caption }) => json(core.draftMedia(to, filePath, caption)));

  server.registerTool("send_draft",
    { title: "Send draft", description: "Send a previously drafted message by draftId", inputSchema: { draftId: z.string() } },
    async ({ draftId }) => json(await core.sendDraft(draftId)));

  server.registerTool("download_media",
    { title: "Download media", description: "Download a media message; returns a local file path", inputSchema: { messageId: z.string() } },
    async ({ messageId }) => json(await core.downloadMedia(messageId)));

  return server;
}
