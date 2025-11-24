#!/usr/bin/env node

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';

const SERVER_INFO = {
  name: 'mimi-panda-mcp-server',
  version: '1.0.0',
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
const COLORING_V1_TYPES = ['for_adults', 'for_kids', 'simple', 'image', 'photo', 'sketching'];
const PBN_SEGMENT_COMPLEXITIES = ['none', 'level1', 'level2', 'level3', 'simplest'];
const PBN_GRADIENT_STEPS = ['high', 'normal'];
const PBN_COLOR_PRECISIONS = ['high', 'normal', 'low', 'lowest'];
const PBN_DETAILS_FILTERS = ['ultra', 'high', 'normal', 'low', 'lowest'];
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
const AI_COLORING_STYLES = ['simple_coloring_page', 'detailed_coloring_page', 'realistic_coloring_page'];
const AI_COLORING_VERSIONS = ['v1', 'v2'];
const AI_IMAGE_ASPECT_RATIOS = ['1x1', '2x3', '3x2', '4x5', '5x4'];
const AI_FILTER_STRENGTH_VALUES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
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
          'Optional coloring style. Defaults to v2_general for version=v2, for_adults for version=v1.'
        ),
      version: z.enum(['v1', 'v2']).optional().describe('Processing pipeline version. Defaults to v2.')
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
        gradientStep: z
          .enum(PBN_GRADIENT_STEPS)
          .optional()
          .describe('Gradient smoothing level. Defaults to high.'),
        colorPrecision: z
          .enum(PBN_COLOR_PRECISIONS)
          .optional()
          .describe('Change it only for high contrast pictures. This parameter might lead to the colors number decrease and merging colors zones - fewer details. Defaults to high.'),
        canvasSize: z.string().optional().describe('Target canvas dimensions string in inches. Your Paint by Numbers image will be resized to make the coloring process easier for the selected canvas size. The canvas orientation will be automatically adjusted to match the image orientation. Example: 4x8'),
        crop: z.boolean().optional().describe('Whether to crop input image to fit the selected canvas size.'),
        detailsFilter: z.enum(PBN_DETAILS_FILTERS).optional().describe('Discard small image patches. The higher value, the more details will be preserved. Defaults to normal.'),
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
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe('The minimum size (as a percentage of the shortest side of your image) that a color region must be to remain separate. Increasing this value will combine smaller color regions into larger ones. Default is Auto - automatically detect the minimum size. 0% means no merging.'),
        mode: z.enum(PBN_MODES).optional().describe('Segmentation output mode. Defaults to polygon.'),
        enhancement: z.boolean().optional().describe('Enable smart enhancement technique to remove unnecessary details and improve the overall quality of the image (default true).')
      })
      .refine((data) => data.image || data.prompt, {
        message: 'Provide either image or prompt.'
      }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/ai/coloring',
    description: 'Generate an AI-powered coloring page from a prompt.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      prompt: z.string().min(3).max(600).describe('Text prompt for generation.'),
      style: z.enum(AI_COLORING_STYLES).describe('Preset style slug supplied by provider.'),
      aspectRatio: z.enum(AI_COLORING_ASPECT_RATIOS).describe('Canvas aspect ratio.'),
      version: z.enum(AI_COLORING_VERSIONS).describe('Provider version to use.')
    }),
    outputSchema: TASK_CREATION_OUTPUT_SCHEMA
  },
  {
    method: 'POST',
    path: 'service/ai/image',
    description: 'Generate AI images from a text prompt.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      prompt: z.string().min(3).max(600).describe('Text prompt for generation.'),
      aspectRatio: z.enum(AI_IMAGE_ASPECT_RATIOS).describe('Canvas aspect ratio.')
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
    path: 'service/item/{uuid}',
    description: 'Retrieve a generated item by its UUID.',
    authRequired: true,
    group: 'service',
    inputSchema: z.object({
      uuid: z.string().uuid().describe('Task key returned by creation endpoints.')
    }),
    outputSchema: z.object({
      key: z.string().describe('Echo of supplied UUID key'),
      status: z.string().describe('Current processing status'),
      created: z.string().describe('Creation timestamp (Y-m-d H:i:s)'),
      updated: z.string().describe('Last update timestamp (Y-m-d H:i:s)'),
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
    rawText: z.string()
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

    const rawText = await response.text();
    const parsedBody = tryParseJson(rawText);

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
        rawText
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

