/**
 * Shared image provider types and interfaces
 */

import type { GenerateImageParams, ImageProvider } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import type { BaseError } from '../utils/errors.js'

export interface GeneratedImageMetadata {
  provider: ImageProvider
  model: string
  prompt: string
  mimeType: string
  timestamp: Date
  inputImageProvided: boolean
  responseId?: string
  modelVersion?: string
}

export interface GeneratedImageVariant {
  imageData: Buffer
  mimeType: string
}

export interface GeneratedImageResult {
  imageData: Buffer
  metadata: GeneratedImageMetadata
  images?: GeneratedImageVariant[]
}

export interface ImageProviderClient {
  generateImage(params: GenerateImageParams): Promise<Result<GeneratedImageResult, BaseError>>
}
