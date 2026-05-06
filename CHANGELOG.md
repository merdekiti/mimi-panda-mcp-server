# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-06

### Added
- Two new PBN download endpoints in `API_ROUTES`:
  - `GET service/item/{uuid}/pbn/download/{type}` — download a finished PBN image in 15 formats (SVG, PNG, PDF variants including outlines, grayscale, origin-with-numbers, and custom with configurable stroke/number colors and optional frame)
  - `GET service/item/{uuid}/pbn/colors/{type}` — download the PBN color palette in 8 formats (PDF, JPEG, CSV, Procreate `.swatches`, GIMP `.gpl`, Krita `.kpl`)
- `PBN_IMAGE_DOWNLOAD_TYPES`, `PBN_COLOR_DOWNLOAD_TYPES`, and `PBN_CUSTOM_DOWNLOAD_TYPES` constant arrays for schema enum validation
- Full Zod input schemas for both download routes including all `custom` type query parameters

### Changed
- Server version bumped to `1.1.0`

## [1.0.0] - 2025-11-22

### Added
- Initial release of Mimi Panda MCP Server
- Support for all Mimi Panda API endpoints:
  - Authentication (login, user profile, logout)
  - Coloring pages generation
  - Paint by numbers creation
  - AI image generation
  - AI filters application
  - Image upscaling
- Two MCP tools:
  - `call_api` - Perform HTTP requests to any API endpoint
  - `list_api_routes` - List and filter available API routes
- Comprehensive error handling and timeout management
- Environment variable configuration support
- Full Zod schema validation for all API routes
- Support for custom headers and authentication tokens
- Sensitive header masking in responses

### Security
- Sensitive headers (authorization, x-api-key) are masked in responses
- Environment variables for secure token management
- Input validation using Zod schemas

[1.0.0]: https://github.com/mimipanda/mcp-server/releases/tag/v1.0.0

