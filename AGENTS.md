# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a Node.js MCP (Model Context Protocol) server that proxies requests to the Mimi Panda API. It communicates via STDIO (JSON-RPC 2.0), not HTTP. There is no build step — source files are raw ES modules (`.mjs`) run directly with Node.

### Running the server

The server is STDIO-based and does not listen on any port. To test it, pipe JSON-RPC messages to stdin:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | node src/mcp-server.mjs
```

Startup banner is printed to stderr: `[mimi-panda-mcp-server] Ready (base: ..., prefix: ...)`.

### Configuration

Copy `.env.example` to `.env`. See `README.md` for variable descriptions. The server works without an API token but authenticated API calls will return 401.

### Lint / Test / Build

- **No linter configured** — no ESLint, Prettier, or similar tools in the project.
- **No test framework** — validate with `node --check src/mcp-server.mjs` (syntax check only).
- **No build step** — raw `.mjs` files are executed directly.

### Key gotchas

- The MCP STDIO transport reads newline-delimited JSON from stdin. You must send `initialize` → `notifications/initialized` → then your tool call, all as separate JSON lines.
- The server logs its startup banner to **stderr**, not stdout. Stdout is reserved for JSON-RPC responses.
- `npm start` launches the server and blocks waiting for stdin — use `timeout` or pipe input to avoid hanging.
