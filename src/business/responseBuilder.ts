/**
 * Response Builder for MCP structured content responses
 * Converts generation results and errors into MCP-compatible response format
 */

import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GeneratedImageResult } from '../api/imageProvider.js'
import type { McpToolResponse, StructuredContent, StructuredContentFile } from '../types/mcp.js'
import {
  type BaseError,
  ConfigError,
  FileOperationError,
  GeminiAPIError,
  InputValidationError,
  NetworkError,
  SecurityError,
  VolcengineAPIError,
} from '../utils/errors.js'

// Constants for MIME types and error handling
const MIME_TYPES = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  WEBP: 'image/webp',
} as const

const FILE_EXTENSIONS = {
  PNG: ['.png'],
  JPEG: ['.jpg', '.jpeg'],
  WEBP: ['.webp'],
} as const

const DEFAULT_MIME_TYPE = MIME_TYPES.PNG
const UNKNOWN_ERROR_CODE = 'UNKNOWN_ERROR'
const DEFAULT_ERROR_SUGGESTION = 'Please try again or contact support if the problem persists'

function toFileUri(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).toString()
}

function createMetadata(generationResult: GeneratedImageResult, imageCount: number) {
  return {
    model: generationResult.metadata.model,
    processingTime: 0,
    contextMethod: 'structured_prompt',
    timestamp: generationResult.metadata.timestamp.toISOString(),
    imageCount,
  }
}

function createFileDescriptor(filePath: string, index: number, total: number) {
  const fileName = path.basename(filePath)
  const ordinal = total > 1 ? ` ${index + 1}` : ''

  return {
    uri: toFileUri(filePath),
    name: fileName,
    title: fileName,
    mimeType: getMimeTypeFromPath(filePath),
    description: `Generated image${ordinal}`,
  }
}

function toResourceLinkContent(file: StructuredContentFile) {
  return {
    type: 'resource_link' as const,
    ...file,
  }
}

function createStructuredContent(
  generationResult: GeneratedImageResult,
  filePaths: string[],
  base64Included = false
): StructuredContent {
  return {
    type: 'image_result',
    files: filePaths.map((filePath, index) => createFileDescriptor(filePath, index, filePaths.length)),
    ...(base64Included ? { base64Included: true } : {}),
    metadata: createMetadata(generationResult, filePaths.length),
  }
}

function getGeneratedVariants(generationResult: GeneratedImageResult) {
  return generationResult.images?.length
    ? generationResult.images
    : [
        {
          imageData: generationResult.imageData,
          mimeType: generationResult.metadata.mimeType,
        },
      ]
}

/**
 * Interface for response builder functionality
 */
export interface ResponseBuilder {
  buildSuccessResponse(generationResult: GeneratedImageResult, filePath: string): McpToolResponse
  buildMultiSuccessResponse(
    generationResult: GeneratedImageResult,
    filePaths: string[]
  ): McpToolResponse
  buildBase64SuccessResponse(
    generationResult: GeneratedImageResult,
    filePaths: string[]
  ): McpToolResponse
  buildErrorResponse(error: BaseError | Error): McpToolResponse
}

/**
 * Determines MIME type based on file extension
 * @param filePath Path to the image file
 * @returns MIME type string
 */
function getMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()

  if (FILE_EXTENSIONS.PNG.includes(ext as '.png')) {
    return MIME_TYPES.PNG
  }
  if (FILE_EXTENSIONS.JPEG.includes(ext as '.jpg' | '.jpeg')) {
    return MIME_TYPES.JPEG
  }
  if (FILE_EXTENSIONS.WEBP.includes(ext as '.webp')) {
    return MIME_TYPES.WEBP
  }

  return DEFAULT_MIME_TYPE
}

/**
 * Converts various error types to structured error format
 * @param error Error to convert
 * @returns Structured error object
 */
function convertErrorToStructured(error: BaseError | Error): {
  code: string
  message: string
  suggestion: string
  timestamp: string
} {
  const baseError = {
    timestamp: new Date().toISOString(),
  }

  if (
    error instanceof InputValidationError ||
    error instanceof FileOperationError ||
    error instanceof GeminiAPIError ||
    error instanceof VolcengineAPIError ||
    error instanceof NetworkError ||
    error instanceof ConfigError ||
    error instanceof SecurityError
  ) {
    return {
      ...baseError,
      code: error.code,
      message: error.message,
      suggestion: error.suggestion,
    }
  }

  // Handle unknown errors
  return {
    ...baseError,
    code: UNKNOWN_ERROR_CODE,
    message: error.message || 'An unknown error occurred',
    suggestion: DEFAULT_ERROR_SUGGESTION,
  }
}

/**
 * Creates a response builder with MCP structured content support
 * @returns ResponseBuilder implementation
 */
export function createResponseBuilder(): ResponseBuilder {
  return {
    /**
     * Builds a successful structured content response with file path
     * @param generationResult Result from image generation
     * @param filePath Absolute path to the saved image file (required)
     * @returns MCP tool response with structured content containing file path
     */
    buildSuccessResponse(
      generationResult: GeneratedImageResult,
      filePath: string
    ): McpToolResponse {
      const structuredContent = createStructuredContent(generationResult, [filePath])

      return {
        content: structuredContent.files.map((file) => toResourceLinkContent(file)),
        structuredContent,
        isError: false,
      }
    },

    buildMultiSuccessResponse(
      generationResult: GeneratedImageResult,
      filePaths: string[]
    ): McpToolResponse {
      const structuredContent = createStructuredContent(generationResult, filePaths)

      return {
        content: structuredContent.files.map((file) => toResourceLinkContent(file)),
        structuredContent,
        isError: false,
      }
    },

    /**
     * Builds a successful response that includes base64 image data alongside file path
     * @param generationResult Result from image generation
     * @param filePath Absolute path to the saved image file
     * @param base64Data Base64 encoded image data
     * @returns MCP tool response with both file URI and base64 data
     */
    buildBase64SuccessResponse(
      generationResult: GeneratedImageResult,
      filePaths: string[]
    ): McpToolResponse {
      const structuredContent = createStructuredContent(generationResult, filePaths, true)
      const imageContents = getGeneratedVariants(generationResult).map((variant) => ({
        type: 'image' as const,
        data: variant.imageData.toString('base64'),
        mimeType: variant.mimeType,
      }))

      return {
        content: [...imageContents, ...structuredContent.files.map((file) => toResourceLinkContent(file))],
        structuredContent,
        isError: false,
      }
    },

    /**
     * Builds an error response in structured content format
     * @param error Error that occurred during processing
     * @returns MCP tool response with structured error
     */
    buildErrorResponse(error: BaseError | Error): McpToolResponse {
      const structuredError = {
        error: convertErrorToStructured(error),
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredError),
          },
        ],
        isError: true,
      }
    },
  }
}
