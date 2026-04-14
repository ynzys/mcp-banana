/**
 * MCP Server implementation
 * Supports multiple image providers with Gemini prompt enhancement when applicable
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
import { createGeminiClient, type GeminiClient } from '../api/geminiClient.js'
import { createGeminiTextClient, type GeminiTextClient } from '../api/geminiTextClient.js'
import type { ImageProviderClient } from '../api/imageProvider.js'
import { createVolcengineClient, type VolcengineClient } from '../api/volcengineClient.js'
import { createFileManager, type FileManager } from '../business/fileManager.js'
import { validateGenerateImageParams } from '../business/inputValidator.js'
import { createResponseBuilder, type ResponseBuilder } from '../business/responseBuilder.js'
import {
  createStructuredPromptGenerator,
  type FeatureFlags,
  type StructuredPromptGenerator,
} from '../business/structuredPromptGenerator.js'
import type { GenerateImageParams, ImageProvider, MCPServerConfig } from '../types/mcp.js'
import { getConfig } from '../utils/config.js'
import { Logger } from '../utils/logger.js'
import { SecurityManager } from '../utils/security.js'
import { ErrorHandler } from './errorHandler.js'

const DEFAULT_CONFIG: MCPServerConfig = {
  name: 'mcp-image-server',
  version: '0.1.0',
  defaultOutputDir: './output',
}

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
  private volcengineClient: VolcengineClient | null = null

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.logger = new Logger()
    this.fileManager = createFileManager()
    this.responseBuilder = createResponseBuilder()
    this.securityManager = new SecurityManager()
  }

  public getServerInfo() {
    return {
      name: this.config.name,
      version: this.config.version,
    }
  }

  public getToolsList() {
    return {
      tools: [
        {
          name: 'generate_image',
          description:
            'Generate, edit, blend, or merge images using AI. When the user provides local image file paths, those paths must be passed through inputImagePath or inputImagePaths instead of being summarized by the model. Gemini handles prompt enhancement; Volcengine supports text-to-image and reference-image workflows through its OpenAI-compatible image API.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              prompt: {
                type: 'string' as const,
                description:
                  'The prompt for image generation (English recommended for optimal structured prompt enhancement)',
              },
              provider: {
                type: 'string' as const,
                description:
                  'Optional provider override. Defaults to IMAGE_PROVIDER environment variable.',
                enum: ['gemini', 'volcengine'],
              },
              fileName: {
                type: 'string' as const,
                description: 'Custom file name for the output image. Auto-generated if not specified.',
              },
              inputImagePath: {
                type: 'string' as const,
                description:
                  'Optional absolute path to a source image. If the user provides a local image path, pass it here directly instead of summarizing image contents in the prompt. Supported by Gemini and Volcengine reference-image workflows.',
              },
              inputImage: {
                type: 'string' as const,
                description:
                  'Optional base64 encoded image data for image-to-image generation. Gemini accepts raw base64; Volcengine sends this as `data:image/<format>;base64,<data>` and requires `inputImageMimeType` for correct formatting.',
              },
              inputImageMimeType: {
                type: 'string' as const,
                description:
                  'MIME type of the input image provided via inputImage. Required when inputImage is provided for accurate processing',
                enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'],
              },
              inputImages: {
                type: 'array' as const,
                description:
                  'Multiple input images for multi-image composition. Supported by Gemini and by Volcengine when mapped to reference-image arrays.',
                items: {
                  type: 'object' as const,
                  properties: {
                    data: {
                      type: 'string' as const,
                      description: 'Base64 encoded image data. Raw base64 is accepted; for Volcengine it will be sent as `data:image/<format>;base64,<data>` using the paired `mimeType`.',
                    },
                    mimeType: {
                      type: 'string' as const,
                      description: 'MIME type of the image',
                      enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'],
                    },
                  },
                  required: ['data', 'mimeType'],
                },
              },
              inputImagePaths: {
                type: 'array' as const,
                description:
                  'Multiple absolute local image paths for multi-image composition. If the user provides two or more local image paths, pass them here directly instead of summarizing the images in the prompt.',
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
                  'Enable Google Search grounding for Gemini. Ignored by providers that do not support it.',
              },
              aspectRatio: {
                type: 'string' as const,
                description: 'Aspect ratio for the generated image',
                enum: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
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
                  'Quality preset controlling speed/fidelity tradeoff. "fast": drafts, "balanced": better detail, "quality": highest fidelity.',
                enum: ['fast', 'balanced', 'quality'],
              },
              outputFormat: {
                type: 'string' as const,
                description: 'Output image format if supported by the provider. Some provider endpoints may ignore or reject format overrides.',
                enum: ['png', 'jpeg', 'webp'],
              },
              outputCount: {
                type: 'integer' as const,
                description:
                  'Best-effort number of output images to request when the provider supports grouped output. Use for requests like "4 images" or "4 variations". Currently wired for Volcengine, but final image count still depends on provider behavior.',
              },
              skipPromptEnhancement: {
                type: 'boolean' as const,
                description:
                  'Skip prompt enhancement and use the prompt as-is. Enable when your prompt already contains exact instructions.',
              },
            },
            required: ['prompt'],
          },
        },
      ],
    }
  }

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

  private async initializeGeminiSupport(): Promise<void> {
    if (this.structuredPromptGenerator && this.geminiClient) return

    const configResult = getConfig()
    if (!configResult.success) {
      throw configResult.error
    }

    if (!this.geminiTextClient) {
      const textClientResult = createGeminiTextClient(configResult.data)
      if (!textClientResult.success) {
        throw textClientResult.error
      }
      this.geminiTextClient = textClientResult.data
    }

    if (!this.structuredPromptGenerator) {
      this.structuredPromptGenerator = createStructuredPromptGenerator(this.geminiTextClient)
    }

    if (!this.geminiClient) {
      const clientResult = createGeminiClient(configResult.data)
      if (!clientResult.success) {
        throw clientResult.error
      }
      this.geminiClient = clientResult.data
    }
  }

  private async initializeVolcengineSupport(): Promise<void> {
    if (this.volcengineClient) return

    const configResult = getConfig()
    if (!configResult.success) {
      throw configResult.error
    }

    const clientResult = createVolcengineClient(configResult.data)
    if (!clientResult.success) {
      throw clientResult.error
    }

    this.volcengineClient = clientResult.data
  }

  private getProviderClient(provider: ImageProvider): ImageProviderClient {
    if (provider === 'gemini') {
      if (!this.geminiClient) {
        throw new Error('Gemini client not initialized')
      }
      return this.geminiClient
    }

    if (!this.volcengineClient) {
      throw new Error('Volcengine client not initialized')
    }
    return this.volcengineClient
  }

  private async prepareInputImages(params: GenerateImageParams) {
    let inputImageData: string | undefined
    let inputImageMimeType: string | undefined
    let inputImagesData: Array<{ data: string; mimeType: string }> | undefined
    const extToMime: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
    }

    if (params.inputImagePaths && params.inputImagePaths.length > 0) {
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
      inputImagesData = params.inputImages.map((img) => ({
        data: img.data.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''),
        mimeType: img.mimeType,
      }))
      inputImageData = inputImagesData[0]?.data
      inputImageMimeType = inputImagesData[0]?.mimeType
    } else if (params.inputImagePath) {
      const imageBuffer = await fs.readFile(params.inputImagePath)
      const ext = path.extname(params.inputImagePath).toLowerCase()
      inputImageData = imageBuffer.toString('base64')
      inputImageMimeType = extToMime[ext] || 'image/jpeg'
    } else if (params.inputImage) {
      inputImageData = params.inputImage.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
      inputImageMimeType = params.inputImageMimeType
    }

    return { inputImageData, inputImageMimeType, inputImagesData }
  }

  private async maybeEnhancePrompt(
    provider: ImageProvider,
    params: GenerateImageParams,
    inputImageData?: string
  ): Promise<string> {
    const configResult = getConfig()
    if (!configResult.success) {
      throw configResult.error
    }

    const shouldSkipEnhancement =
      params.skipPromptEnhancement ?? configResult.data.skipPromptEnhancement

    if (provider !== 'gemini' || shouldSkipEnhancement || !this.structuredPromptGenerator) {
      if (shouldSkipEnhancement) {
        this.logger.info('mcp-server', 'Prompt enhancement skipped (SKIP_PROMPT_ENHANCEMENT=true)')
      }
      return params.prompt
    }

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
      inputImageData,
      params.purpose
    )

    if (!promptResult.success) {
      this.logger.warn('mcp-server', 'Using original prompt', {
        error: promptResult.error.message,
      })
      return params.prompt
    }

    this.logger.info('mcp-server', 'Structured prompt generated', {
      originalLength: params.prompt.length,
      structuredLength: promptResult.data.structuredPrompt.length,
      selectedPractices: promptResult.data.selectedPractices,
    })

    return promptResult.data.structuredPrompt
  }

  private async handleGenerateImage(params: GenerateImageParams) {
    const result = await ErrorHandler.wrapWithResultType(async () => {
      const validationResult = validateGenerateImageParams(params)
      if (!validationResult.success) {
        throw validationResult.error
      }

      const configResult = getConfig()
      if (!configResult.success) {
        throw configResult.error
      }

      const provider = params.provider || configResult.data.imageProvider
      if (provider === 'gemini') {
        await this.initializeGeminiSupport()
      } else {
        await this.initializeVolcengineSupport()
      }

      const { inputImageData, inputImageMimeType, inputImagesData } = await this.prepareInputImages(params)
      const prompt = await this.maybeEnhancePrompt(provider, params, inputImageData)
      const client = this.getProviderClient(provider)

      const generationResult = await client.generateImage({
        ...params,
        provider,
        prompt,
        ...(inputImagesData && { inputImages: inputImagesData }),
        ...(!inputImagesData && inputImageData && { inputImage: inputImageData }),
        ...(!inputImagesData && inputImageMimeType && { inputImageMimeType }),
      })

      if (!generationResult.success) {
        throw generationResult.error
      }

      const saveTargets = generationResult.data.images?.length
        ? generationResult.data.images
        : [{ imageData: generationResult.data.imageData, mimeType: generationResult.data.metadata.mimeType }]

      const savedPaths: string[] = []
      for (let index = 0; index < saveTargets.length; index++) {
        const target = saveTargets[index]
        if (!target) {
          continue
        }
        let currentFileName = params.fileName || this.fileManager.generateFileName()
        if (params.fileName) {
          const ext = path.extname(currentFileName)
          const baseName = ext ? currentFileName.slice(0, -ext.length) : currentFileName
          const finalExt = ext || ({
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/webp': '.webp',
            'image/gif': '.gif',
            'image/bmp': '.bmp',
          }[target.mimeType] || '.png')
          currentFileName = saveTargets.length > 1 ? `${baseName}-${index + 1}${finalExt}` : `${baseName}${finalExt}`
        } else if (saveTargets.length > 1) {
          const ext = path.extname(currentFileName)
          const baseName = currentFileName.slice(0, -ext.length)
          currentFileName = `${baseName}-${index + 1}${ext}`
        }

        const outputPath = path.join(configResult.data.imageOutputDir, currentFileName)
        const sanitizedPath = this.securityManager.sanitizeFilePath(outputPath)
        if (!sanitizedPath.success) {
          throw sanitizedPath.error
        }

        const saveResult = await this.fileManager.saveImage(target.imageData, sanitizedPath.data)
        if (!saveResult.success) {
          throw saveResult.error
        }
        savedPaths.push(saveResult.data)
      }

      if (params.returnBase64) {
        const base64Data = generationResult.data.imageData.toString('base64')
        return this.responseBuilder.buildBase64SuccessResponse(
          generationResult.data,
          savedPaths[0]!,
          base64Data
        )
      }
      return savedPaths.length > 1
        ? this.responseBuilder.buildMultiSuccessResponse(generationResult.data, savedPaths)
        : this.responseBuilder.buildSuccessResponse(generationResult.data, savedPaths[0]!)
    }, 'image-generation')

    if (result.ok) {
      return result.value
    }

    return this.responseBuilder.buildErrorResponse(result.error)
  }

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

    this.setupHandlers()

    return this.server
  }

  private setupHandlers(): void {
    if (!this.server) {
      throw new Error('Server not initialized')
    }

    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      return this.getToolsList()
    })

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

export function createMCPServer(config: Partial<MCPServerConfig> = {}) {
  return new MCPServerImpl(config)
}
