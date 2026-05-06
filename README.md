# Mimi Panda MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides seamless access to the Mimi Panda API, enabling AI assistants like Claude to interact with coloring pages, paint by numbers, AI image generation, and image processing services.

## Features

- 🎨 **Coloring Pages**: Convert images into coloring pages with various styles
- 🖼️ **Paint by Numbers**: Generate paint-by-numbers images from photos or prompts
- ⬇️ **PBN Downloads**: Download finished PBN images (SVG, PNG, PDF) and color palettes (PDF, JPEG, CSV, Procreate, GIMP, Krita) directly via API
- 🤖 **AI Image Generation**: Create images from text prompts
- 🎭 **AI Filters**: Apply artistic filters to images
- 📈 **Image Upscaling**: Enhance and upscale images up to 4x
- 🔐 **Authentication**: Built-in support for API token authentication
- 📋 **Route Discovery**: List and explore available API endpoints

## Prerequisites

- **Node.js 18+** (required by `@modelcontextprotocol/sdk`)
- Access to the Mimi Panda API (either self-hosted or cloud instance)

## Installation

```bash
# Clone the repository
git clone https://github.com/mimipanda/mcp-server.git
cd mcp-server

# Install dependencies
npm install
```

## Configuration

The server can be configured using environment variables. Copy `.env.example` to `.env` and update with your values, or set them in your environment:

| Variable | Purpose | Default |
| --- | --- | --- |
| `MCP_API_BASE_URL` | Base URL for the Mimi Panda API endpoint (e.g. `https://mimi-panda.com`) | `http://localhost` |
| `MCP_API_PREFIX` | API prefix appended to every request | `/api` |
| `MCP_API_TOKEN` | Optional default Bearer token for authenticated routes (can be retrieved later via `auth/login`) | _unset_ |
| `MCP_API_HEADERS` | JSON object with extra headers (e.g. `{"X-Api-Key":"secret"}`) | `{}` |
| `MCP_API_TIMEOUT` | Request timeout in milliseconds (1000–120000) | `60000` |

### Example `.env` file

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Then edit `.env` with your values (you can leave `MCP_API_TOKEN` blank until you obtain one from the auth APIs):

```env
MCP_API_BASE_URL=https://mimi-panda.com
MCP_API_PREFIX=/api
MCP_API_TOKEN=your-api-token-here
MCP_API_TIMEOUT=60000
```

> Obtain your API token by logging into the Mimi Panda application (web or desktop) and copying the token from your account settings. Store the token in `.env` or supply it per request once you have it.

## Usage

### Running the Server

The MCP server communicates via STDIO and is designed to be used with MCP-compatible clients like Claude Desktop.

```bash
# Run directly
npm start

# Or with node
node src/mcp-server.mjs
```

### Claude Desktop Configuration

Add the server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mimi-panda": {
      "command": "node",
      "args": ["/path/to/mcp-server/src/mcp-server.mjs"],
      "env": {
        "MCP_API_BASE_URL": "https://mimi-panda.com",
        "MCP_API_PREFIX": "/api",
        "MCP_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

After adding the configuration, restart Claude Desktop to connect to the server.

## Available Tools

The server exposes two main tools:

### 1. `list_api_routes`

List all available API routes with their descriptions, authentication requirements, and schemas.

Each route in the response includes structured metadata (types, descriptions, enum values, nested objects) and the plaintext summary now lists every field and its allowed values, so MCP clients can see accepted parameters before issuing a request.

**Parameters:**
- `filter` (optional): Case-insensitive filter for method, path, or description
- `group` (optional): Filter by logical group (`auth` or `service`)

**Example:**
```
List all routes in the "service" group
```

### 2. `call_api`

Perform HTTP requests to any Mimi Panda API endpoint.

**Parameters:**
- `method` (default: `GET`): HTTP method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`)
- `path`: API path relative to the prefix (e.g., `service/coloring`)
- `query` (optional): Query string parameters
- `body` (optional): Request payload (objects/arrays are JSON-encoded)
- `token` (optional): Bearer token (uses `MCP_API_TOKEN` if omitted)
  > Leave the environment variable empty until you copy an API token from the Mimi Panda application; once you have it, set the value in `.env` or pass it per-request.
- `headers` (optional): Additional headers
- `timeoutMs` (optional): Request timeout override (max 120000ms)

**Example:**
```
Call the coloring API with an image URL
```

**LLM token workflow:** Sign up and log in through the Mimi Panda application first, then copy your API token into `.env` or pass it via the `token` field. The MCP server will continue to manage the `Bearer` prefix automatically, but it no longer provisions accounts or tokens on its own.

## API Endpoints

The server provides access to the following Mimi Panda API endpoints:

### Authentication
- `POST /api/auth/login` - Authenticate and receive API token
- `GET /api/user/me` - Get authenticated user profile
- `POST /api/user/logout` - Invalidate current token

> Accounts must now be created and authenticated inside the Mimi Panda application. After logging in there, copy the API token from your profile before using this MCP server.

### Services
- `POST /api/service/coloring` - Create coloring pages from images
- `POST /api/service/pbn` - Generate paint-by-numbers images
- `POST /api/service/ai/coloring` - Generate AI coloring pages from prompts
- `POST /api/service/ai/image` - Generate AI images from prompts
- `POST /api/service/image/upscale` - Upscale images (2x or 4x)
- `POST /api/service/image/filter` - Apply AI filters to images
- `GET /api/service/item/{uuid}` - Retrieve task results by UUID

### PBN Downloads

Once a PBN item status is `ready`, download its files directly:

- `GET /api/service/item/{uuid}/pbn/download/{type}` - Download a PBN image file

  Supported `type` values: `pbn`, `origin`, `source`, `outlines`, `outlinespng`, `grayscale`, `grayscalepng`, `pbnpng`, `originpng`, `originwithnumbers`, `custom`, `pbnpdf`, `outlinespdf`, `grayscalepdf`, `originpdf`

  Optional query params: `width`, `height` (pixels, for PNG/PDF types). The `custom` type requires additional `download-type`, `download-strokes-color`, and `download-numbers-color` query params.

- `GET /api/service/item/{uuid}/pbn/colors/{type}` - Download the PBN color palette

  Supported `type` values: `pdf`, `pdfshort`, `png`, `pngshort`, `csv`, `swatches`, `gpl`, `kpl`

For detailed parameter information, use the `list_api_routes` tool.

## Development

### Project Structure

```
mcp-server/
├── src/
│   ├── mcp-server.mjs          # Main server implementation
│   └── mcp-ai-filter-types.json # AI filter type definitions
├── .github/                    # GitHub templates and workflows
├── .gitignore
├── .npmignore
├── .env.example                # Sample environment configuration
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── PRODUCTION_CHECKLIST.md
├── package.json
├── package-lock.json
└── README.md
```

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions, please open an issue on [GitHub](https://github.com/mimipanda/mcp-server/issues).

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol specification
- [MCP SDK](https://github.com/modelcontextprotocol/sdk) - Official MCP SDK

---

Made with ❤️ by Slava R. and Ira R. - [Mimi Panda team](https://mimi-panda.com)
