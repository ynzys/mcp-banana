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
import { applyProxyFetch } from '../utils/proxyFetch.js'
import type { GeneratedImageMetadata, GeneratedImageResult, ImageProviderClient } from './imageProvider.js'

interface ErrorWithCode extends Error {
  code?: string
  status?: number
}

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

const MIN_GROUP_IMAGE_PIXELS = 3686400
const DIMENSION_ALIGNMENT = 64

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

function alignDimension(value: number): number {
  return Math.ceil(value / DIMENSION_ALIGNMENT) * DIMENSION_ALIGNMENT
}

function mapImageSizeToVolcengineSize(
  imageSize?: string,
  aspectRatio?: string,
  outputCount?: number
): string | undefined {
  if (!imageSize && !aspectRatio) {
    return undefined
  }

  const baseSizeMap: Record<string, number> = {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
  }

  const { width: ratioWidth, height: ratioHeight } = parseAspectRatio(aspectRatio)
  const targetEdge = imageSize ? (baseSizeMap[imageSize] ?? baseSizeMap['1K']!) : 1024
  const isLandscape = ratioWidth >= ratioHeight

  let widthValue = isLandscape ? targetEdge : Math.round((targetEdge * ratioWidth) / ratioHeight)
  let heightValue = isLandscape ? Math.round((targetEdge * ratioHeight) / ratioWidth) : targetEdge

  if (outputCount && outputCount > 1) {
    const pixels = widthValue * heightValue
    if (pixels < MIN_GROUP_IMAGE_PIXELS) {
      const scale = Math.sqrt(MIN_GROUP_IMAGE_PIXELS / pixels)
      widthValue = Math.round(widthValue * scale)
      heightValue = Math.round(heightValue * scale)
    }
  }

  widthValue = alignDimension(widthValue)
  heightValue = alignDimension(heightValue)

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

      const referenceImages =
        params.inputImages?.map((image) => image.data) ||
        (params.inputImage ? [params.inputImage.replace(/^data:image\/[a-z]+;base64,/, '')] : undefined)
      const size = mapImageSizeToVolcengineSize(
        params.imageSize,
        params.aspectRatio,
        params.outputCount
      )

      const responseFormat: 'b64_json' | 'url' = params.returnBase64 ? 'b64_json' : 'url'

      const extraBody: Record<string, unknown> = {
        watermark: false,
        ...(params.outputCount && params.outputCount > 1 && { sequential_image_generation: 'auto' }),
        ...(params.outputCount && params.outputCount > 1 && {
          sequential_image_generation_options: { max_images: params.outputCount },
        }),
        ...(referenceImages && { image: referenceImages }),
      }

      const request: Record<string, unknown> = {
        model: this.model,
        prompt: params.prompt,
        ...(size && { size }),
        response_format: responseFormat,
        ...(params.outputFormat && { output_format: params.outputFormat }),
        extra_body: extraBody,
      }

      const response = (await this.client.images.generate(
        request as never
      )) as OpenAICompatibleImagesResponse
      const items = response.data || []
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

      if (!images || images.length === 0) {
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
