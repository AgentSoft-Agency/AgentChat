# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.2.0](https://github.com/AgentSoft-Agency/AgentChat/compare/v0.1.0...v0.2.0) (2026-06-22)


### Features

* **bridge:** add /relink, /logout, and authenticated /qr endpoints ([6c82415](https://github.com/AgentSoft-Agency/AgentChat/commit/6c824151b549b0ef60958b13717fca9c64dec221))
* **bridge:** add live relink/logout to the WhatsApp handle ([54df81a](https://github.com/AgentSoft-Agency/AgentChat/commit/54df81afc035d693301e5830edc8ea176396924c))
* **cli:** add bridge-control HTTP client ([c805481](https://github.com/AgentSoft-Agency/AgentChat/commit/c8054811fd14936dd5d51be1dcc854721c03e925))
* **cli:** add link/logout branch-decision helpers ([750728c](https://github.com/AgentSoft-Agency/AgentChat/commit/750728cf0d3c0e00ea2da3da6e389b65e4629920))
* **cli:** add logout command ([e086777](https://github.com/AgentSoft-Agency/AgentChat/commit/e08677765e4fb21f9a650cac1b4edf550a1679e8))
* **cli:** allowlist --confirm/--no-confirm/--lang flags and default-language command ([fef5540](https://github.com/AgentSoft-Agency/AgentChat/commit/fef5540c257a4abb384aa28b3f24882b91f3bcfe))
* **cli:** formatAllowEntryLabel helper for the allowlist menu ([68f95ab](https://github.com/AgentSoft-Agency/AgentChat/commit/68f95abfc476af65876ab324d9e1e2b12283d2f8))
* **cli:** interactive management menu ([2711089](https://github.com/AgentSoft-Agency/AgentChat/commit/2711089f01569352aa2e56a8042ea4a225f5cd12))
* **cli:** live re-link through the running bridge from 'link' ([f22dbc5](https://github.com/AgentSoft-Agency/AgentChat/commit/f22dbc5083ebaf0be0afd5d73cf847e1a6ea0016))
* **cli:** merging allowlist upsert with confirm/language; default language ([edb1aaf](https://github.com/AgentSoft-Agency/AgentChat/commit/edb1aaf9cfe7adbec351bd922d4b183968bfb57f))
* **cli:** pure helpers for the interactive menu ([23788aa](https://github.com/AgentSoft-Agency/AgentChat/commit/23788aa37bb377ad66a397f021f77dc22b4215ba))
* **cli:** split allowlist add/update with a selectable list ([5104d46](https://github.com/AgentSoft-Agency/AgentChat/commit/5104d46640b6c095ba92e29ba84d0f18264c9eeb))
* **config:** per-number allowlist objects, defaultLanguage, policy helpers ([dc06546](https://github.com/AgentSoft-Agency/AgentChat/commit/dc065465e27af6c3e508d689fe2ee067e9dd5cf8))
* **mcp:** annotate list_contacts with allowlist policy and language ([6eaf93c](https://github.com/AgentSoft-Agency/AgentChat/commit/6eaf93c9e533851680aac9ebed877ecf11ce05fd))
* **mcp:** one-shot send_message gated to confirm:false; draft enrichment ([021b891](https://github.com/AgentSoft-Agency/AgentChat/commit/021b89164726e7f235c8e2072fedf556a3093114))
* **shared:** add clearAuthDir helper ([725785b](https://github.com/AgentSoft-Agency/AgentChat/commit/725785b824a4aab361bb779267ab5c2b14798cc4))


### Bug Fixes

* **bridge:** serialize relink/logout to prevent concurrent reconnect race ([905d13f](https://github.com/AgentSoft-Agency/AgentChat/commit/905d13fee527f32f7370651200e49aae63b1154c))

## 0.1.0 (2026-06-10)


### Features

* Baileys connection adapter with reconnect and QR ([847d816](https://github.com/AgentSoft-Agency/AgentChat/commit/847d816cac2abe5121f382a1f324eb5bb5bc3942))
* bridge entry point ([1213f2e](https://github.com/AgentSoft-Agency/AgentChat/commit/1213f2edede8d0dcbfc6bebfb17f48993a86cdba))
* bridge ingest from Baileys events ([be11ed4](https://github.com/AgentSoft-Agency/AgentChat/commit/be11ed48b86714719d95bd085ac9ad20ab6c2caa))
* **cli:** agent installer types ([8e5dce1](https://github.com/AgentSoft-Agency/AgentChat/commit/8e5dce13ef750336c95c0b216b2af030a9292360))
* **cli:** agent registry ([bc7d186](https://github.com/AgentSoft-Agency/AgentChat/commit/bc7d1868a7d61ac68b18c1ed906ae144eb80324f))
* **cli:** claude-code installer argv builders ([c7079d7](https://github.com/AgentSoft-Agency/AgentChat/commit/c7079d7574fa9ce0218d4f6a563438ee8fafeb0f))
* **cli:** command handlers ([f070a66](https://github.com/AgentSoft-Agency/AgentChat/commit/f070a66acfd35f3c49a0edc5315f6f0c40463856))
* **cli:** config-store allowlist add/remove/list ([decbd60](https://github.com/AgentSoft-Agency/AgentChat/commit/decbd605e846255e6cf8aa23c1f60a7bef0b1e78))
* **cli:** config-store read/write/createDefault ([8f8954d](https://github.com/AgentSoft-Agency/AgentChat/commit/8f8954d10d66dde14b0db32ffa93876e96291ed4))
* **cli:** config-store setPort/rotateToken ([e44e099](https://github.com/AgentSoft-Agency/AgentChat/commit/e44e099b11fd18b2a0c5b900cac2b972bfb0e860))
* **cli:** dispatcher and packaging ([bb85dd0](https://github.com/AgentSoft-Agency/AgentChat/commit/bb85dd0bf4c1b7b2e93c681849c368667d8f25f1))
* **cli:** install preflight and command handlers ([bff54c2](https://github.com/AgentSoft-Agency/AgentChat/commit/bff54c28427505d775178f0510e11f94a66350d4))
* **cli:** install/uninstall dispatch ([87b8b3b](https://github.com/AgentSoft-Agency/AgentChat/commit/87b8b3bc452cfa208c17df9e75041a8a5ac7fbb1))
* **cli:** link command ([f34f5fc](https://github.com/AgentSoft-Agency/AgentChat/commit/f34f5fc22cd804a572fa399d460a68f914f3804c))
* config loader with strictly-numeric allowlist ([c03aca3](https://github.com/AgentSoft-Agency/AgentChat/commit/c03aca3f38d4d324137593c1b2524e694de52dd3))
* data path resolution ([15a7315](https://github.com/AgentSoft-Agency/AgentChat/commit/15a7315f9da1994ac6379ccbc92d03f55caa6253))
* jid<->number helpers ([10bc798](https://github.com/AgentSoft-Agency/AgentChat/commit/10bc798cd812725946517ae9223b614f34b565cb))
* localhost bridge HTTP api with token auth ([3a6ae5f](https://github.com/AgentSoft-Agency/AgentChat/commit/3a6ae5f76b4a6d5e7a49fc771ca9cc08aaa9b85e))
* mcp server registration and stdio entry point ([22e36b1](https://github.com/AgentSoft-Agency/AgentChat/commit/22e36b1903932152f742189682c9bf158ac8f708))
* mcp tool-core and bridge client ([dbdcc73](https://github.com/AgentSoft-Agency/AgentChat/commit/dbdcc73889ffce8345e0691f2b9849d9465e8ff9))
* media download endpoint and tool ([84fc30e](https://github.com/AgentSoft-Agency/AgentChat/commit/84fc30e7080a14050eb852855e2c21117f558dcb))
* normalize Baileys messages to rows ([8bd033c](https://github.com/AgentSoft-Agency/AgentChat/commit/8bd033c9b1ac958276d23fc5677af5ebd5dc6157))
* numeric allowlist resolution and check ([94e6f13](https://github.com/AgentSoft-Agency/AgentChat/commit/94e6f13734a7b53ca666779972eb0b52aa9de379))
* **paths:** honor AGENT_CHAT_HOME for the data dir ([130c6d9](https://github.com/AgentSoft-Agency/AgentChat/commit/130c6d92964ace6f65cec090513d7fdbc6a8ef15))
* shared types ([6f3cf20](https://github.com/AgentSoft-Agency/AgentChat/commit/6f3cf20698f1007ba34737f2f14119d321812520))
* sqlite schema and FTS triggers ([5a4eb34](https://github.com/AgentSoft-Agency/AgentChat/commit/5a4eb34bb5ff79e69115e5bf859c6687eb8c6a4e))
* sqlite store layer ([b9a5a93](https://github.com/AgentSoft-Agency/AgentChat/commit/b9a5a936d96651589e74a2a37d04fa3319da4735))
* store and surface group names ([f3bfb91](https://github.com/AgentSoft-Agency/AgentChat/commit/f3bfb91d2caf7de161b22e72acb81b80fc4327ac))
* two-phase draft store with TTL ([42da3f1](https://github.com/AgentSoft-Agency/AgentChat/commit/42da3f1fb93cb615a3daff55708188a797c08611))


### Bug Fixes

* **bridge:** resolve recipient via onWhatsApp before sending ([372d0c2](https://github.com/AgentSoft-Agency/AgentChat/commit/372d0c270580ab4dea30c4e3466e3f15874fe4a7))
* **cli:** preflight the repo's data dir, not cwd, so install is cwd-independent ([950af01](https://github.com/AgentSoft-Agency/AgentChat/commit/950af014d34c7ce178c12d5e3439d43e12ec4ef9))
* **cli:** preserve non-empty piped input in init; port usage check ([7f5c213](https://github.com/AgentSoft-Agency/AgentChat/commit/7f5c213049ef559b02c5e02b3655534691e628df))
* **cli:** robust runClaude settle/signal handling; comment + test gaps ([d1b2ab4](https://github.com/AgentSoft-Agency/AgentChat/commit/d1b2ab40d775aa108e83d015b3c9f2dcdeef7e3e))
* **db:** index only text in FTS to avoid false-positive id matches ([a119457](https://github.com/AgentSoft-Agency/AgentChat/commit/a1194573b326952b63b28e98c02d5d9a1b4cc9da))
* sanitize FTS search, restore chat/name filters, drop misleading unreadCount ([d460092](https://github.com/AgentSoft-Agency/AgentChat/commit/d460092514fce15600c68f997325b12fcb37adae))
* send media by type, report qr_available, add pairing-code fallback; test download-media; drop pino-pretty ([f729bc5](https://github.com/AgentSoft-Agency/AgentChat/commit/f729bc5ab7fa797badd3a58bd0a6b7fa3fa58f8e))
* **store:** atomic select+mark in takeUnseen for shared-WAL safety ([bd23a8a](https://github.com/AgentSoft-Agency/AgentChat/commit/bd23a8aa18ddf30e3ca8b0e867ec4abc2935a2b7))
