/**
 * MCP-related type definitions
 * Defines types related to @modelcontextprotocol/sdk and project-specific types
 */

/**
 * Context method type for image generation metadata
 */

/**
 * Supported image providers
 */
export type ImageProvider = 'gemini' | 'volcengine'

/**
 * Supported image provider values
 */
export const IMAGE_PROVIDER_VALUES: readonly ImageProvider[] = ['gemini', 'volcengine'] as const

/**
 * Supported aspect ratios for image generation
 */
export type AspectRatio =
  | '1:1' // Square (default)
  | '1:4' // Tall vertical
  | '1:8' // Ultra-tall vertical
  | '2:3' // Portrait
  | '3:2' // Landscape
  | '3:4' // Portrait
  | '4:1' // Ultra-wide horizontal
  | '4:3' // Landscape
  | '4:5' // Portrait
  | '5:4' // Landscape
  | '8:1' // Extreme horizontal
  | '9:16' // Vertical (social media)
  | '16:9' // Horizontal (cinematic)
  | '21:9' // Ultra-wide

/**
 * Supported image sizes for high-resolution output
 */
export type ImageSize = '1K' | '2K' | '4K'

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'

/**
 * Supported image output format values
 */
export const IMAGE_OUTPUT_FORMAT_VALUES: readonly ImageOutputFormat[] = ['png', 'jpeg', 'webp'] as const

/**
 * Quality presets for image generation
 * - 'fast': fastest generation (default)
 * - 'balanced': better quality at moderate speed
 * - 'quality': highest quality output
 */
export type ImageQuality = 'fast' | 'balanced' | 'quality'

/**
 * Supported quality preset values
 */
export const IMAGE_QUALITY_VALUES: readonly ImageQuality[] = [
  'fast',
  'balanced',
  'quality',
] as const

/**
 * Gemini image generation model identifiers
 */
export const GEMINI_MODELS = {
  /** Nano Banana 2 - fast generation with Flash speed */
  FLASH: 'gemini-3.1-flash-image-preview',
  /** Nano Banana Pro - highest quality output */
  PRO: 'gemini-3-pro-image-preview',
} as const

/**
 * Volcengine image generation model identifiers
 */
export const VOLCENGINE_MODELS = {
  /** Seedream 4.5 - default Volcengine model with better resolution and aspect ratio support */
  SEEDREAM_LITE: 'doubao-seedream-4-5-251128',
} as const

/**
 * Parameters for image generation
 */
export interface GenerateImageParams {
  /** Prompt for image generation */
  prompt: string
  /** Optional image provider override. Defaults to IMAGE_PROVIDER environment variable. */
  provider?: ImageProvider
  /** Optional file name for the generated image (if not specified, generates an auto-named file in IMAGE_OUTPUT_DIR) */
  fileName?: string
  /** Absolute path to input image for editing (optional) */
  inputImagePath?: string
  /** Base64 encoded input image data (optional) */
  inputImage?: string
  /** MIME type of the input image (optional, used with inputImage) */
  inputImageMimeType?: string
  /** Multi-image blending functionality (default: false) */
  blendImages?: boolean
  /** Maintain character consistency across generations (default: false) */
  maintainCharacterConsistency?: boolean
  /** Use world knowledge integration for more accurate context (default: false) */
  useWorldKnowledge?: boolean
  /** Enable Google Search grounding for real-time web information (default: false) */
  useGoogleSearch?: boolean
  /** Aspect ratio for generated image (default: "1:1") */
  aspectRatio?: AspectRatio
  /** Image resolution for high-quality output (e.g., "2K", "4K"). Leave unspecified for standard quality */
  imageSize?: ImageSize
  /** Intended use for the image (e.g., cookbook cover, social media post). Helps tailor visual style and quality */
  purpose?: string
  /** Quality preset for image generation (default: "fast") */
  quality?: ImageQuality
  /** Output image format if supported by the provider. Some provider endpoints may ignore or reject format overrides. */
  outputFormat?: ImageOutputFormat
  /** Number of output images to generate when the provider supports grouped output. Use for requests like 4 images, 4 variations, or grouped outputs. Currently implemented for Volcengine. */
  outputCount?: number
  /** Return generated image as base64 data in the response (default: false). Image is always saved to disk regardless */
  returnBase64?: boolean
  /** Multiple input images as base64 for multi-image composition (optional). Cannot be used with other image input params */
  inputImages?: Array<{ data: string; mimeType: string }>
  /** Multiple input image file paths for multi-image composition (optional). Cannot be used with other image input params */
  inputImagePaths?: string[]
  /** Skip prompt enhancement and use the prompt as-is (default: false). Useful for multi-image blending where enhancement may overwrite intent */
  skipPromptEnhancement?: boolean
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  /** Server name */
  name: string
  /** Version */
  version: string
  /** Default image output directory */
  defaultOutputDir: string
}

/**
 * Content types for MCP responses
 */
export type McpContent = {
  type: 'text'
  text: string
}

/**
 * MCP Tool Response format
 */
export interface McpToolResponse {
  content: McpContent[]
  isError?: boolean
  structuredContent?: unknown
}

/**
 * Structured content for successful responses
 */
export interface StructuredContent {
  type: 'resource'
  resource: {
    uri: string
    name: string
    mimeType: string
  }
  metadata: {
    model: string
    processingTime: number
    contextMethod: string
    timestamp: string
  }
}
