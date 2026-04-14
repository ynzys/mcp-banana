/**
 * Test suite for ResponseBuilder
 * Tests structured content response generation for both success and error cases
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import type { GeneratedImageResult } from '../../api/imageProvider'
import {
  FileOperationError,
  GeminiAPIError,
  InputValidationError,
  NetworkError,
} from '../../utils/errors'
import { createResponseBuilder, type ResponseBuilder } from '../responseBuilder'

function toExpectedUri(filePath: string) {
  return pathToFileURL(filePath).toString()
}

describe('ResponseBuilder', () => {
  let responseBuilder: ResponseBuilder

  beforeEach(() => {
    responseBuilder = createResponseBuilder()
  })

  describe('buildSuccessResponse', () => {
    it('should create file URI structured content response when filePath is provided', () => {
      const testImageData = Buffer.from('fake-image-data')
      const generationResult: GeneratedImageResult = {
        imageData: testImageData,
        metadata: {
          model: 'gemini-3.1-flash-image-preview',
          prompt: 'test prompt',
          mimeType: 'image/png',
          timestamp: new Date('2025-08-28T12:00:00Z'),
          inputImageProvided: false,
        },
      }
      const testFilePath = '/path/to/generated-image.png'

      const response = responseBuilder.buildSuccessResponse(generationResult, testFilePath)

      expect(response.isError).toBe(false)
      expect(response.content).toHaveLength(1)
      expect(response.content[0]).toEqual({
        type: 'resource_link',
        uri: toExpectedUri(testFilePath),
        name: 'generated-image.png',
        title: 'generated-image.png',
        mimeType: 'image/png',
        description: 'Generated image',
      })
      expect(response.structuredContent).toEqual({
        type: 'image_result',
        files: [
          {
            uri: toExpectedUri(testFilePath),
            name: 'generated-image.png',
            title: 'generated-image.png',
            mimeType: 'image/png',
            description: 'Generated image',
          },
        ],
        metadata: {
          model: generationResult.metadata.model,
          processingTime: 0,
          contextMethod: 'structured_prompt',
          timestamp: generationResult.metadata.timestamp.toISOString(),
          imageCount: 1,
        },
      })
    })

    it('should handle different file extensions for MIME type detection', () => {
      const testImageData = Buffer.from('fake-image-data')
      const generationResult: GeneratedImageResult = {
        imageData: testImageData,
        metadata: {
          model: 'gemini-3.1-flash-image-preview',
          prompt: 'test prompt',
          mimeType: 'image/png',
          timestamp: new Date('2025-08-28T12:00:00Z'),
          inputImageProvided: false,
        },
      }

      // Test JPEG file
      let response = responseBuilder.buildSuccessResponse(generationResult, '/path/to/image.jpg')
      expect(response.content[0]).toMatchObject({
        type: 'resource_link',
        mimeType: 'image/jpeg',
        uri: toExpectedUri('/path/to/image.jpg'),
      })

      // Test WEBP file
      response = responseBuilder.buildSuccessResponse(generationResult, '/path/to/image.webp')
      expect(response.content[0]).toMatchObject({
        type: 'resource_link',
        mimeType: 'image/webp',
        uri: toExpectedUri('/path/to/image.webp'),
      })

      // Test unknown extension (defaults to PNG)
      response = responseBuilder.buildSuccessResponse(generationResult, '/path/to/image.unknown')
      expect(response.content[0]).toMatchObject({
        type: 'resource_link',
        mimeType: 'image/png',
        uri: toExpectedUri('/path/to/image.unknown'),
      })
    })

    it('should create standard multi-image resource links for multiple outputs', () => {
      const generationResult: GeneratedImageResult = {
        imageData: Buffer.from('fake-image-data-1'),
        images: [
          { imageData: Buffer.from('fake-image-data-1'), mimeType: 'image/png' },
          { imageData: Buffer.from('fake-image-data-2'), mimeType: 'image/png' },
        ],
        metadata: {
          model: 'doubao-seedream-4-5-251128',
          prompt: 'test prompt',
          mimeType: 'image/png',
          timestamp: new Date('2025-08-28T12:00:00Z'),
          inputImageProvided: false,
          provider: 'volcengine',
        },
      }

      const response = responseBuilder.buildMultiSuccessResponse(generationResult, [
        '/path/to/image-1.png',
        '/path/to/image-2.png',
      ])

      expect(response.isError).toBe(false)
      expect(response.content).toEqual([
        {
          type: 'resource_link',
          uri: toExpectedUri('/path/to/image-1.png'),
          name: 'image-1.png',
          title: 'image-1.png',
          mimeType: 'image/png',
          description: 'Generated image 1',
        },
        {
          type: 'resource_link',
          uri: toExpectedUri('/path/to/image-2.png'),
          name: 'image-2.png',
          title: 'image-2.png',
          mimeType: 'image/png',
          description: 'Generated image 2',
        },
      ])
      expect(response.structuredContent).toMatchObject({
        type: 'image_result',
        metadata: {
          model: generationResult.metadata.model,
          imageCount: 2,
        },
      })
    })

    it('should create standard image blocks when base64 output is requested', () => {
      const generationResult: GeneratedImageResult = {
        imageData: Buffer.from('fake-image-data-1'),
        images: [
          { imageData: Buffer.from('fake-image-data-1'), mimeType: 'image/png' },
          { imageData: Buffer.from('fake-image-data-2'), mimeType: 'image/png' },
        ],
        metadata: {
          model: 'doubao-seedream-4-5-251128',
          prompt: 'test prompt',
          mimeType: 'image/png',
          timestamp: new Date('2025-08-28T12:00:00Z'),
          inputImageProvided: false,
          provider: 'volcengine',
        },
      }

      const response = responseBuilder.buildBase64SuccessResponse(generationResult, [
        '/path/to/image-1.png',
        '/path/to/image-2.png',
      ])

      expect(response.isError).toBe(false)
      expect(response.content.slice(0, 2)).toEqual([
        {
          type: 'image',
          data: Buffer.from('fake-image-data-1').toString('base64'),
          mimeType: 'image/png',
        },
        {
          type: 'image',
          data: Buffer.from('fake-image-data-2').toString('base64'),
          mimeType: 'image/png',
        },
      ])
      expect(response.content.slice(2)).toEqual([
        {
          type: 'resource_link',
          uri: toExpectedUri('/path/to/image-1.png'),
          name: 'image-1.png',
          title: 'image-1.png',
          mimeType: 'image/png',
          description: 'Generated image 1',
        },
        {
          type: 'resource_link',
          uri: toExpectedUri('/path/to/image-2.png'),
          name: 'image-2.png',
          title: 'image-2.png',
          mimeType: 'image/png',
          description: 'Generated image 2',
        },
      ])
      expect(response.structuredContent).toMatchObject({
        type: 'image_result',
        base64Included: true,
        metadata: {
          imageCount: 2,
        },
      })
    })
  })

  describe('buildErrorResponse', () => {
    it('should create error response for InputValidationError', () => {
      const error = new InputValidationError(
        'Invalid prompt provided',
        'Please provide a non-empty prompt'
      )

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      expect(response.content).toHaveLength(1)
      expect(response.content[0].type).toBe('text')

      const errorData = JSON.parse(response.content[0].text)
      expect(errorData.error.code).toBe('INPUT_VALIDATION_ERROR')
      expect(errorData.error.message).toBe('Invalid prompt provided')
      expect(errorData.error.suggestion).toBe('Please provide a non-empty prompt')
    })

    it('should create error response for FileOperationError', () => {
      const error = new FileOperationError('Failed to save image file')

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0].text)
      expect(errorData.error.code).toBe('FILE_OPERATION_ERROR')
      expect(errorData.error.message).toBe('Failed to save image file')
      expect(errorData.error.suggestion).toBe(
        'Check file system permissions and available disk space'
      )
    })

    it('should create error response for GeminiAPIError', () => {
      const error = new GeminiAPIError(
        'API quota exceeded',
        'Please try again later or upgrade your API quota'
      )

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0].text)
      expect(errorData.error.code).toBe('GEMINI_API_ERROR')
      expect(errorData.error.message).toBe('API quota exceeded')
      expect(errorData.error.suggestion).toBe('Please try again later or upgrade your API quota')
    })

    it('should create error response for NetworkError', () => {
      const error = new NetworkError(
        'Network connection failed',
        'Please check your internet connection and try again'
      )

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0].text)
      expect(errorData.error.code).toBe('NETWORK_ERROR')
      expect(errorData.error.message).toBe('Network connection failed')
      expect(errorData.error.suggestion).toBe('Please check your internet connection and try again')
    })

    it('should handle unknown errors gracefully', () => {
      const error = new Error('Unknown error') as any

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0].text)
      expect(errorData.error.code).toBe('UNKNOWN_ERROR')
      expect(errorData.error.message).toContain('Unknown error')
    })
  })
})
