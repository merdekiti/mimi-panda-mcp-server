#!/usr/bin/env node

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';

const SERVER_INFO = {
  name: 'mimi-panda-mcp-server',
  version: '1.1.0',
  description: 'Model Context Protocol (MCP) server for interacting with the Mimi Panda Artist API'
};

const MAX_TIMEOUT_MS = 120000;
const DEFAULT_TIMEOUT_MS = clampTimeout(
  Number.parseInt(process.env.MCP_API_TIMEOUT ?? '60000', 10)
);

const CONFIG = {
  baseUrl: normalizeBaseUrl(
    process.env.MCP_API_BASE_URL ?? process.env.APP_URL ?? 'http://localhost'
  ),
  apiPrefix: normalizeApiPrefix(process.env.MCP_API_PREFIX ?? '/api'),
  defaultToken: sanitizeEnvString(process.env.MCP_API_TOKEN),
  timeoutMs: DEFAULT_TIMEOUT_MS,
  defaultHeaders: parseHeaderRecord(process.env.MCP_API_HEADERS)
};

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key']);

const COLORING_V2_TYPES = ['v2_general', 'v2_detailed', 'v2_anime', 'v2_simplified', 'v2_comic'];
const COLORING_V1_TYPES = ['image', 'photo'];
const PBN_SEGMENT_COMPLEXITIES = ['none', 'level1', 'level2', 'level3', 'simplest'];
const PBN_MODES = ['pixel', 'polygon'];
const COLORING_TYPE_OPTIONS = [...new Set([...COLORING_V2_TYPES, ...COLORING_V1_TYPES])];
const aiFilterTypesFromJson = JSON.parse(
  readFileSync(new URL('./mcp-ai-filter-types.json', import.meta.url), 'utf8')
);
const AI_FILTER_TYPES = [
  'none',
  'painting-general',
  'painting-oil-painting',
  'painting-palette-knife',
  'painting-acrylic',
  'painting-watercolor',
  'painting-gouache',
  'painting-digital',
  'painting-graffiti',
  'painting-grimdark',
  'painting-impasto',
  'painting-impressionism-painting-style',
  'painting-magic-realism',
  'painting-pointillism',
  'painting-renaissance',
  'painting-retrofuturism'
];
const AI_FILTER_TYPES_FULL = Array.from(new Set([...aiFilterTypesFromJson]));
const AI_COLORING_ASPECT_RATIOS = ['1x1', '2x3', '3x2', '4x3', '3x4', '9x16', '16x9'];
const AI_COLORING_STYLES = ['kids_coloring_page', 'teenagers_coloring_page', 'adults_coloring_page'];
const AI_COLORING_VERSIONS = ['v1', 'v2'];
const NAME_COLORING_FONT_STYLES = ['angular', 'rounded', 'graffiti', 'bubble'];
const NAME_COLORING_ASPECT_RATIOS = ['1x1', '2x3', '3x2'];
const AI_IMAGE_ASPECT_RATIOS = ['1x1', '2x3', '3x2', '4x5', '5x4', '4x3', '3x4', '9x16', '16x9'];
const AI_FILTER_STRENGTH_VALUES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const PBN_IMAGE_DOWNLOAD_TYPES = [
  'pbn', 'origin', 'source',
  'outlines', 'outlinespng',
  'grayscale', 'grayscalepng',
  'pbnpng', 'originpng',
  'originwithnumbers', 'custom',
  'pbnpdf', 'outlinespdf', 'grayscalepdf', 'originpdf'
];
const PBN_COLOR_DOWNLOAD_TYPES = ['pdf', 'pdfshort', 'png', 'pngshort', 'csv', 'swatches', 'gpl', 'kpl'];
const PBN_CUSTOM_DOWNLOAD_TYPES = ['pbn', 'outlines', 'hybrid'];
const VAL_PALETTE_DOWNLOAD_TYPES = [
  'swatches', 'gpl', 'kpl', 'pdf', 'pdf-short', 'image', 'image-short',
  'csv', 'css', 'tailwind', 'json', 'svg'
];
const VAL_FREE_DOWNLOAD_TYPES = ['css', 'tailwind', 'json'];
const LIST_ITEM_TYPES = [
  'coloring',
  'pbn',
  'ai_coloring',
  'ai_image',
  'name_coloring',
  'upscale',
  'ai_filter'
];
const LIST_ITEM_STATUSES = ['in_queue', 'processing', 'ready', 'failed'];
const GET_ITEM_STATUSES = [...LIST_ITEM_STATUSES, 'banned'];
const IMAGE_OR_URL_SCHEMA = z
  .string()
  .describe('Image upload (multipart file field) or publicly accessible URL. Accepted formats: jpg, png, webp, jpeg, heic, heif. Maximum size: 20MB. Maximum dimensions: 15000x15000px or 4000x4000px for upscale.');
const TASK_CREATION_OUTPUT_SCHEMA = z.object({
  key: z.string().describe('API key used to poll task results via /service/item/{uuid}'),
  status: z.string().describe('Current task status'),
  created: z
    .string()
    .describe('Creation timestamp (ISO 8601)')
});
const SchemaSummaryBase = z.lazy(() =>
  z.object({
    type: z.string(),
    description: z.string().nullable().optional(),
    properties: z.record(SchemaSummaryBase).optional(),
    enumValues: z.array(z.string()).optional(),
    items: z.union([SchemaSummaryBase, z.array(SchemaSummaryBase)]).optional(),
    unionOptions: z.array(SchemaSummaryBase).optional(),
    optional: z.boolean().optional(),
    nullable: z.boolean().optional()
  })
);
const SchemaSummarySchema = SchemaSummaryBase.nullable();

function summarizeSchema(schema) {
  return summarizeSchemaInternal(schema);
}

function summarizeSchemaInternal(schema, meta = {}) {
  if (!schema) {
    return null;
  }

  if (schema instanceof z.ZodOptional) {
    return summarizeSchemaInternal(schema.unwrap(), { ...meta, optional: true });
  }

  if (schema instanceof z.ZodNullable) {
    return summarizeSchemaInternal(schema.unwrap(), { ...meta, nullable: true });
  }

  if (schema instanceof z.ZodDefault) {
    return summarizeSchemaInternal(schema.removeDefault(), meta);
  }

  if (schema instanceof z.ZodEffects) {
    return summarizeSchemaInternal(schema._def.schema, meta);
  }

  if (schema instanceof z.ZodBranded) {
    return summarizeSchemaInternal(schema._def.type, meta);
  }

  const typeName = schema?._def?.typeName ?? 'unknown';
  let summary = {
    type: mapZodTypeName(typeName),
    description: schema?._def?.description ?? null
  };

  if (schema instanceof z.ZodObject) {
    const rawShape = schema.shape ?? schema._def?.shape?.();
    const shape = typeof rawShape === 'function' ? rawShape() : rawShape ?? {};
    const properties = Object.entries(shape).reduce((acc, [key, value]) => {
      const propertySummary = summarizeSchemaInternal(value);
      if (propertySummary) {
        acc[key] = propertySummary;
      }
      return acc;
    }, {});
    summary = {
      ...summary,
      type: 'object',
      properties: Object.keys(properties).length ? properties : undefined
    };
  } else if (schema instanceof z.ZodEnum) {
    summary = {
      ...summary,
      type: 'enum',
      enumValues: [...schema.options]
    };
  } else if (schema instanceof z.ZodNativeEnum) {
    summary = {
      ...summary,
      type: 'enum',
      enumValues: Object.values(schema._def?.values ?? {}).map((value) => String(value))
    };
  } else if (schema instanceof z.ZodLiteral) {
    summary = {
      ...summary,
      type: 'literal',
      enumValues: [String(schema._def?.value)]
    };
  } else if (schema instanceof z.ZodUnion) {
    summary = {
      ...summary,
      type: 'union',
      unionOptions: schema._def.options
        .map((option) => summarizeSchemaInternal(option))
        .filter(Boolean)
    };
  } else if (schema instanceof z.ZodDiscriminatedUnion) {
    summary = {
      ...summary,
      type: 'union',
      unionOptions: Array.from(schema.options.values())
        .map((option) => summarizeSchemaInternal(option))
        .filter(Boolean)
    };
  } else if (schema instanceof z.ZodArray) {
    summary = {
      ...summary,
      type: 'array',
      items: summarizeSchemaInternal(schema._def.type)
    };
  } else if (schema instanceof z.ZodRecord) {
    summary = {
      ...summary,
      type: 'record',
      items: summarizeSchemaInternal(schema._def.valueType)
    };
  } else if (schema instanceof z.ZodTuple) {
    summary = {
      ...summary,
      type: 'tuple',
      items: schema._def.items
        .map((item) => summarizeSchemaInternal(item))
        .filter(Boolean)
    };
  }

  if (meta.optional) {
    summary.optional = true;
  }
  if (meta.nullable) {
    summary.nullable = true;
  }

  return summary;
}

function mapZodTypeName(typeName) {
  switch (typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject:
      return 'object';
    case z.ZodFirstPartyTypeKind.ZodEnum:
    case z.ZodFirstPartyTypeKind.ZodNativeEnum:
      return 'enum';
    case z.ZodFirstPartyTypeKind.ZodArray:
      return 'array';
    case z.ZodFirstPartyTypeKind.ZodRecord:
      return 'record';
    case z.ZodFirstPartyTypeKind.ZodUnion:
    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return 'union';
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return 'literal';
    default:
      return typeName?.replace('Zod', '').toLowerCase() ?? 'unknown';
  }
}

const API_ROUTES = [
  {
    method: 'POST',
    path: 'auth/login',
    description: 'Authenticate a user and receive a API access token.',
    authRequired: false,
    group: 'auth',
    notes: 'Public route.',
    inputSchema: z.object({
      email: z.string().email().describe('Registered email address'),
      password: z.string().min(1).describe('Account password')
    }),
    outputSchema: z.object({
      token: z.string().describe('Plain text API access token'),
      userId: z.number().describe('Internal user identifier'),
      plan: z.string().describe('Current subscription tier'),
      credits: z.number().describe('Available credits balance')
    })
  },
  {
    method: 'GET',
    path: 'user/me',
    description: 'Return the authenticated user profile.',
    authRequired: true,
    group: 'auth',
    inputSchema: z.object({}).describe('No body parameters; requires Authorization header.'),
    outputSchema: z.object({
      id: z.number().describe('Authenticated user ID'),
      email: z.string().email().describe('User email'),
      plan: z.string().describe('Subscription plan identifier'),
      credits: z.number().describe('Current credits balance')
    })
  },
  {
    method: 'POST',
    path: 'user/logout',
    description: 'Invalidate the current Sanctum token.',
    authRequired: true,
    group: 'auth',
    inputSchema: z.object({}).describe('No body parameters; requires Authorization header.'),
    outputSchema: z.object({
      message: z.string().describe('Confirmation that all tokens were revoked')
    })
  },
  {
    method: 'POST',
    path: 'service/coloring',
    description: 'Create a coloring page from an uploaded image.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      image: IMAGE_OR_URL_SCHEMA,
      type: z
        .enum(COLORING_TYPE_OPTIONS)
        .optional()
        .describe(
          'Optional coloring style. Defaults to v2_general for version=v2, photo for version=v1.'
        ),
      version: z.enum(['v1', 'v2']).optional().describe('Processing pipeline version. Defaults to v2.'),
      smart_subject_focus: z.boolean().optional().describe('When enabled, automatically detects and focuses on the main subject of the image for better coloring results. Defaults to false.')
    }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/pbn',
    description: 'Create a paint by numbers image from an upload or prompt.',
    authRequired: true,
    group: 'service',
    inputSchema: z
      .object({
        image: IMAGE_OR_URL_SCHEMA.optional().describe('Optional image upload or URL.'),
        prompt: z
          .string()
          .min(3)
          .max(600)
          .optional()
          .describe('Optional text prompt (required if image omitted).'),
        numberOfColors: z
          .number()
          .int()
          .min(7)
          .max(100)
          .optional()
          .describe('Desired palette size (7-100). Defaults to 30.'),
        segmentsComplexity: z
          .enum(PBN_SEGMENT_COMPLEXITIES)
          .optional()
          .describe('Level of segmentation detail. Defaults to none.'),
        canvasSize: z.string().optional().describe('Target canvas dimensions string in inches. Your Paint by Numbers image will be resized to make the coloring process easier for the selected canvas size. The canvas orientation will be automatically adjusted to match the image orientation. Example: 4x8'),
        crop: z.boolean().optional().describe('Whether to crop input image to fit the selected canvas size.'),
        cropCoordinates: z
          .string()
          .optional()
          .nullable()
          .describe('Crop region as a JSON string with keys x1, y1, x2, y2 — each a normalized float between 0 and 1 (0,0 = top-left, 1,1 = bottom-right). x2 must be greater than x1 and y2 must be greater than y1. Only applied when crop=true. Example: {"x1":0.1,"y1":0.1,"x2":0.9,"y2":0.9}'),
        palette: z
          .number()
          .int()
          .optional()
          .describe('Palette ID owned by the user (premium only).'),
        paletteColors: z
          .string()
          .optional()
          .describe('Comma-separated palette color codes to restrict output. For instance, "1,2,3,4,5".'),
        aiFilterType: z
          .enum(AI_FILTER_TYPES)
          .optional()
          .describe('Optional AI style filter. Defaults to none.'),
        minArea: z
          .union([
            z.literal('auto'),
            z
              .number()
              .min(0)
              .max(100)
              .refine((val) => Number.isInteger(val * 10), {
                message: 'Must be in 0.1 increments.'
              })
          ])
          .optional()
          .describe(
            'Minimum segment area as a percentage of the shortest image side (0–100 in 0.1 increments, e.g. 0, 1.5, 2.3), or "auto" to compute automatically from canvas size. Increasing this value merges smaller color regions. Defaults to "auto". Non-commercial users are clamped to a minimum of 1.5 server-side.'
          ),
        mode: z.enum(PBN_MODES).optional().describe('Segmentation output mode. Defaults to polygon.'),
        enhancement: z.boolean().optional().describe('Enable smart enhancement technique to remove unnecessary details and improve the overall quality of the image (default true).'),
        fixedNumbersSize: z.boolean().nullable().optional().describe('When enabled, ensures that all number labels in the generated PBN have a consistent, uniform size. Defaults to false.'),
        thinLineWidth: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe(
            'Absorbs hairline ridges into surrounding zones. Increase when the source has many fine outlines or the canvas is large. Value is in pixels (at 96 DPI). Defaults to 1.'
          ),
        colorMergeThreshold: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe(
            'Merges adjacent zones with similar colors. Higher values reduce nearly-identical shades more aggressively and may lower the final color count. 0 disables merging. Defaults to 0.'
          ),
        thinZoneMerge: z
          .number()
          .int()
          .min(3)
          .max(50)
          .optional()
          .describe(
            'Zones too narrow to hold a painted number are merged into their neighbor. Increase to eliminate slivers. Value is in pixels (at 96 DPI). Defaults to 3.'
          )
      })
      .refine((data) => data.image || data.prompt, {
        message: 'Provide either image or prompt.'
      }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/ai/coloring',
    description: 'Generate an AI coloring page from a text prompt, optionally guided by a reference image.',
    authRequired: true,
    group: 'service',
    notes: 'Optional image is a reference (image-to-image); omit it for text-to-image. Prompt is always required. Send as multipart/form-data when uploading a file; a URL string may be sent as the image field. JSON-only body cannot carry a file. When a reference is present, output dimensions follow the reference aspect ratio (longest side ≤ 2048px, sides multiple of 8, min 256); aspectRatio is ignored. Content moderation runs on both prompt and reference (400 for trademark/protected content; 503 if moderation fails). HEIC is converted to JPG server-side. version is unused and ignored.',
    inputSchema: z.object({
      prompt: z.string().min(3).max(600).describe('Text prompt for generation.'),
      style: z.enum(AI_COLORING_STYLES).describe('Preset style slug: kids_coloring_page (bold simple outlines), teenagers_coloring_page (moderate detail), adults_coloring_page (thin precise intricate outlines).'),
      aspectRatio: z.enum(AI_COLORING_ASPECT_RATIOS).optional().describe('Canvas aspect ratio. Defaults to 1x1. Ignored when a reference image is provided.'),
      image: IMAGE_OR_URL_SCHEMA.optional().describe(
        'Optional reference image (multipart file or public URL). When provided, generation is image-to-image: keep the subject recognizable and apply the prompt. Result is a black-and-white coloring page in the chosen style. Output size follows the reference (longest side ≤ 2048px); aspectRatio is ignored. Prompt is still required.'
      ),
      version: z.enum(AI_COLORING_VERSIONS).optional().describe('Unused. Ignored by the API; kept for backward compatibility.')
    }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/ai/name-coloring',
    description: 'Generate a name coloring page from a person\'s name with a chosen font style and optional decorative elements.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      name: z.string().max(70).describe('Name or short text to render as a coloring page (max 70 characters).'),
      fontStyle: z.enum(NAME_COLORING_FONT_STYLES).describe('Font style for the name: angular, rounded, graffiti, or bubble.'),
      aspectRatio: z.enum(NAME_COLORING_ASPECT_RATIOS).describe('Canvas aspect ratio: 1x1, 2x3, or 3x2.'),
      elementInText: z.string().max(80).optional().nullable().describe('Optional decorative elements to draw inside the letters (max 80 characters). Example: "stars, hearts".'),
      elementAroundText: z.string().max(80).optional().nullable().describe('Optional decorative elements to draw around the name (max 80 characters). Example: "flowers, butterflies".'),
      backgroundDecoration: z.string().max(80).optional().nullable().describe('Optional background decoration description (max 80 characters). Example: "simple geometric patterns".')
    }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/ai/image',
    description: 'Generate an AI image from a text prompt, optionally guided by a reference image.',
    authRequired: true,
    group: 'service',
    notes: 'Optional image is a reference (image-to-image); omit it for text-to-image. Prompt is always required. Send as multipart/form-data when uploading a file; a URL string may be sent as the image field. JSON-only body cannot carry a file. When a reference is present, output dimensions follow the reference aspect ratio (longest side ≤ 2048px, sides multiple of 8, min 256). aspectRatio remains required by validation but is ignored for output size. Content moderation runs on both prompt and reference (400 for trademark/protected content; 503 if moderation fails). HEIC is converted to JPG server-side.',
    inputSchema: z.object({
      prompt: z.string().min(3).max(600).describe('Text prompt for generation.'),
      aspectRatio: z.enum(AI_IMAGE_ASPECT_RATIOS).describe('Canvas aspect ratio. Required by validation; ignored for output dimensions when a reference image is provided.'),
      image: IMAGE_OR_URL_SCHEMA.optional().describe(
        'Optional reference image (multipart file or public URL). When provided, generation is image-to-image: keep the subject recognizable and apply the prompt. Result is a polished full-color image. Output size follows the reference (longest side ≤ 2048px); aspectRatio is ignored for dimensions. Prompt is still required.'
      )
    }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/image/upscale',
    description: 'Enhance or upscale uploaded images. Maximum dimensions are 4000x4000 pixels.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      image: IMAGE_OR_URL_SCHEMA,
      upscale: z
        .enum(['2', '4'])
        .or(z.literal(2))
        .or(z.literal(4))
        .describe('Desired upscale factor (2x or 4x).')
    }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/image/filter',
    description: 'Apply AI-based filters to uploaded images.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      image: IMAGE_OR_URL_SCHEMA,
      filterType: z.enum(AI_FILTER_TYPES_FULL).describe('AI filter preset.'),
      strength: z
        .number()
        .refine((val) => AI_FILTER_STRENGTH_VALUES.includes(Number(val)), {
          message: 'Strength must be between 0.2 and 1.0 (step 0.1).'
        })
        .describe('Effect strength multiplier.')
    }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'GET',
    path: 'service/items',
    description: 'List the authenticated user\'s generated items with optional type and status filters.',
    authRequired: true,
    group: 'service',
    notes: 'Returns a slim paginated list from api_model_keys. Use GET /service/item/{uuid} for full detail (colors, prompts, images). thumbnail is null until status is ready. Banned items are excluded from the list and cannot be filtered via ?status=banned.',
    inputSchema: z.object({
      type: z.enum(LIST_ITEM_TYPES).optional().describe('Filter by public item type. ai_coloring matches both catalog_coloring and catalog_coloring_v2 internally.'),
      status: z.enum(LIST_ITEM_STATUSES).optional().describe('Filter by processing status (in_queue, processing, ready, failed). When omitted, only those four statuses are included; banned items are never listed.'),
      page: z.number().int().min(1).optional().describe('Page number for pagination (default 1).'),
      per_page: z.number().int().min(1).max(100).optional().describe('Items per page (default 24, max 100).')
    }),
    outputSchema: z.object({
      data: z.array(
        z.object({
          key: z.string().uuid().describe('Item UUID key.'),
          type: z.enum(LIST_ITEM_TYPES).describe('Item type.'),
          status: z.enum(LIST_ITEM_STATUSES).describe('Current processing status.'),
          created: z.string().describe('Creation timestamp (Y-m-d H:i:s).'),
          title: z.string().nullable().describe('Human-readable title when set; otherwise null.'),
          thumbnail: z.string().url().nullable().describe('Preview image URL when status is ready; otherwise null.')
        })
      ).describe('Matching items for the current page.'),
      meta: z.object({
        current_page: z.number().int().describe('Current page number.'),
        last_page: z.number().int().describe('Last available page number.'),
        per_page: z.number().int().describe('Items per page.'),
        total: z.number().int().describe('Total matching items across all pages.')
      }).describe('Laravel pagination metadata.')
    })
  },
  {
    method: 'GET',
    path: 'service/item/{uuid}',
    description: 'Retrieve a generated item by its UUID.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      uuid: z.string().uuid().describe('Task key returned by creation endpoints.')
    }),
    outputSchema: z.object({
      key: z.string().describe('Echo of supplied UUID key'),
      type: z.enum(LIST_ITEM_TYPES).describe('Public item type (maps internal DB types to API-friendly names).'),
      status: z.enum(GET_ITEM_STATUSES).describe('Current processing status. banned is terminal and includes a localized error message.'),
      created: z.string().describe('Creation timestamp (Y-m-d H:i:s)'),
      updated: z.string().describe('Last update timestamp (Y-m-d H:i:s)'),
      title: z.string().nullish().describe('Human-readable title for PBN and coloring items; omitted or null when not set.'),
      error: z.string().optional().describe('Localized user-facing message when status is banned (content moderation).'),
      images: z
        .union([
          z.array(z.string().url().nullable()),
          z
            .record(
              z.string(),
              z.union([z.string().url().nullable(), z.array(z.string().url().nullable()).nullable()])
            )
            .nullable(),
          z.string().url().nullable()
        ])
        .optional()
        .describe('Resulting asset URLs (varies by task type).'),
      colors: z.any().optional().describe('Palette metadata for PBN outputs.'),
      parameters: z.record(z.any()).optional().describe('Task-specific parameter echo.')
    })
  },
  {
    method: 'GET',
    path: 'service/item/{uuid}/pbn/download/{type}',
    description: 'Download a ready PBN item as a file. Substitute {uuid} and {type} directly in the path when calling call_api. Returns a binary file download (SVG, PNG, or PDF). Use query params for optional width/height and custom-type overrides.',
    authRequired: true,
    group: 'service',
    notes: 'Returns 409 if the item status is not "ready". Returns 404 if the UUID does not point to a PBN item. The response body is binary; isBinary=true and rawText holds the base64-encoded file bytes. Save with: echo "$rawText" | base64 -d > file.ext (use the extension matching the chosen type). For type=custom all download-* query params are required.',
    inputSchema: z.object({
      uuid: z.string().uuid().describe('PBN item key returned by POST /service/pbn.'),
      type: z.enum(PBN_IMAGE_DOWNLOAD_TYPES).describe(
        'Download format. SVG types: pbn, origin, source, outlines, grayscale, originwithnumbers, custom. PNG types (require Inkscape): outlinespng, grayscalepng, pbnpng, originpng. PDF types (require Inkscape): pbnpdf, outlinespdf, grayscalepdf, originpdf.'
      ),
      width: z.number().int().min(1).max(15000).optional().describe('Export width in pixels. Applies to PNG and PDF types only.'),
      height: z.number().int().min(1).max(15000).optional().describe('Export height in pixels. Applies to PNG and PDF types only.'),
      'download-type': z.enum(PBN_CUSTOM_DOWNLOAD_TYPES).optional().describe('Required when type=custom. Determines which elements to render: pbn (numbered regions), outlines (no numbers), hybrid (semi-transparent colors + numbers).'),
      'download-strokes-color': z.string().optional().describe('Required when type=custom. CSS color for stroke lines (e.g. #000000).'),
      'download-numbers-color': z.string().optional().describe('Required when type=custom. CSS color for number labels (e.g. #000000).'),
      'download-hybrid-opacity': z.number().min(0).max(1).optional().describe('Used when type=custom and download-type=hybrid. Opacity of color fills (0–1). Defaults to 0.05.'),
      'download-frame': z.enum(['yes', 'no']).optional().describe('Used when type=custom. Adds a 5 cm border with corner guide lines (192 px at 96 dpi).')
    }),
    outputSchema: z.object({
      file: z.any().describe('Binary file content. The Content-Disposition response header contains the filename. rawText in call_api response holds the raw bytes.')
    })
  },
  {
    method: 'GET',
    path: 'service/item/{uuid}/pbn/colors/{type}',
    description: 'Download the color palette of a ready PBN item as a file. Substitute {uuid} and {type} directly in the path when calling call_api.',
    authRequired: true,
    group: 'service',
    notes: 'Returns 409 if the item status is not "ready". Returns 404 if the UUID does not point to a PBN item. PDF/PNG/binary types return isBinary=true with base64-encoded rawText; decode with: echo "$rawText" | base64 -d > file.ext. Text types (csv, gpl, kpl) return isBinary=false and rawText holds plain text. For type=swatches the API may return either a single .swatches file (<=30 colors) or a .zip archive (>30 colors). Use Content-Disposition filename and X-Mimi-Colors-Format response header (swatches|zip) to detect the exact format.',
    inputSchema: z.object({
      uuid: z.string().uuid().describe('PBN item key returned by POST /service/pbn.'),
      type: z.enum(PBN_COLOR_DOWNLOAD_TYPES).describe(
        'Color export format. pdf/pdfshort: full or compact color chart as PDF. png/pngshort: full or compact color chart as JPEG image. csv: comma-separated values (Code, Name, Hex, RGB, HSL). swatches: Procreate export (.swatches for <=30 colors, .zip with multiple .swatches files for >30 colors). gpl: GIMP palette. kpl: Krita palette.'
      )
    }),
    outputSchema: z.object({
      file: z.any().describe('Binary or text file content. The Content-Disposition response header contains the filename and extension.')
    })
  },
  {
    method: 'POST',
    path: 'service/color/unmix',
    description: 'Unmix a color into its primary and secondary paint components using the Mimi Panda color model.',
    authRequired: true,
    group: 'service',
    notes: 'Returns the hex/rgb/hsl of the input color plus two unmix breakdowns: "unmix" (secondary — splits into primary + secondary pigments) and "unmix_primary" (primary only — splits purely into primary pigments). Values in each breakdown are proportions summing to 1.',
    inputSchema: z.object({
      hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('6-digit hex color, with or without leading #. Example: "a3c2f0".')
    }),
    outputSchema: z.object({
      hex: z.string().describe('Normalized 6-digit hex of the input color (no #).'),
      rgb: z.array(z.number()).length(3).describe('RGB values [R, G, B] each 0–255.'),
      hsl: z.array(z.number()).length(3).describe('HSL values [H (0–360), S (0–1), L (0–1)].'),
      unmix: z.record(z.number()).describe('Secondary unmix breakdown: pigment name → proportion (0–1). Example: {"red": 0.4, "blue": 0.3, "white": 0.3}.'),
      unmix_primary: z.record(z.number()).describe('Primary unmix breakdown: pigment name → proportion (0–1). Uses only primary pigments (red, yellow, blue, black, white).')
    })
  },
  {
    method: 'POST',
    path: 'service/color/mix',
    description: 'Mix 2–4 colors into a single blended result using the Spectral physically-based paint-mixing model (Kubelka-Munk).',
    authRequired: true,
    group: 'service',
    notes: 'Amounts are relative weights and do not need to sum to 1 — the model normalises them internally. Omit "amount" to give all colors equal weight. "tintingStrength" reflects how strongly a pigment tints others (analogous to real paint opacity/dominance); omit it to use the default (1.0).',
    inputSchema: z.object({
      colors: z.array(
        z.object({
          hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('6-digit hex of this color, with or without #.'),
          amount: z.number().min(0.001).optional().describe('Relative weight of this color in the mix. Defaults to 1.0 (equal weight with all others).'),
          tintingStrength: z.number().min(0).optional().describe('How strongly this pigment tints others (default 1.0). Higher values make this color dominate the mix more.')
        })
      ).min(2).max(4).describe('2 to 4 colors to blend together.')
    }),
    outputSchema: z.object({
      hex: z.string().describe('Resulting blended color as a 6-digit hex string (no #).'),
      rgb: z.array(z.number()).length(3).describe('Resulting color as [R, G, B] each 0–255.'),
      hsl: z.array(z.number()).length(3).describe('Resulting color as [H (0–360), S (0–1), L (0–1)].')
    })
  },
  // -------------------------------------------------------------------------
  // VAL / Virtual Artist Lab (Commercial plan; private palettes only)
  // -------------------------------------------------------------------------
  {
    method: 'GET',
    path: 'service/val/palettes',
    description: 'List the authenticated user\'s private Virtual Artist Lab palettes.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan (canAccessValApi). Brand/public palettes are never returned.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      palettes: z.array(
        z.object({
          id: z.number().int().describe('Palette ID.'),
          name: z.string().describe('URL-safe palette slug.'),
          title: z.string().describe('Human-readable palette title.'),
          type: z.string().describe('Always "private" for this endpoint.'),
          colors_number: z.number().int().describe('Number of colors in the palette.')
        })
      ).describe('Array of private palette summaries.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/palettes',
    description: 'Create a new private Virtual Artist Lab palette, optionally with initial colors.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Returns 403 if the user has reached their palette limit. Returns 400 if a private palette with the same title already exists.',
    inputSchema: z.object({
      palette_name: z.string().max(255).describe('Title for the new private palette.'),
      colors: z.array(
        z.object({
          hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('6-digit hex color, with or without #.'),
          rgb: z.any().optional().describe('Optional RGB as [R,G,B] or rgb(r,g,b) string. Derived from hex when omitted.'),
          code: z.string().max(255).optional().describe('Optional color code label.'),
          name: z.string().max(255).optional().describe('Optional color display name.')
        })
      ).max(100).optional().describe('Optional initial colors (max 100).')
    }),
    outputSchema: z.object({
      message: z.string().describe('Success message.'),
      palette: z.object({
        id: z.number().int().describe('Created palette ID.'),
        name: z.string().describe('URL-safe slug.'),
        title: z.string().describe('Palette title.')
      }).describe('Created palette summary.')
    })
  },
  {
    method: 'GET',
    path: 'service/val/palettes/{id}',
    description: 'Get a private palette by ID including colors and options. Substitute {id} in the path.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan and ownership of the private palette (canAccessOwnPrivatePalette). Returns 404 if not found or not owned.',
    inputSchema: z.object({
      id: z.number().int().describe('Private palette ID to substitute in the path.')
    }),
    outputSchema: z.object({
      palette: z.object({
        id: z.number().int().describe('Palette ID.'),
        name: z.string().describe('URL-safe slug.'),
        title: z.string().describe('Palette title.'),
        colors: z.record(z.any()).describe('Map of hex → color object {id, hex, rgb, name, code}.'),
        type: z.string().describe('Always "private".'),
        options: z.record(z.any()).describe('Effective palette options (e.g. printCodes).'),
        mixedColors: z.union([z.boolean(), z.any()]).describe('Whether mixed-color recipes are available (false when <2 or >250 colors).'),
        created_at: z.string().describe('Creation timestamp.'),
        updated_at: z.string().describe('Last update timestamp.')
      }).describe('Full private palette payload.')
    })
  },
  {
    method: 'DELETE',
    path: 'service/val/palettes/{id}',
    description: 'Delete a private palette by ID. Substitute {id} in the path.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan and ownership of the private palette. Returns 404 if not found or not owned.',
    inputSchema: z.object({
      id: z.number().int().describe('Private palette ID to substitute in the path.')
    }),
    outputSchema: z.object({
      message: z.string().describe('Success message.')
    })
  },
  {
    method: 'PUT',
    path: 'service/val/palettes/{id}/options',
    description: 'Update private palette options (currently printCodes). Substitute {id} in the path.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan and ownership of the private palette.',
    inputSchema: z.object({
      id: z.number().int().describe('Private palette ID to substitute in the path.'),
      printCodes: z.boolean().describe('Whether to print color codes on palette exports.')
    }),
    outputSchema: z.object({
      message: z.string().describe('Success message.'),
      options: z.record(z.any()).describe('Effective options after update.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/palettes/{id}/colors',
    description: 'Add a color to a private palette. Substitute {id} in the path.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan and ownership. Returns 400 for invalid hex, duplicate code, or max colors exceeded.',
    inputSchema: z.object({
      id: z.number().int().describe('Private palette ID to substitute in the path.'),
      hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('6-digit hex color, with or without #.'),
      rgb: z.any().optional().describe('Optional RGB as [R,G,B] or rgb(r,g,b) string.'),
      code: z.string().max(255).optional().describe('Optional color code label.'),
      name: z.string().max(255).optional().describe('Optional color display name.')
    }),
    outputSchema: z.object({
      message: z.string().describe('Success key, e.g. palette.color_added.'),
      color: z.object({
        id: z.number().int().describe('Color ID within the palette.'),
        hex: z.string().describe('Normalized hex (no #).'),
        rgb: z.array(z.number()).length(3).describe('RGB [R, G, B].'),
        name: z.string().describe('Color name.'),
        code: z.union([z.string(), z.number()]).describe('Color code label.')
      }).describe('Added color object.')
    })
  },
  {
    method: 'PUT',
    path: 'service/val/palettes/{id}/colors/{colorId}',
    description: 'Edit a color in a private palette. Substitute {id} and {colorId} in the path.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan and ownership. Returns 404 if colorId is not in the palette; 400 if code already exists on another color.',
    inputSchema: z.object({
      id: z.number().int().describe('Private palette ID to substitute in the path.'),
      colorId: z.number().int().describe('Color ID within the palette to substitute in the path.'),
      hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('New 6-digit hex color, with or without #.'),
      rgb: z.any().optional().describe('Optional RGB as [R,G,B] or rgb(r,g,b) string.'),
      code: z.string().max(255).optional().describe('Optional new color code label.'),
      name: z.string().max(255).optional().describe('Optional new color display name.')
    }),
    outputSchema: z.object({
      message: z.string().describe('Success key, e.g. palette.color_updated.'),
      color: z.object({
        id: z.number().int().describe('Color ID within the palette.'),
        hex: z.string().describe('Normalized hex (no #).'),
        rgb: z.array(z.number()).length(3).describe('RGB [R, G, B].'),
        name: z.string().describe('Color name.'),
        code: z.union([z.string(), z.number()]).describe('Color code label.')
      }).describe('Updated color object.')
    })
  },
  {
    method: 'DELETE',
    path: 'service/val/palettes/{id}/colors/{colorId}',
    description: 'Delete a color from a private palette. Substitute {id} and {colorId} in the path. Remaining colors are re-indexed.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan and ownership. Returns 404 if colorId is not in the palette.',
    inputSchema: z.object({
      id: z.number().int().describe('Private palette ID to substitute in the path.'),
      colorId: z.number().int().describe('Color ID within the palette to substitute in the path.')
    }),
    outputSchema: z.object({
      message: z.string().describe('Success message.')
    })
  },
  {
    method: 'GET',
    path: 'service/val/palettes/{id}/download/{type}',
    description: 'Download a private palette as a file. Substitute {id} and {type} in the path. Returns a binary/text file download.',
    authRequired: true,
    group: 'service',
    notes: `Requires Commercial plan and ownership. Free download types without Premium: ${VAL_FREE_DOWNLOAD_TYPES.join(', ')}. Other types require a Premium subscription. Palettes with >200 colors cannot export pdf/swatches/image types (use csv/gpl/kpl/css/tailwind/json). Response is a file; isBinary depends on format.`,
    inputSchema: z.object({
      id: z.number().int().describe('Private palette ID to substitute in the path.'),
      type: z.enum(VAL_PALETTE_DOWNLOAD_TYPES).describe(
        'Export format: swatches (Procreate), gpl (GIMP), kpl (Krita), pdf, pdf-short, image, image-short, csv, css, tailwind, json, svg.'
      )
    }),
    outputSchema: z.object({
      file: z.any().describe('Binary or text file content. Content-Disposition contains the filename.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/color/details',
    description: 'Get detailed color info (hex, rgb, hsl, name, and primary/secondary unmix). Brand similar colors are not included.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Brand/vendor similar colors are intentionally omitted from the Service API.',
    inputSchema: z.object({
      hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('6-digit hex color, with or without #.')
    }),
    outputSchema: z.object({
      hex: z.string().describe('Normalized 6-digit hex (no #).'),
      rgb: z.array(z.number()).length(3).describe('RGB [R, G, B] each 0–255.'),
      hsl: z.array(z.number()).length(3).describe('HSL [H (0–360), S (0–1), L (0–1)].'),
      unmix: z.record(z.number()).describe('Secondary unmix breakdown: pigment → proportion.'),
      unmix_primary: z.record(z.number()).describe('Primary unmix breakdown: pigment → proportion.'),
      name: z.string().describe('Human-readable color name.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/mix/chart',
    description: 'Build a spectral paint-mixing chart matrix for 2–10 hex colors.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Returns a square matrix of pairwise mixes via the Spectral (Kubelka-Munk) model.',
    inputSchema: z.object({
      colors: z.array(z.string().regex(/^#?[0-9a-fA-F]{6}$/)).min(2).max(10).describe('2–10 hex colors to include in the mix chart.'),
      include_diagonal: z.boolean().optional().describe('Include self-mix diagonal cells. Defaults to true.')
    }),
    outputSchema: z.object({
      size: z.number().int().describe('Matrix dimension (number of input colors).'),
      hexes: z.array(z.string()).describe('Normalized input hexes used as row/column labels.'),
      matrix: z.array(z.array(z.object({
        hex: z.string().describe('Mixed result hex.'),
        rgb: z.array(z.number()).length(3).describe('Mixed RGB.'),
        hsl: z.array(z.number()).length(3).describe('Mixed HSL.')
      }))).describe('2D array of mix results; matrix[i][j] is colors[i] mixed with colors[j].')
    })
  },
  {
    method: 'POST',
    path: 'service/val/color/match',
    description: 'Find paint recipes that best match a target hex against a private palette or an inline color list.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Provide either palette_id (own private palette) or colors (1–40 inline colors). Returns single/double/triple mix recipes ranked by distance.',
    inputSchema: z.object({
      hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('Target 6-digit hex to match.'),
      palette_id: z.number().int().optional().describe('Own private palette ID to match against. Mutually exclusive with colors (one of the two is required).'),
      colors: z.array(
        z.object({
          hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('Palette color hex.'),
          id: z.any().optional().describe('Optional color id.'),
          name: z.string().max(255).optional().describe('Optional color name.'),
          code: z.string().max(255).optional().describe('Optional color code.')
        })
      ).min(1).max(40).optional().describe('Inline palette colors (1–40). Required if palette_id is omitted.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max matches to return. Defaults to 20.'),
      max_components: z.number().int().min(1).max(3).optional().describe('Max pigments per recipe (1–3). Defaults to 3.')
    }),
    outputSchema: z.object({
      matches: z.array(z.any()).describe('Ranked match recipes (type single|double|triple, mixed color, distance, components).'),
      count: z.number().int().describe('Number of matches returned.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/color-simplifier',
    description: 'Quantize an uploaded image to a limited color palette (color simplifier). Returns a PNG image.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Multipart form upload required (not JSON). Response Content-Type is image/png; isBinary=true in call_api.',
    inputSchema: z.object({
      image: z.string().describe('Multipart file field. Accepted: jpg, jpeg, png, webp. Max 20MB.'),
      numberOfColors: z.number().int().min(2).max(100).describe('Target number of colors in the quantized result.'),
      minArea: z.number().min(0).max(50).describe('Minimum region area as a percentage (0–50). Small regions below this threshold are merged.'),
      segmentsComplexity: z.number().int().min(0).max(100).describe('Meanshift preprocessing strength (0 disables; 1–100 increases segmentation complexity).')
    }),
    outputSchema: z.object({
      file: z.any().describe('PNG binary image. Content-Type: image/png.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/grid',
    description: 'Overlay a drawing grid on an uploaded image. Returns the gridded image as binary.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Multipart form upload required. gridType=square uses squareCells (4|6|8|10|12, default 4).',
    inputSchema: z.object({
      image: z.string().describe('Multipart file field. Accepted: jpg, jpeg, png, webp. Max 20MB.'),
      gridType: z.enum(['3x3', '4x4', 'square']).describe('Grid layout type.'),
      squareCells: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]).optional().describe('Cells per side when gridType=square. Defaults to 4.'),
      showDiagonals: z.boolean().optional().describe('Draw diagonal guide lines. Defaults to false.'),
      strokeColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe('Grid stroke color hex. Defaults to #007bff.'),
      strokeThickness: z.number().min(1).max(10).optional().describe('Stroke thickness. Defaults to 2.'),
      format: z.enum(['jpeg', 'jpg', 'png']).optional().describe('Output image format. Defaults to jpeg.'),
      quality: z.number().int().min(1).max(100).optional().describe('JPEG quality (1–100). Defaults to 90.')
    }),
    outputSchema: z.object({
      file: z.any().describe('Binary image content. Content-Type matches the chosen format.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/outlines',
    description: 'Convert an uploaded photo into a black-and-white printable outline. Fast is balanced, Detailed keeps more small edges, Clean suppresses more noise. Optional 3×3 or 4×4 red grid overlay.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Multipart form upload required (not JSON). Response Content-Type is image/png; isBinary=true in call_api. Longest side is capped at 1800 px.',
    inputSchema: z.object({
      image: z.string().describe('Multipart file field. Accepted: jpg, jpeg, png, webp. Max 20MB.'),
      mode: z.enum(['fast', 'detailed', 'clean']).describe('Outline algorithm: fast (balanced), detailed (more small edges), or clean (suppresses more noise).'),
      showGrid: z.boolean().optional().describe('Overlay a red grid on the outline. Defaults to false.'),
      gridSize: z.union([z.literal(3), z.literal(4)]).optional().describe('Grid size when showGrid is true: 3 (3×3) or 4 (4×4). Defaults to 3.')
    }),
    outputSchema: z.object({
      file: z.any().describe('PNG binary image. Content-Type: image/png.')
    })
  },
  {
    method: 'POST',
    path: 'service/val/tonal-values',
    description: 'Convert an uploaded photo into a tonal study: light / midtone / shadow value shapes, or a 17-stop color map. Shadow and light boundaries are fixed at 50% and 67%.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Multipart form upload required. Response Content-Type is image/png; isBinary=true in call_api. mode=colorMap is camelCase.',
    inputSchema: z.object({
      image: z.string().describe('Multipart file field. Accepted: jpg, jpeg, png, webp. Max 20MB.'),
      mode: z.enum(['light', 'midtone', 'shadow', 'colorMap']).describe('Tonal study type: light, midtone, shadow, or colorMap (17-stop color map).')
    }),
    outputSchema: z.object({
      file: z.any().describe('PNG binary image. Content-Type: image/png.')
    })
  },
  {
    method: 'GET',
    path: 'service/val/mimi-panda-palette/similar',
    description: 'Return the 10 nearest colors in the Mimi Panda palette for a given hex. Pass hex as a query parameter.',
    authRequired: true,
    group: 'service',
    notes: 'Requires Commercial plan. Returns at most 10 nearest colors only — the full Mimi Panda palette catalog is NOT exposed. If an exact match exists it is included with distance 0.',
    inputSchema: z.object({
      hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe('Query parameter: 6-digit hex color to find nearest Mimi Panda palette colors for.')
    }),
    outputSchema: z.object({
      hex: z.string().describe('Normalized input hex (no #).'),
      colors: z.array(
        z.object({
          hex: z.string().describe('Palette color hex.'),
          name: z.string().describe('Palette color name.'),
          code: z.string().describe('Palette color code.'),
          rgb: z.array(z.number()).length(3).describe('RGB values.'),
          hsl: z.array(z.number()).length(3).describe('HSL values.'),
          distance: z.number().describe('Normalized HSL distance from the input (0 = exact).')
        }).passthrough()
      ).max(10).describe('Up to 10 nearest Mimi Panda palette colors (never the full catalog).')
    })
  }
];

const QueryValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const CallApiInputSchema = z.object({
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    .default('GET')
    .describe('HTTP verb to use. Defaults to GET.'),
  path: z
    .string()
    .min(1)
    .describe('Path relative to the api prefix. Example: service/pbn'),
  query: z
    .record(QueryValueSchema.or(z.array(QueryValueSchema)))
    .optional()
    .describe('Optional query string parameters.'),
  body: z
    .union([z.string(), z.array(z.any()), z.record(z.any())])
    .optional()
    .describe('Optional request payload. Objects/arrays will be JSON-encoded automatically.'),
  token: z
    .string()
    .optional()
    .describe('Optional API token. Pass the raw token returned by auth/login; this server automatically prefixes it with "Bearer ". Uses MCP_API_TOKEN when omitted.'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Additional headers to send with the request.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe('Override the default timeout (ms). Max 120000.')
});

const CallApiOutputSchema = z.object({
  request: z.object({
    method: z.string(),
    url: z.string(),
    path: z.string(),
    headers: z.record(z.string()),
    query: z.record(z.any()).nullable(),
    body: z.any().nullable(),
    timeoutMs: z.number()
  }),
  response: z.object({
    status: z.number(),
    statusText: z.string(),
    ok: z.boolean(),
    headers: z.record(z.string()),
    body: z.any().nullable(),
    rawText: z.string(),
    isBinary: z.boolean().describe('True when rawText is base64-encoded binary data. Decode with: echo "$rawText" | base64 -d > file.ext')
  })
});

const ListApiRoutesInputSchema = z.object({
  filter: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional case-insensitive filter applied to method, path, or description.'),
  group: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Filter by logical group (auth, service).')
});

const ListApiRoutesOutputSchema = z.object({
  routes: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      description: z.string(),
      authRequired: z.boolean(),
      group: z.string().nullable(),
      notes: z.string().nullable(),
      inputSchema: SchemaSummarySchema,
      outputSchema: SchemaSummarySchema
    })
  ),
  total: z.number()
});

const mcpServer = new McpServer(SERVER_INFO, {
  instructions: [
    'Interact with the Mimi Panda API.',
    `Current base URL: ${CONFIG.baseUrl}`,
    `API prefix: ${CONFIG.apiPrefix}`,
    'Call list_api_routes to inspect request parameters, including all enum/option values, before invoking call_api.',
    'Obtain API tokens by logging into the Mimi Panda application and copying the token from your account settings. https://mimi-panda.com/app/profile',
    'Supply that token via the token field on subsequent call_api invocations—the server will automatically prefix it with "Bearer ".',
    'If you set the Authorization header manually, be sure to include the "Bearer " prefix yourself.',
    'Set MCP_API_BASE_URL, MCP_API_PREFIX, MCP_API_TOKEN, and MCP_API_TIMEOUT (ms) to override defaults.'
  ].join('\n')
});

mcpServer.registerTool(
  'call_api',
  {
    title: 'Call API',
    description:
      'Send arbitrary HTTP requests to Mimi Panda endpoints (automatically prefixed with MCP_API_PREFIX).',
    inputSchema: CallApiInputSchema,
    outputSchema: CallApiOutputSchema
  },
  async (args) => {
    try {
      const result = await callApi(args);
      return {
        content: [
          {
            type: 'text',
            text: formatCallSummary(result)
          }
        ],
        structuredContent: result
      };
    } catch (error) {
      return mcpServer.createToolError(
        error instanceof Error ? error.message : `Failed to call API: ${String(error)}`
      );
    }
  }
);

mcpServer.registerTool(
  'list_api_routes',
  {
    title: 'List API routes',
    description:
      'Return the curated list of Mimi Panda API routes.',
    inputSchema: ListApiRoutesInputSchema,
    outputSchema: ListApiRoutesOutputSchema
  },
  async ({ filter, group }) => {
    const normalizedFilter = filter?.toLowerCase() ?? null;
    const normalizedGroup = group?.toLowerCase() ?? null;
    const filtered = API_ROUTES.filter((route) => {
      if (normalizedGroup && route.group?.toLowerCase() !== normalizedGroup) {
        return false;
      }
      if (!normalizedFilter) {
        return true;
      }
      return (
        route.path.toLowerCase().includes(normalizedFilter) ||
        route.method.toLowerCase().includes(normalizedFilter) ||
        (route.description?.toLowerCase().includes(normalizedFilter) ?? false) ||
        (route.group?.toLowerCase().includes(normalizedFilter) ?? false)
      );
    });

    const humanReadable = filtered.length
      ? filtered
          .map((route) => formatRouteSummary(route))
          .join('\n\n')
      : 'No routes matched the provided filters.';

    return {
      content: [
        {
          type: 'text',
          text: humanReadable
        }
      ],
      structuredContent: {
        routes: filtered.map((route) => ({
          method: route.method,
          path: route.path,
          description: route.description,
          authRequired: route.authRequired,
          group: route.group ?? null,
          notes: route.notes ?? null,
          inputSchema: summarizeSchema(route.inputSchema),
          outputSchema: summarizeSchema(route.outputSchema)
        })),
        total: filtered.length
      }
    };
  }
);

async function callApi({
  method = 'GET',
  path,
  query,
  body,
  token,
  headers,
  timeoutMs
}) {
  if (!path) {
    throw new Error('Path is required.');
  }

  const url = buildUrl(path, query);
  const controller = new AbortController();
  const appliedTimeout = clampTimeout(timeoutMs ?? CONFIG.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const requestHeaders = buildHeaders(headers);
  const bearerToken = token ?? CONFIG.defaultToken;
  if (bearerToken) {
    requestHeaders.set('Authorization', bearerToken.startsWith('Bearer ') ? bearerToken : `Bearer ${bearerToken}`);
  }

  let serializedBody = null;
  if (body !== undefined) {
    if (typeof body === 'string') {
      serializedBody = body;
      if (!requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'text/plain');
      }
    } else {
      serializedBody = JSON.stringify(body);
      if (!requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'application/json');
      }
    }
  }

  const timer = setTimeout(() => controller.abort(), appliedTimeout);

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: serializedBody ?? undefined,
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type') ?? '';
    const isBinary = isBinaryContentType(contentType);
    let rawText;
    if (isBinary) {
      const buffer = await response.arrayBuffer();
      rawText = Buffer.from(buffer).toString('base64');
    } else {
      rawText = await response.text();
    }
    const parsedBody = isBinary ? null : tryParseJson(rawText);

    const structuredContent = {
      request: {
        method,
        url: url.toString(),
        path: normalizeRelativePath(path),
        headers: headersToObject(requestHeaders),
        query: query ?? null,
        body: body ?? null,
        timeoutMs: appliedTimeout
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: headersToObject(response.headers),
        body: parsedBody ?? null,
        rawText,
        isBinary
      }
    };

    return structuredContent;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request exceeded timeout of ${appliedTimeout}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formatCallSummary(result) {
  const { request, response } = result;
  const preview = createPreview(response.body ?? response.rawText);
  return [
    `${request.method} ${request.path}`,
    `→ ${response.status} ${response.statusText}`,
    preview ? `Body preview: ${preview}` : null
  ]
    .filter(Boolean)
    .join('\n');
}

function formatRouteSummary(route) {
  const inputSummary = summarizeSchema(route.inputSchema);
  const outputSummary = summarizeSchema(route.outputSchema);

  const lines = [
    `${route.method} /${route.path}`,
    route.description ? `- ${route.description}` : null,
    route.authRequired ? 'auth: required' : 'auth: public',
    route.group ? `group: ${route.group}` : null,
    route.notes ? `notes: ${route.notes}` : null,
    inputSummary ? `input:\n${formatSchemaSummary(inputSummary)}` : 'input:\n  (none)',
    outputSummary ? `output:\n${formatSchemaSummary(outputSummary)}` : 'output:\n  (none)'
  ];

  return lines.filter(Boolean).join('\n');
}

function formatSchemaSummary(summary, indent = '  ') {
  if (!summary) {
    return `${indent}(none)`;
  }

  const lines = [`${indent}- type: ${summary.type}`];
  if (summary.description) {
    lines.push(`${indent}- description: ${summary.description}`);
  }
  if (summary.enumValues?.length) {
    lines.push(`${indent}- enum: [${summary.enumValues.join(', ')}]`);
  }
  if (summary.optional) {
    lines.push(`${indent}- optional: true`);
  }
  if (summary.nullable) {
    lines.push(`${indent}- nullable: true`);
  }

  if (summary.properties) {
    lines.push(`${indent}- properties:`);
    for (const [key, value] of Object.entries(summary.properties)) {
      lines.push(`${indent}  ${key}:`);
      lines.push(formatSchemaSummary(value, `${indent}    `));
    }
  }

  if (summary.items) {
    lines.push(`${indent}- items:`);
    if (Array.isArray(summary.items)) {
      summary.items.forEach((item, index) => {
        lines.push(`${indent}  [${index}]:`);
        lines.push(formatSchemaSummary(item, `${indent}    `));
      });
    } else {
      lines.push(formatSchemaSummary(summary.items, `${indent}  `));
    }
  }

  if (summary.unionOptions?.length) {
    lines.push(`${indent}- union options:`);
    summary.unionOptions.forEach((option, index) => {
      lines.push(`${indent}  [${index}]:`);
      lines.push(formatSchemaSummary(option, `${indent}    `));
    });
  }

  return lines.join('\n');
}

function buildHeaders(extraHeaders = {}) {
  const headers = new Headers({
    Accept: 'application/json',
    'User-Agent': `${SERVER_INFO.name}/${SERVER_INFO.version}`,
    'X-Requested-With': 'XMLHttpRequest'
  });

  mergeHeaderRecord(headers, CONFIG.defaultHeaders);
  mergeHeaderRecord(headers, extraHeaders);

  return headers;
}

function mergeHeaderRecord(headers, record) {
  if (!record) {
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null) {
      headers.set(key, String(value));
    }
  }
}

function headersToObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '***' : value;
  }
  return result;
}

function buildUrl(path, query) {
  const relativePath = normalizeRelativePath(path);
  const absolutePath = `${CONFIG.apiPrefix}${relativePath}`;
  const url = new URL(absolutePath, CONFIG.baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          url.searchParams.append(key, normalizeQueryValue(entry));
        });
      } else {
        url.searchParams.append(key, normalizeQueryValue(value));
      }
    }
  }

  return url;
}

function normalizeRelativePath(path) {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  if (trimmed.startsWith(CONFIG.apiPrefix)) {
    const remainder = trimmed.slice(CONFIG.apiPrefix.length);
    return remainder.startsWith('/') ? remainder : `/${remainder}`;
  }
  return trimmed;
}

function normalizeQueryValue(value) {
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return String(value);
}

function normalizeBaseUrl(url) {
  if (!url) {
    return 'http://localhost';
  }
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function normalizeApiPrefix(prefix) {
  if (!prefix) {
    return '/api';
  }
  const withLeadingSlash = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return withLeadingSlash.endsWith('/') && withLeadingSlash !== '/' ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function clampTimeout(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1000, Math.min(MAX_TIMEOUT_MS, value));
}

function parseHeaderRecord(serialized) {
  if (!serialized) {
    return {};
  }

  try {
    const parsed = JSON.parse(serialized);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)])
      );
    }
  } catch (error) {
    console.warn('Failed to parse MCP_API_HEADERS JSON:', error);
  }

  return {};
}

function isBinaryContentType(contentType) {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return (
    type === 'application/pdf' ||
    type === 'application/octet-stream' ||
    type === 'application/zip' ||
    (type.startsWith('image/') && type !== 'image/svg+xml')
  );
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeEnvString(value) {
  return value && value.trim() ? value.trim() : null;
}

function createPreview(body) {
  if (body === null || body === undefined) {
    return '';
  }
  const text =
    typeof body === 'string'
      ? body
      : JSON.stringify(body, (_key, val) => (typeof val === 'bigint' ? String(val) : val));
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

function formatStartupBanner() {
  return `[${SERVER_INFO.name}] Ready (base: ${CONFIG.baseUrl}, prefix: ${CONFIG.apiPrefix})`;
}

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(formatStartupBanner());
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});

