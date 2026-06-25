---
name: internet-research-router
description: "Use when the user asks to search, research, look up, read a URL, summarize a webpage/video/repo, or gather current internet evidence."
mode: both
license: Inspired by Agent Reach's capability-router pattern.
---

# Internet Research Router

Route internet requests through the best available goatLLM-native capability first. Do not install new tooling unless the user asks.

Default routing:
- Current facts or broad research: use `web_search`, then read promising URLs with `scrape_url`, `browser_fetch`, or `browser_extract`.
- Specific URL: read it directly with `scrape_url` or browser tools. Search only if the page fails or context is missing.
- GitHub repo or issue: use web/search tools in chat mode. In agent mode, `gh` via `bash` is acceptable only if already installed and authentication is needed.
- Long document attachment: use `read_attachment` and `search_attachment`, not web tools.
- Codebase orientation: use `workspace_map`, then `search_content`, `search_semantic`, and `read_file`.

Platform notes:
- YouTube or podcast: prefer transcript/subtitle text when available. In agent mode, `yt-dlp` is optional if installed; otherwise use web search and page extraction.
- Reddit, X/Twitter, LinkedIn, XiaoHongShu, Bilibili, and similar logged-in platforms: do not ask for cookies or credentials unless the user explicitly wants that platform and understands the account risk. Use public pages/search first.
- RSS: fetch and summarize feed text when a feed URL is provided.

Evidence rules:
- Prefer primary sources.
- Cross-check claims when results disagree.
- Cite or name sources in the answer when the surface supports it.
- Do not fabricate page contents, URLs, availability, or command output.
- Stop searching once the answer is supported.

If goatLLM tools are unavailable in the current mode, explain the missing capability and answer with available context.
