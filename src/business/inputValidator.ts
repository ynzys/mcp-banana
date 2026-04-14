/**
 * Input validation module for MCP server
 * Validates user inputs according to Gemini API and business requirements
 */

import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import type { AspectRatio, GenerateImageParams, ImageProvider, ImageOutputFormat } from '../types/mcp.js'
import { IMAGE_OUTPUT_FORMAT_VALUES, IMAGE_PROVIDER_VALUES, IMAGE_QUALITY_VALUES } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { InputValidationError } from '../utils/errors.js'

// Constants for validation limits
const PROMPT_MIN_LENGTH = 1
const PROMPT_MAX_LENGTH = 4000
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB in bytes
const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']
const SUPPORTED_ASPECT_RATIOS: readonly AspectRatio[] = [
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
] as const

const SUPPORTED_QUALITY_VALUES = IMAGE_QUALITY_VALUES

/**
 * Converts bytes to MB with proper formatting
 */
function formatFileSize(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/**
 * Validates prompt text for length constraints
 */
export function validatePrompt(prompt: string): Result<string, InputValidationError> {
  if (prompt.length < PROMPT_MIN_LENGTH || prompt.length > PROMPT_MAX_LENGTH) {
    return Err(
      new InputValidationError(
        `Prompt must be between ${PROMPT_MIN_LENGTH} and ${PROMPT_MAX_LENGTH} characters. Current length: ${prompt.length}`,
        prompt.length === 0
          ? 'Please provide a descriptive prompt for image generation.'
          : `Please shorten your prompt by ${prompt.length - PROMPT_MAX_LENGTH} characters.`
      )
    )
  }

  return Ok(prompt)
}

/**
 * Validates base64 encoded image data
 * @param imageData - Base64 encoded image string
 * @param mimeType - MIME type of the image
 * @returns Result with validated Buffer or error
 */
export function validateBase64Image(
  imageData?: string,
  mimeType?: string
): Result<Buffer | undefined, InputValidationError> {
  // If no image data provided, it's valid (optional parameter)
  if (!imageData) {
    return Ok(undefined)
  }

  // Validate MIME type if provided
  if (mimeType && !SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return Err(
      new InputValidationError(
        `Unsupported MIME type: ${mimeType}. Supported types: ${SUPPORTED_MIME_TYPES.join(', ')}`,
        `Please provide an image with one of these MIME types: ${SUPPORTED_MIME_TYPES.join(', ')}`
      )
    )
  }

  // Check if it's valid base64
  // Remove data URI prefix if present
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
  const cleanedData = imageData.replace(/^data:image\/[a-z]+;base64,/, '')

  if (!base64Regex.test(cleanedData)) {
    return Err(
      new InputValidationError(
        'Invalid base64 format',
        'Please provide a valid base64 encoded image string'
      )
    )
  }

  // Decode and check size
  let buffer: Buffer
  try {
    buffer = Buffer.from(cleanedData, 'base64')

    if (buffer.length > MAX_IMAGE_SIZE) {
      const sizeInMB = formatFileSize(buffer.length)
      const limitInMB = formatFileSize(MAX_IMAGE_SIZE)
      return Err(
        new InputValidationError(
          `Image size exceeds ${limitInMB}MB limit. Current size: ${sizeInMB}MB`,
          `Please compress your image or reduce its resolution to stay below ${limitInMB}MB`
        )
      )
    }
  } catch (_error) {
    return Err(
      new InputValidationError(
        'Failed to decode base64 image',
        'Please ensure the image is properly base64 encoded'
      )
    )
  }

  return Ok(buffer)
}

/**
 * Validates an array of base64 encoded images
 * @param images - Array of image objects with data and mimeType
 * @returns Result with success or error
 */
export function validateBase64Images(
  images: Array<{ data: string; mimeType: string }>
): Result<void, InputValidationError> {
  if (images.length === 0) {
    return Err(
      new InputValidationError(
        'inputImages array must not be empty',
        'Provide at least one image in the inputImages array'
      )
    )
  }

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    if (!img) continue
    const result = validateBase64Image(img.data, img.mimeType)
    if (!result.success) {
      return Err(
        new InputValidationError(
          `inputImages[${i}]: ${result.error.message}`,
          result.error.suggestion
        )
      )
    }
  }

  return Ok(undefined)
}

/**
 * Validates an array of input image paths
 * @param paths - Array of image file paths
 * @returns Result with success or error
 */
export function validateImagePaths(
  paths: string[]
): Result<void, InputValidationError> {
  if (paths.length === 0) {
    return Err(
      new InputValidationError(
        'inputImagePaths array must not be empty',
        'Provide at least one file path in the inputImagePaths array'
      )
    )
  }

  for (let i = 0; i < paths.length; i++) {
    const result = validateImagePath(paths[i])
    if (!result.success) {
      return Err(
        new InputValidationError(
          `inputImagePaths[${i}]: ${result.error.message}`,
          result.error.suggestion
        )
      )
    }
  }

  return Ok(undefined)
}

/**
 * Validates input image path
 * @param imagePath - Path to the input image file
 * @returns Result with validated path or error
 */
export function validateImagePath(
  imagePath?: string
): Result<string | undefined, InputValidationError> {
  // If no path provided, it's valid (optional parameter)
  if (!imagePath) {
    return Ok(undefined)
  }

  // Check if file exists
  if (!existsSync(imagePath)) {
    return Err(
      new InputValidationError(
        `Input image file not found: ${imagePath}`,
        'Please provide a valid absolute path to an existing image file'
      )
    )
  }

  // Check file extension
  const ext = extname(imagePath).toLowerCase()
  const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
  if (!supportedExtensions.includes(ext)) {
    return Err(
      new InputValidationError(
        `Unsupported image format: ${ext}. Supported formats: ${supportedExtensions.join(', ')}`,
        `Please provide an image with one of these extensions: ${supportedExtensions.join(', ')}`
      )
    )
  }

  return Ok(imagePath)
}

function validateOutputFormat(
  outputFormat?: ImageOutputFormat
): Result<ImageOutputFormat | undefined, InputValidationError> {
  if (!outputFormat) {
    return Ok(undefined)
  }

  if (!IMAGE_OUTPUT_FORMAT_VALUES.includes(outputFormat)) {
    return Err(
      new InputValidationError(
        `Invalid outputFormat: ${outputFormat}. Supported values: ${IMAGE_OUTPUT_FORMAT_VALUES.join(', ')}`,
        `Please use one of the supported output formats: ${IMAGE_OUTPUT_FORMAT_VALUES.join(', ')}`
      )
    )
  }

  return Ok(outputFormat)
}

function validateProvider(provider?: ImageProvider): Result<ImageProvider | undefined, InputValidationError> {
  if (!provider) {
    return Ok(undefined)
  }

  if (!IMAGE_PROVIDER_VALUES.includes(provider)) {
    return Err(
      new InputValidationError(
        `Invalid provider: ${provider}. Supported values: ${IMAGE_PROVIDER_VALUES.join(', ')}`,
        `Please use one of the supported providers: ${IMAGE_PROVIDER_VALUES.join(', ')}`
      )
    )
  }

  return Ok(provider)
}

function validateOutputCount(outputCount?: number): Result<number | undefined, InputValidationError> {
  if (outputCount === undefined) {
    return Ok(undefined)
  }

  if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 15) {
    return Err(
      new InputValidationError(
        `Invalid outputCount: ${outputCount}. Supported range: 1-15`,
        'Please use an integer outputCount between 1 and 15'
      )
    )
  }

  return Ok(outputCount)
}

function validateImageRequests(
  imageRequests?: string[]
): Result<string[] | undefined, InputValidationError> {
  if (imageRequests === undefined) {
    return Ok(undefined)
  }

  if (!Array.isArray(imageRequests) || imageRequests.length === 0) {
    return Err(
      new InputValidationError(
        'imageRequests must be a non-empty string array',
        'Provide imageRequests as an array of per-image prompt strings.'
      )
    )
  }

  const normalizedRequests: string[] = []
  for (const request of imageRequests) {
    if (typeof request !== 'string') {
      return Err(
        new InputValidationError(
          'Each imageRequests item must be a string',
          'Ensure every imageRequests entry is a text prompt.'
        )
      )
    }

    const promptResult = validatePrompt(request.trim())
    if (!promptResult.success) {
      return Err(
        new InputValidationError(
          `Invalid imageRequests item: ${promptResult.error.message}`,
          'Ensure every imageRequests entry is a non-empty prompt shorter than 4000 characters.'
        )
      )
    }

    normalizedRequests.push(promptResult.data)
  }

  return Ok(normalizedRequests)
}

/**
 * Validates complete GenerateImageParams object
 */
export function validateGenerateImageParams(
  params: GenerateImageParams
): Result<GenerateImageParams, InputValidationError> {
  const providerResult = validateProvider(params.provider)
  if (!providerResult.success) {
    return Err(providerResult.error)
  }

  const outputFormatResult = validateOutputFormat(params.outputFormat)
  if (!outputFormatResult.success) {
    return Err(outputFormatResult.error)
  }

  const outputCountResult = validateOutputCount(params.outputCount)
  if (!outputCountResult.success) {
    return Err(outputCountResult.error)
  }

  const imageRequestsResult = validateImageRequests(params.imageRequests)
  if (!imageRequestsResult.success) {
    return Err(imageRequestsResult.error)
  }

  // Validate prompt
  const promptResult = validatePrompt(params.prompt)
  if (!promptResult.success) {
    return Err(promptResult.error)
  }

  if (
    imageRequestsResult.data &&
    outputCountResult.data !== undefined &&
    outputCountResult.data !== imageRequestsResult.data.length
  ) {
    return Err(
      new InputValidationError(
        `outputCount (${outputCountResult.data}) must match imageRequests length (${imageRequestsResult.data.length})`,
        'Keep outputCount aligned with imageRequests length, or omit outputCount and let the server infer it.'
      )
    )
  }

  // Validate input image path if provided
  const imagePathResult = validateImagePath(params.inputImagePath)
  if (!imagePathResult.success) {
    return Err(imagePathResult.error)
  }

  // Validate blendImages parameter
  if (params.blendImages !== undefined && typeof params.blendImages !== 'boolean') {
    return Err(
      new InputValidationError(
        'blendImages must be a boolean value',
        'Use true or false for blendImages parameter to enable/disable multi-image blending'
      )
    )
  }

  // Validate maintainCharacterConsistency parameter
  if (
    params.maintainCharacterConsistency !== undefined &&
    typeof params.maintainCharacterConsistency !== 'boolean'
  ) {
    return Err(
      new InputValidationError(
        'maintainCharacterConsistency must be a boolean value',
        'Use true or false for maintainCharacterConsistency parameter to enable/disable character consistency'
      )
    )
  }

  // Validate useWorldKnowledge parameter
  if (params.useWorldKnowledge !== undefined && typeof params.useWorldKnowledge !== 'boolean') {
    return Err(
      new InputValidationError(
        'useWorldKnowledge must be a boolean value',
        'Use true or false for useWorldKnowledge parameter to enable/disable world knowledge integration'
      )
    )
  }

  // Validate mutual exclusivity of image input methods
  const imageInputCount = [
    params.inputImagePath,
    params.inputImage,
    params.inputImages,
    params.inputImagePaths,
  ].filter(Boolean).length
  if (imageInputCount > 1) {
    return Err(
      new InputValidationError(
        'Only one image input method can be used at a time: inputImagePath, inputImage, inputImages, or inputImagePaths',
        'Choose one: inputImagePath (single file), inputImage (single base64), inputImagePaths (multiple files), or inputImages (multiple base64)'
      )
    )
  }

  // Validate inputImages array if provided
  if (params.inputImages) {
    const imagesResult = validateBase64Images(params.inputImages)
    if (!imagesResult.success) {
      return Err(imagesResult.error)
    }
  }

  // Validate inputImagePaths array if provided
  if (params.inputImagePaths) {
    const pathsResult = validateImagePaths(params.inputImagePaths)
    if (!pathsResult.success) {
      return Err(pathsResult.error)
    }
  }

  // Validate input image data if provided
  if (params.inputImage || params.inputImageMimeType) {
    const imageResult = validateBase64Image(params.inputImage, params.inputImageMimeType)
    if (!imageResult.success) {
      return Err(imageResult.error)
    }
  }

  // Validate aspectRatio parameter
  if (params.aspectRatio && !SUPPORTED_ASPECT_RATIOS.includes(params.aspectRatio)) {
    return Err(
      new InputValidationError(
        `Invalid aspect ratio: ${params.aspectRatio}. Supported values: ${SUPPORTED_ASPECT_RATIOS.join(', ')}`,
        `Please use one of the supported aspect ratios: ${SUPPORTED_ASPECT_RATIOS.join(', ')}`
      )
    )
  }

  // Validate quality parameter
  if (params.quality !== undefined && !SUPPORTED_QUALITY_VALUES.includes(params.quality)) {
    return Err(
      new InputValidationError(
        `Invalid quality value: "${params.quality}". Supported values: ${SUPPORTED_QUALITY_VALUES.join(', ')}`,
        `Please use one of the supported quality values: ${SUPPORTED_QUALITY_VALUES.join(', ')}`
      )
    )
  }

  return Ok(params)
}
