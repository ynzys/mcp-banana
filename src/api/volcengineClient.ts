/**
 * Volcengine Ark image client for Seedream generation
 */

import type { GenerateImageParams } from '../types/mcp.js'
import { Err, Ok } from '../types/result.js'
import type { Result } from '../types/result.js'
import type { Config } from '../utils/config.js'
import { NetworkError, VolcengineAPIError } from '../utils/errors.js'
import { applyProxyFetch } from '../utils/proxyFetch.js'
import type { GeneratedImageMetadata, GeneratedImageResult, ImageProviderClient } from './imageProvider.js'
import { VOLCENGINE_MODELS as MODELS } from '../types/mcp.js'

interface ErrorWithCode extends Error {
  code?: string
}

interface VolcengineResponseDataItem {
  url?: string
  b64_json?: string
}

interface VolcengineSuccessResponse {
  created?: number
  data?: VolcengineResponseDataItem[]
}

interface VolcengineErrorResponse {
  error?: {
    message?: string
    code?: string | number
    type?: string
  }
}

function mapImageSizeToVolcengineSize(imageSize?: string, aspectRatio?: string): string | undefined {
  if (!imageSize && !aspectRatio) {
    return undefined
  }

  const sizeMap: Record<string, string> = {
    '1K': '1024x1024',
    '2K': '2048x2048',
    '4K': '4096x4096',
  }

  const aspectMap: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1152x864',
    '3:4': '864x1152',
    '21:9': '1536x640',
    '2:3': '832x1248',
    '3:2': '1248x832',
    '4:5': '960x1200',
    '5:4': '1200x960',
    '1:4': '512x2048',
    '1:8': '512x4096',
    '4:1': '2048x512',
    '8:1': '4096x512',
  }

  if (imageSize) {
    if (aspectRatio && aspectRatio !== '1:1') {
      return aspectMap[aspectRatio]
    }
    return sizeMap[imageSize] || sizeMap['1K']
  }

  return aspectRatio ? aspectMap[aspectRatio] : undefined
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
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeout: number,
    private readonly model: string
  ) {}

  async generateImage(
    params: GenerateImageParams
  ): Promise<Result<GeneratedImageResult, VolcengineAPIError | NetworkError>> {
    try {
      await applyProxyFetch()

      const imageInput =
        params.inputImages?.map((image) => image.data) ||
        (params.inputImage ? params.inputImage.replace(/^data:image\/[a-z]+;base64,/, '') : undefined)

      const size = mapImageSizeToVolcengineSize(params.imageSize, params.aspectRatio)
      const responseFormat = params.returnBase64 ? 'b64_json' : 'url'

      const requestBody: Record<string, unknown> = {
        model: this.model,
        prompt: params.prompt,
        output_format: params.outputFormat || 'png',
        watermark: false,
        ...(params.returnBase64 && { response_format: responseFormat }),
        ...(size && { size }),
      }

      if (imageInput) {
        requestBody['image'] = Array.isArray(imageInput) && imageInput.length === 1 ? imageInput[0] : imageInput
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeout)

      let response: Response
      try {
        response = await fetch(`${this.baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      const rawText = await response.text()
      const parsed = rawText ? (JSON.parse(rawText) as VolcengineSuccessResponse & VolcengineErrorResponse) : {}

      if (!response.ok) {
        const errorMessage = parsed.error?.message || `Volcengine API request failed with HTTP ${response.status}`
        return Err(
          new VolcengineAPIError(errorMessage, {
            status: response.status,
            code: parsed.error?.code,
            type: parsed.error?.type,
            stage: 'api_error',
          })
        )
      }

      const firstItem = parsed.data?.[0]
      if (!firstItem) {
        return Err(
          new VolcengineAPIError('Volcengine API returned no image data', {
            stage: 'response_validation',
            suggestion: 'Check whether the selected model is available for your account',
          })
        )
      }

      let imageBuffer: Buffer
      if (firstItem.b64_json) {
        imageBuffer = Buffer.from(firstItem.b64_json, 'base64')
      } else if (firstItem.url) {
        imageBuffer = await fetchImageAsBuffer(firstItem.url, this.timeout)
      } else {
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
        mimeType: 'image/png',
        timestamp: new Date(),
        inputImageProvided: !!params.inputImage || !!params.inputImages?.length,
      }

      return Ok({
        imageData: imageBuffer,
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

    return Ok(
      new VolcengineClientImpl(
        config.volcengineApiKey,
        config.volcengineApiBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
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
