/**
 * MCP Server implementation
 * Simplified architecture with direct Gemini integration
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
// API clients
import { createGeminiClient, type GeminiClient } from '../api/geminiClient.js'
import { createGeminiTextClient, type GeminiTextClient } from '../api/geminiTextClient.js'
// Business logic
import { createFileManager, type FileManager } from '../business/fileManager.js'
import { validateGenerateImageParams } from '../business/inputValidator.js'
import { createResponseBuilder, type ResponseBuilder } from '../business/responseBuilder.js'
import {
  createStructuredPromptGenerator,
  type FeatureFlags,
  type StructuredPromptGenerator,
} from '../business/structuredPromptGenerator.js'
// Types
import type { GenerateImageParams, MCPServerConfig } from '../types/mcp.js'

// Utilities
import { getConfig } from '../utils/config.js'
import { Logger } from '../utils/logger.js'
import { SecurityManager } from '../utils/security.js'
import { ErrorHandler } from './errorHandler.js'

/**
 * Default MCP server configuration
 */
const DEFAULT_CONFIG: MCPServerConfig = {
  name: 'mcp-image-server',
  version: '0.1.0',
  defaultOutputDir: './output',
}

/**
 * Simplified MCP server
 */
export class MCPServerImpl {
  private config: MCPServerConfig
  private server: Server | null = null
  private logger: Logger
  private fileManager: FileManager
  private responseBuilder: ResponseBuilder
  private securityManager: SecurityManager
  private structuredPromptGenerator: StructuredPromptGenerator | null = null
  private geminiTextClient: GeminiTextClient | null = null
  private geminiClient: GeminiClient | null = null

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.logger = new Logger()
    this.fileManager = createFileManager()
    this.responseBuilder = createResponseBuilder()
    this.securityManager = new SecurityManager()
  }

  /**
   * Get server info
   */
  public getServerInfo() {
    return {
      name: this.config.name,
      version: this.config.version,
    }
  }

  /**
   * Get list of registered tools
   */
  public getToolsList() {
    return {
      tools: [
        {
          name: 'generate_image',
          description:
            'Generate, edit, blend, or merge images using AI. Supports text-to-image generation, single image editing, and multi-image composition/blending. Use inputImagePaths for merging multiple images from file paths, or inputImages for base64 encoded images.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              prompt: {
                type: 'string' as const,
                description:
                  'The prompt for image generation (English recommended for optimal structured prompt enhancement)',
              },
              fileName: {
                type: 'string' as const,
                description:
                  'Custom file name for the output image. Auto-generated if not specified.',
              },
              inputImagePath: {
                type: 'string' as const,
                description:
                  'Optional absolute path to source image for image-to-image generation. Use when generating variations, style transfers, or similar images based on an existing image (must be an absolute path)',
              },
              inputImage: {
                type: 'string' as const,
                description:
                  'Optional base64 encoded image data for image-to-image generation. Alternative to inputImagePath when image data is already in memory. Do not include data URI prefix (e.g., "data:image/png;base64,")',
              },
              inputImageMimeType: {
                type: 'string' as const,
                description:
                  'MIME type of the input image provided via inputImage. Required when inputImage is provided for accurate processing',
                enum: [
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/gif',
                  'image/bmp',
                ],
              },
              inputImages: {
                type: 'array' as const,
                description:
                  'Multiple input images for multi-image composition. Cannot be used together with inputImage or inputImagePath. Each item requires base64 data and MIME type.',
                items: {
                  type: 'object' as const,
                  properties: {
                    data: {
                      type: 'string' as const,
                      description: 'Base64 encoded image data. Do not include data URI prefix.',
                    },
                    mimeType: {
                      type: 'string' as const,
                      description: 'MIME type of the image',
                      enum: [
                        'image/jpeg',
                        'image/png',
                        'image/webp',
                        'image/gif',
                        'image/bmp',
                      ],
                    },
                  },
                  required: ['data', 'mimeType'],
                },
              },
              inputImagePaths: {
                type: 'array' as const,
                description:
                  'Multiple input image file paths for multi-image composition. Cannot be used together with inputImage, inputImagePath, or inputImages. Each path must be absolute.',
                items: {
                  type: 'string' as const,
                  description: 'Absolute path to an image file',
                },
              },
              returnBase64: {
                type: 'boolean' as const,
                description:
                  'Return the generated image as base64 data in the response. The image is always saved to disk regardless of this setting. Default: false',
              },
              blendImages: {
                type: 'boolean' as const,
                description:
                  'Enable multi-image blending for combining multiple visual elements naturally. Use when prompt mentions multiple subjects or composite scenes',
              },
              maintainCharacterConsistency: {
                type: 'boolean' as const,
                description:
                  'Maintain character appearance consistency. Enable when generating same character in different poses/scenes',
              },
              useWorldKnowledge: {
                type: 'boolean' as const,
                description:
                  'Use real-world knowledge for accurate context. Enable for historical figures, landmarks, or factual scenarios',
              },
              useGoogleSearch: {
                type: 'boolean' as const,
                description:
                  "Enable Google Search grounding to access real-time web information for factually accurate image generation. Use when prompt requires current or time-sensitive data that may have changed since the model's knowledge cutoff. Leave disabled for creative, fictional, historical, or timeless content.",
              },
              aspectRatio: {
                type: 'string' as const,
                description: 'Aspect ratio for the generated image',
                enum: [
                  '1:1',
                  '1:4',
                  '1:8',
                  '2:3',
                  '3:2',
                  '3:4',
                  '4:1',
                  '4:3',
                  '4:5',
                  '5:4',
                  '8:1',
                  '9:16',
                  '16:9',
                  '21:9',
                ],
              },
              imageSize: {
                type: 'string' as const,
                description:
                  'Image resolution for high-quality output. Specify "1K", "2K", or "4K" when you need specific resolution. Leave unspecified for standard quality.',
                enum: ['1K', '2K', '4K'],
              },
              purpose: {
                type: 'string' as const,
                description:
                  'Intended use for the image (e.g., cookbook cover, social media post, presentation slide). Influences lighting, composition, and detail level to match the context.',
              },
              quality: {
                type: 'string' as const,
                description:
                  'Quality preset controlling speed/fidelity tradeoff. Only specify when the user explicitly requests a specific quality level; omit to use the server\'s configured default. "fast": best for drafts and rapid iteration. "balanced": better detail and coherence, moderate latency. "quality": highest fidelity, use for final deliverables where quality matters most.',
                enum: ['fast', 'balanced', 'quality'],
              },
              skipPromptEnhancement: {
                type: 'boolean' as const,
                description:
                  'Skip prompt enhancement and use the prompt as-is. Enable when your prompt already contains exact instructions (e.g., multi-image blending) that should not be rewritten. Default: false',
              },
            },
            required: ['prompt'],
          },
        },
      ],
    }
  }

  /**
   * Tool execution
   */
  public async callTool(name: string, args: unknown) {
    try {
      if (name === 'generate_image') {
        return await this.handleGenerateImage(args as GenerateImageParams)
      }
      throw new Error(`Unknown tool: ${name}`)
    } catch (error) {
      this.logger.error('mcp-server', 'Tool execution failed', error as Error)
      return ErrorHandler.handleError(error as Error)
    }
  }

  /**
   * Initialize Gemini clients lazily
   */
  private async initializeClients(): Promise<void> {
    if (this.structuredPromptGenerator && this.geminiClient) return

    const configResult = getConfig()
    if (!configResult.success) {
      throw configResult.error
    }

    // Initialize Gemini Text Client for prompt generation
    if (!this.geminiTextClient) {
      const textClientResult = createGeminiTextClient(configResult.data)
      if (!textClientResult.success) {
        throw textClientResult.error
      }
      this.geminiTextClient = textClientResult.data
    }

    // Initialize Structured Prompt Generator
    if (!this.structuredPromptGenerator) {
      this.structuredPromptGenerator = createStructuredPromptGenerator(this.geminiTextClient)
    }

    // Initialize Gemini Client for image generation
    if (!this.geminiClient) {
      const clientResult = createGeminiClient(configResult.data)
      if (!clientResult.success) {
        throw clientResult.error
      }
      this.geminiClient = clientResult.data
    }

    this.logger.info('mcp-server', 'Gemini clients initialized')
  }

  /**
   * Simplified image generation handler
   */
  private async handleGenerateImage(params: GenerateImageParams) {
    const result = await ErrorHandler.wrapWithResultType(async () => {
      // Validate input
      const validationResult = validateGenerateImageParams(params)
      if (!validationResult.success) {
        throw validationResult.error
      }

      // Get configuration
      const configResult = getConfig()
      if (!configResult.success) {
        throw configResult.error
      }

      // Initialize clients
      await this.initializeClients()

      // Handle input image if provided
      let inputImageData: string | undefined
      let inputImageMimeType: string | undefined
      let inputImagesData: Array<{ data: string; mimeType: string }> | undefined
      if (params.inputImagePaths && params.inputImagePaths.length > 0) {
        // Multi-image from file paths: read each file and derive mimeType from extension
        const extToMime: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
        }
        inputImagesData = await Promise.all(
          params.inputImagePaths.map(async (filePath) => {
            const buffer = await fs.readFile(filePath)
            const ext = path.extname(filePath).toLowerCase()
            return {
              data: buffer.toString('base64'),
              mimeType: extToMime[ext] || 'image/jpeg',
            }
          })
        )
        inputImageData = inputImagesData[0]?.data
        inputImageMimeType = inputImagesData[0]?.mimeType
      } else if (params.inputImages && params.inputImages.length > 0) {
        // Multi-image: strip data URI prefix from each image
        inputImagesData = params.inputImages.map((img) => ({
          data: img.data.replace(/^data:image\/[a-z]+;base64,/, ''),
          mimeType: img.mimeType,
        }))
        // Use first image for prompt enhancement context
        inputImageData = inputImagesData[0]?.data
        inputImageMimeType = inputImagesData[0]?.mimeType
      } else if (params.inputImagePath) {
        const imageBuffer = await fs.readFile(params.inputImagePath)
        inputImageData = imageBuffer.toString('base64')
      } else if (params.inputImage) {
        // Use base64 input directly, stripping data URI prefix if present
        inputImageData = params.inputImage.replace(/^data:image\/[a-z]+;base64,/, '')
        inputImageMimeType = params.inputImageMimeType
      }

      // Generate structured prompt (unless skipped)
      let structuredPrompt = params.prompt
      const shouldSkipEnhancement =
        params.skipPromptEnhancement ?? configResult.data.skipPromptEnhancement
      if (!shouldSkipEnhancement && this.structuredPromptGenerator) {
        const features: FeatureFlags = {}
        if (params.maintainCharacterConsistency !== undefined) {
          features.maintainCharacterConsistency = params.maintainCharacterConsistency
        }
        if (params.blendImages !== undefined) {
          features.blendImages = params.blendImages
        }
        if (params.useWorldKnowledge !== undefined) {
          features.useWorldKnowledge = params.useWorldKnowledge
        }
        if (params.useGoogleSearch !== undefined) {
          features.useGoogleSearch = params.useGoogleSearch
        }

        const promptResult = await this.structuredPromptGenerator.generateStructuredPrompt(
          params.prompt,
          features,
          inputImageData, // Pass image data for context-aware prompt generation
          params.purpose // Pass intended use for purpose-aware prompt generation
        )

        if (promptResult.success) {
          structuredPrompt = promptResult.data.structuredPrompt

          this.logger.info('mcp-server', 'Structured prompt generated', {
            originalLength: params.prompt.length,
            structuredLength: structuredPrompt.length,
            selectedPractices: promptResult.data.selectedPractices,
          })
        } else {
          this.logger.warn('mcp-server', 'Using original prompt', {
            error: promptResult.error.message,
          })
        }
      } else if (shouldSkipEnhancement) {
        this.logger.info('mcp-server', 'Prompt enhancement skipped (SKIP_PROMPT_ENHANCEMENT=true)')
      }

      // Generate image using Gemini API
      if (!this.geminiClient) {
        throw new Error('Gemini client not initialized')
      }

      const generationResult = await this.geminiClient.generateImage({
        prompt: structuredPrompt,
        ...(inputImagesData && { inputImages: inputImagesData }),
        ...(!inputImagesData && inputImageData && { inputImage: inputImageData }),
        ...(!inputImagesData && inputImageMimeType && { inputImageMimeType }),
        ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
        ...(params.imageSize && { imageSize: params.imageSize }),
        ...(params.useGoogleSearch !== undefined && { useGoogleSearch: params.useGoogleSearch }),
        ...(params.quality !== undefined && { quality: params.quality }),
      })

      if (!generationResult.success) {
        throw generationResult.error
      }

      // Save image file
      let fileName = params.fileName || this.fileManager.generateFileName()
      // Auto-append extension if user-provided fileName has no extension
      if (params.fileName && !path.extname(fileName)) {
        const mimeToExt: Record<string, string> = {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/webp': '.webp',
          'image/gif': '.gif',
          'image/bmp': '.bmp',
        }
        fileName += mimeToExt[generationResult.data.metadata.mimeType] || '.png'
      }
      const outputPath = path.join(configResult.data.imageOutputDir, fileName)

      const sanitizedPath = this.securityManager.sanitizeFilePath(outputPath)
      if (!sanitizedPath.success) {
        throw sanitizedPath.error
      }

      const saveResult = await this.fileManager.saveImage(
        generationResult.data.imageData,
        sanitizedPath.data
      )
      if (!saveResult.success) {
        throw saveResult.error
      }

      // Build response
      if (params.returnBase64) {
        const base64Data = generationResult.data.imageData.toString('base64')
        return this.responseBuilder.buildBase64SuccessResponse(
          generationResult.data,
          saveResult.data,
          base64Data
        )
      }
      return this.responseBuilder.buildSuccessResponse(generationResult.data, saveResult.data)
    }, 'image-generation')

    if (result.ok) {
      return result.value
    }

    return this.responseBuilder.buildErrorResponse(result.error)
  }

  /**
   * Initialize MCP server with tool handlers
   */
  public initialize(): Server {
    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    // Setup tool handlers
    this.setupHandlers()

    return this.server
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    if (!this.server) {
      throw new Error('Server not initialized')
    }

    // Register tool list handler
    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      return this.getToolsList()
    })

    // Register tool call handler
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request): Promise<CallToolResult> => {
        const { name, arguments: args } = request.params
        const result = await this.callTool(name, args)
        const response: CallToolResult = {
          content: result.content,
        }
        if (result.structuredContent) {
          response.structuredContent = result.structuredContent as { [x: string]: unknown }
        }
        return response
      }
    )
  }
}

/**
 * Factory function to create MCP server
 */
export function createMCPServer(config: Partial<MCPServerConfig> = {}) {
  return new MCPServerImpl(config)
}
