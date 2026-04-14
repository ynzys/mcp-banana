/**
 * Volcengine Ark image client for Seedream generation via OpenAI-compatible SDK.
 */

import OpenAI from 'openai'
import type { GenerateImageParams } from '../types/mcp.js'
import { VOLCENGINE_MODELS as MODELS } from '../types/mcp.js'
import { Err, Ok } from '../types/result.js'
import type { Result } from '../types/result.js'
import type { Config } from '../utils/config.js'
import { NetworkError, VolcengineAPIError } from '../utils/errors.js'
import { Logger } from '../utils/logger.js'
import { applyProxyFetch } from '../utils/proxyFetch.js'
import type { GeneratedImageMetadata, GeneratedImageResult, ImageProviderClient } from './imageProvider.js'

interface ErrorWithCode extends Error {
  code?: string
  status?: number
}

const logger = new Logger()

interface VolcengineImageDataItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
  size?: string
}

interface OpenAICompatibleImagesResponse {
  created?: number
  data?: VolcengineImageDataItem[]
}

interface ImageDimensions {
  width: number
  height: number
}

const MIN_GROUP_IMAGE_PIXELS = 3686400
const MAX_IMAGE_PIXELS = 10404496
const MAX_DIMENSION = 4096
const DIMENSION_ALIGNMENT = 64
const DATA_URL_PREFIX_REGEX = /^data:image\/[a-z0-9.+-]+;base64,/i
const DEFAULT_VOLCENGINE_ASPECT_RATIO = '16:9'
const DEFAULT_VOLCENGINE_IMAGE_SIZE = '4K'

function parseAspectRatio(aspectRatio?: string): { width: number; height: number } {
  if (!aspectRatio) {
    return { width: 1, height: 1 }
  }

  const [width, height] = aspectRatio.split(':').map((value) => parseInt(value, 10))
  if (!width || !height) {
    return { width: 1, height: 1 }
  }

  return { width, height }
}

function alignDimensionUp(value: number): number {
  return Math.ceil(value / DIMENSION_ALIGNMENT) * DIMENSION_ALIGNMENT
}

function alignDimensionDown(value: number): number {
  return Math.max(DIMENSION_ALIGNMENT, Math.floor(value / DIMENSION_ALIGNMENT) * DIMENSION_ALIGNMENT)
}

function scaleToDimensionLimit(dimensions: ImageDimensions): ImageDimensions {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(dimensions.width, dimensions.height))
  return {
    width: dimensions.width * scale,
    height: dimensions.height * scale,
  }
}

function scaleToPixelRange(dimensions: ImageDimensions): ImageDimensions {
  let next = scaleToDimensionLimit(dimensions)
  let pixels = next.width * next.height

  if (pixels < MIN_GROUP_IMAGE_PIXELS) {
    const scaleUp = Math.sqrt(MIN_GROUP_IMAGE_PIXELS / pixels)
    next = scaleToDimensionLimit({
      width: next.width * scaleUp,
      height: next.height * scaleUp,
    })
  }

  pixels = next.width * next.height
  if (pixels > MAX_IMAGE_PIXELS) {
    const scaleDown = Math.sqrt(MAX_IMAGE_PIXELS / pixels)
    next = scaleToDimensionLimit({
      width: next.width * scaleDown,
      height: next.height * scaleDown,
    })
  }

  return next
}

function mapImageSizeToVolcengineSize(
  imageSize?: string,
  aspectRatio?: string,
  _outputCount?: number
): string | undefined {
  const baseSizeMap: Record<string, number> = {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
  }

  const effectiveAspectRatio = aspectRatio ?? DEFAULT_VOLCENGINE_ASPECT_RATIO
  const effectiveImageSize = imageSize ?? DEFAULT_VOLCENGINE_IMAGE_SIZE
  const { width: ratioWidth, height: ratioHeight } = parseAspectRatio(effectiveAspectRatio)
  const targetEdge = baseSizeMap[effectiveImageSize] ?? baseSizeMap[DEFAULT_VOLCENGINE_IMAGE_SIZE]!
  const isLandscape = ratioWidth >= ratioHeight

  let widthValue = isLandscape ? targetEdge : (targetEdge * ratioWidth) / ratioHeight
  let heightValue = isLandscape ? (targetEdge * ratioHeight) / ratioWidth : targetEdge

  const scaled = scaleToPixelRange({ width: widthValue, height: heightValue })
  widthValue = alignDimensionDown(scaled.width)
  heightValue = alignDimensionDown(scaled.height)

  while (widthValue * heightValue < MIN_GROUP_IMAGE_PIXELS) {
    const canGrowWidth = widthValue + DIMENSION_ALIGNMENT <= MAX_DIMENSION
    const canGrowHeight = heightValue + DIMENSION_ALIGNMENT <= MAX_DIMENSION
    if (!canGrowWidth && !canGrowHeight) {
      break
    }

    const widthProgress = widthValue / ratioWidth
    const heightProgress = heightValue / ratioHeight
    if ((widthProgress <= heightProgress && canGrowWidth) || !canGrowHeight) {
      widthValue += DIMENSION_ALIGNMENT
    } else {
      heightValue += DIMENSION_ALIGNMENT
    }

    while (widthValue * heightValue > MAX_IMAGE_PIXELS) {
      if (widthValue >= heightValue && widthValue > DIMENSION_ALIGNMENT) {
        widthValue -= DIMENSION_ALIGNMENT
      } else if (heightValue > DIMENSION_ALIGNMENT) {
        heightValue -= DIMENSION_ALIGNMENT
      } else {
        break
      }
    }
  }

  while (widthValue * heightValue > MAX_IMAGE_PIXELS) {
    if (widthValue >= heightValue && widthValue > DIMENSION_ALIGNMENT) {
      widthValue -= DIMENSION_ALIGNMENT
    } else if (heightValue > DIMENSION_ALIGNMENT) {
      heightValue -= DIMENSION_ALIGNMENT
    } else {
      break
    }
  }

  widthValue = alignDimensionUp(widthValue)
  heightValue = alignDimensionUp(heightValue)

  while (widthValue * heightValue > MAX_IMAGE_PIXELS) {
    if (widthValue >= heightValue && widthValue > DIMENSION_ALIGNMENT) {
      widthValue -= DIMENSION_ALIGNMENT
    } else if (heightValue > DIMENSION_ALIGNMENT) {
      heightValue -= DIMENSION_ALIGNMENT
    } else {
      break
    }
  }

  return `${widthValue}x${heightValue}`
}

async function fetchImageAsBuffer(url: string, timeout: number): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Failed to download generated image: HTTP ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } finally {
    clearTimeout(timer)
  }
}

function toVolcengineDataUrl(imageData: string, mimeType = 'image/jpeg'): string {
  if (DATA_URL_PREFIX_REGEX.test(imageData)) {
    return imageData
  }

  return `data:${mimeType};base64,${imageData.replace(DATA_URL_PREFIX_REGEX, '')}`
}

export interface VolcengineClient extends ImageProviderClient {
  generateImage(
    params: GenerateImageParams
  ): Promise<Result<GeneratedImageResult, VolcengineAPIError | NetworkError>>
}

class VolcengineClientImpl implements VolcengineClient {
  constructor(
    private readonly client: OpenAI,
    private readonly timeout: number,
    private readonly model: string
  ) {}

  async generateImage(
    params: GenerateImageParams
  ): Promise<Result<GeneratedImageResult, VolcengineAPIError | NetworkError>> {
    try {
      await applyProxyFetch()

      const imageValues =
        params.inputImages?.map((image) => toVolcengineDataUrl(image.data, image.mimeType)) ||
        (params.inputImage
          ? [toVolcengineDataUrl(params.inputImage, params.inputImageMimeType)]
          : undefined)
      const size = mapImageSizeToVolcengineSize(params.imageSize, params.aspectRatio, params.outputCount)
      const responseFormat: 'b64_json' | 'url' = params.returnBase64 ? 'b64_json' : 'url'

      const request: Record<string, unknown> = {
        model: this.model,
        prompt: params.prompt,
        ...(size && { size }),
        response_format: responseFormat,
        ...(params.outputFormat && { output_format: params.outputFormat }),
        ...(imageValues && { image: imageValues.length === 1 ? imageValues[0] : imageValues }),
        watermark: false,
        ...(params.outputCount && params.outputCount > 1 && {
          sequential_image_generation: 'auto',
          sequential_image_generation_options: { max_images: params.outputCount },
        }),
      }

      logger.info('volcengine-client', 'Prepared image request', {
        model: this.model,
        hasImageInput: Boolean(imageValues?.length),
        imageCount: imageValues?.length ?? 0,
        firstImageLength: imageValues?.[0]?.length ?? 0,
        size,
        responseFormat,
        outputCount: params.outputCount ?? 1,
      })

      const response = (await this.client.images.generate(request as never)) as OpenAICompatibleImagesResponse
      const items = response.data || []
      logger.info('volcengine-client', 'Received image response', {
        itemCount: items.length,
        itemSummaries: items.map((item, index) => ({
          index,
          hasUrl: Boolean(item.url),
          hasBase64: Boolean(item.b64_json),
          size: item.size,
        })),
        firstItemKeys: items[0] ? Object.keys(items[0]) : [],
      })
      const firstItem = items[0]
      if (!firstItem) {
        return Err(
          new VolcengineAPIError('Volcengine API returned no image data', {
            stage: 'response_validation',
            suggestion: 'Check whether the selected model and grouped generation settings are supported',
          })
        )
      }

      const images: GeneratedImageResult['images'] = []
      for (const item of items) {
        if (item.b64_json) {
          images.push({ imageData: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' })
          continue
        }
        if (item.url) {
          images.push({ imageData: await fetchImageAsBuffer(item.url, this.timeout), mimeType: 'image/png' })
        }
      }

      if (!images.length) {
        return Err(
          new VolcengineAPIError('Volcengine API response did not contain a usable image field', {
            stage: 'image_extraction',
            responseKeys: Object.keys(firstItem),
          })
        )
      }

      const metadata: GeneratedImageMetadata = {
        provider: 'volcengine',
        model: this.model,
        prompt: params.prompt,
        mimeType: images[0]?.mimeType || 'image/png',
        timestamp: new Date(),
        inputImageProvided: !!params.inputImage || !!params.inputImages?.length,
      }

      return Ok({
        imageData: images[0]!.imageData,
        images,
        metadata,
      })
    } catch (error) {
      return this.handleError(error)
    }
  }

  private handleError(
    error: unknown
  ): Result<never, VolcengineAPIError | NetworkError> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (this.isNetworkError(error)) {
      return Err(
        new NetworkError(`Network error during Volcengine image generation: ${errorMessage}`, {
          provider: 'volcengine',
        })
      )
    }

    return Err(
      new VolcengineAPIError(`Failed to generate image with Volcengine: ${errorMessage}`, {
        provider: 'volcengine',
        status: this.extractStatusCode(error),
      })
    )
  }

  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const networkErrorCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'AbortError']
      return networkErrorCodes.some(
        (code) => error.message.includes(code) || error.name === code || (error as ErrorWithCode).code === code
      )
    }
    return false
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'status' in error) {
      return typeof (error as ErrorWithCode).status === 'number'
        ? (error as ErrorWithCode).status
        : undefined
    }
    return undefined
  }
}

export function createVolcengineClient(
  config: Config
): Result<VolcengineClient, VolcengineAPIError> {
  try {
    if (!config.volcengineApiKey) {
      return Err(
        new VolcengineAPIError(
          'Failed to initialize Volcengine client: VOLCENGINE_API_KEY is missing',
          'Set VOLCENGINE_API_KEY to your Volcengine Ark API key'
        )
      )
    }

    const client = new OpenAI({
      apiKey: config.volcengineApiKey,
      baseURL: config.volcengineApiBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
      timeout: config.apiTimeout,
    })

    return Ok(
      new VolcengineClientImpl(
        client,
        config.apiTimeout,
        config.volcengineModel || MODELS.SEEDREAM_LITE
      )
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return Err(
      new VolcengineAPIError(
        `Failed to initialize Volcengine client: ${errorMessage}`,
        'Verify your VOLCENGINE_API_KEY and VOLCENGINE_API_BASE_URL configuration'
      )
    )
  }
}
