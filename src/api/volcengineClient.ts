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
const DIMENSION_ALIGNMENT = 64
const DATA_URL_PREFIX_REGEX = /^data:image\/[a-z0-9.+-]+;base64,/i
const JPEG_MARKERS_WITH_DIMENSIONS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

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

function normalizeDimensions(width: number, height: number): ImageDimensions | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  const MAX_DIMENSION = 4096
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const scaledWidth = Math.max(64, Math.round(width * scale))
  const scaledHeight = Math.max(64, Math.round(height * scale))

  return {
    width: alignDimension(scaledWidth),
    height: alignDimension(scaledHeight),
  }
}

function extractPngDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    return undefined
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function extractGifDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 10) {
    return undefined
  }

  const header = buffer.toString('ascii', 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return undefined
  }

  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  }
}

function extractBmpDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 26 || buffer.toString('ascii', 0, 2) !== 'BM') {
    return undefined
  }

  return {
    width: Math.abs(buffer.readInt32LE(18)),
    height: Math.abs(buffer.readInt32LE(22)),
  }
}

function extractWebpDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return undefined
  }

  const chunkType = buffer.toString('ascii', 12, 16)
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    }
  }

  if (chunkType === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }

  return undefined
}

function extractJpegDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return undefined
  }

  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    if (marker === undefined) {
      break
    }
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) {
      break
    }
    if (offset + 4 > buffer.length) {
      break
    }

    const segmentLength = buffer.readUInt16BE(offset + 2)
    if (JPEG_MARKERS_WITH_DIMENSIONS.has(marker) && offset + 9 < buffer.length) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      }
    }

    if (segmentLength < 2) {
      break
    }
    offset += 2 + segmentLength
  }

  return undefined
}

function extractImageDimensions(buffer: Buffer, mimeType?: string): ImageDimensions | undefined {
  const normalizedMimeType = mimeType?.toLowerCase()
  if (normalizedMimeType === 'image/png') {
    return extractPngDimensions(buffer)
  }
  if (normalizedMimeType === 'image/jpeg') {
    return extractJpegDimensions(buffer)
  }
  if (normalizedMimeType === 'image/webp') {
    return extractWebpDimensions(buffer)
  }
  if (normalizedMimeType === 'image/gif') {
    return extractGifDimensions(buffer)
  }
  if (normalizedMimeType === 'image/bmp') {
    return extractBmpDimensions(buffer)
  }

  return (
    extractPngDimensions(buffer) ||
    extractJpegDimensions(buffer) ||
    extractWebpDimensions(buffer) ||
    extractGifDimensions(buffer) ||
    extractBmpDimensions(buffer)
  )
}

function extractSourceDimensions(imageData: string, mimeType?: string): ImageDimensions | undefined {
  try {
    const buffer = Buffer.from(imageData.replace(DATA_URL_PREFIX_REGEX, ''), 'base64')
    return extractImageDimensions(buffer, mimeType)
  } catch {
    return undefined
  }
}

function mapImageSizeToVolcengineSize(
  imageSize?: string,
  aspectRatio?: string,
  outputCount?: number,
  sourceDimensions?: ImageDimensions
): string | undefined {
  if (!imageSize && !aspectRatio && !sourceDimensions) {
    return undefined
  }

  if (!imageSize && !aspectRatio && sourceDimensions) {
    const normalized = normalizeDimensions(sourceDimensions.width, sourceDimensions.height)
    return normalized ? `${normalized.width}x${normalized.height}` : undefined
  }

  const baseSizeMap: Record<string, number> = {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
  }

  const { width: ratioWidth, height: ratioHeight } = aspectRatio
    ? parseAspectRatio(aspectRatio)
    : (sourceDimensions ?? { width: 1, height: 1 })
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
      const sourceDimensions =
        !params.aspectRatio && !params.imageSize
          ? (params.inputImages?.[0]
              ? extractSourceDimensions(params.inputImages[0].data, params.inputImages[0].mimeType)
              : params.inputImage
                ? extractSourceDimensions(params.inputImage, params.inputImageMimeType)
                : undefined)
          : undefined
      const size = mapImageSizeToVolcengineSize(
        params.imageSize,
        params.aspectRatio,
        params.outputCount,
        sourceDimensions
      )
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
        sourceDimensions,
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
