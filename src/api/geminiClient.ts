/**
 * Gemini API client for image generation
 * Integrates with Google's Gemini AI API using the official SDK
 * Supports automatic URL Context processing and feature parameters
 */

import { GoogleGenAI } from '@google/genai'
import type { GeneratedImageMetadata, GeneratedImageResult, ImageProviderClient } from './imageProvider.js'
import { GEMINI_MODELS } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import type { Config } from '../utils/config.js'
import { GeminiAPIError, NetworkError } from '../utils/errors.js'
import { applyProxyFetch } from '../utils/proxyFetch.js'

/**
 * Simplified Gemini API response types
 */

interface ContentPart {
  inlineData?: {
    data: string
    mimeType: string
  }
  text?: string
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: ContentPart[]
    }
    finishReason?: string
  }>
  modelVersion?: string
  responseId?: string
  sdkHttpResponse?: unknown
  usageMetadata?: unknown
}

interface GeminiClientInstance {
  models: {
    generateContent(params: {
      model: string
      contents: unknown[] | string
      systemInstruction?: string
      generationConfig?: {
        [key: string]: unknown
      }
      config?: {
        imageConfig?: {
          aspectRatio?: string
          imageSize?: string
        }
        responseModalities?: string[]
        thinkingConfig?: {
          thinkingLevel?: string
        }
      }
      tools?: unknown[]
    }): Promise<unknown>
  }
}

function analyzeResponseStructure(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') {
    return { type: typeof obj, value: obj }
  }

  const seen = new WeakSet()

  const sanitize = (value: unknown, depth = 0): unknown => {
    if (depth > 3) return '[max depth]'

    if (value === null || value === undefined) return value
    if (typeof value !== 'object') {
      return typeof value === 'string' && value.length > 100
        ? `[string length: ${value.length}]`
        : value
    }

    if (seen.has(value)) return '[circular]'
    seen.add(value)

    if (Array.isArray(value)) {
      return value.slice(0, 3).map((v) => sanitize(v, depth + 1))
    }

    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(record)) {
      if (/apikey|token|secret|password|credential/i.test(key)) {
        result[key] = '[REDACTED]'
      } else if (key === 'data' && typeof val === 'string' && val.length > 100) {
        result[key] = `[base64 data, length: ${val.length}]`
      } else {
        result[key] = sanitize(val, depth + 1)
      }
    }

    return result
  }

  return sanitize(obj) as Record<string, unknown>
}

function isGeminiResponse(obj: unknown): obj is GeminiResponse {
  if (!obj || typeof obj !== 'object') return false
  const response = obj as Record<string, unknown>

  if ('response' in response && response['response'] && typeof response['response'] === 'object') {
    const innerResponse = response['response'] as Record<string, unknown>
    return 'candidates' in innerResponse && Array.isArray(innerResponse['candidates'])
  }

  return 'candidates' in response && Array.isArray(response['candidates'])
}

interface ErrorWithCode extends Error {
  code?: string
}

/**
 * Parameters for Gemini API image generation
 */
export interface GeminiApiParams {
  prompt: string
  inputImage?: string
  inputImageMimeType?: string
  inputImages?: Array<{ data: string; mimeType: string }>
  aspectRatio?: string
  imageSize?: string
  useGoogleSearch?: boolean
  quality?: 'fast' | 'balanced' | 'quality'
}

export interface GeminiClient extends ImageProviderClient {
  generateImage(
    params: GeminiApiParams
  ): Promise<Result<GeneratedImageResult, GeminiAPIError | NetworkError>>
}

class GeminiClientImpl implements GeminiClient {
  constructor(
    private readonly genai: GeminiClientInstance,
    private readonly defaultQuality: 'fast' | 'balanced' | 'quality' = 'fast'
  ) {}

  async generateImage(
    params: GeminiApiParams
  ): Promise<Result<GeneratedImageResult, GeminiAPIError | NetworkError>> {
    try {
      const requestContent: unknown[] = []

      if (params.inputImages && params.inputImages.length > 0) {
        const parts: unknown[] = params.inputImages.map((img) => ({
          inlineData: {
            data: img.data,
            mimeType: img.mimeType,
          },
        }))
        parts.push({ text: params.prompt })
        requestContent.push({ parts })
      } else if (params.inputImage) {
        requestContent.push({
          parts: [
            {
              inlineData: {
                data: params.inputImage,
                mimeType: params.inputImageMimeType || 'image/jpeg',
              },
            },
            {
              text: params.prompt,
            },
          ],
        })
      } else {
        requestContent.push({
          parts: [
            {
              text: params.prompt,
            },
          ],
        })
      }

      const effectiveQuality = params.quality ?? this.defaultQuality
      const modelName = effectiveQuality === 'quality' ? GEMINI_MODELS.PRO : GEMINI_MODELS.FLASH

      const imageConfig: Record<string, string> = {}
      if (params.aspectRatio) {
        imageConfig['aspectRatio'] = params.aspectRatio
      }
      if (params.imageSize) {
        imageConfig['imageSize'] = params.imageSize
      }

      const thinkingConfig =
        effectiveQuality === 'balanced' ? { thinkingConfig: { thinkingLevel: 'high' } } : {}

      const config = {
        ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
        responseModalities: ['IMAGE'],
        ...thinkingConfig,
      }

      const tools = params.useGoogleSearch ? [{ googleSearch: {} }] : undefined

      const rawResponse = await this.genai.models.generateContent({
        model: modelName,
        contents: requestContent,
        config,
        ...(tools && { tools }),
      })

      if (!isGeminiResponse(rawResponse)) {
        const responseStructure = analyzeResponseStructure(rawResponse)
        const asRecord = rawResponse as Record<string, unknown>
        if (asRecord['error']) {
          const error = asRecord['error'] as Record<string, unknown>
          return Err(
            new GeminiAPIError(`Gemini API Error: ${error['message'] || 'Unknown error'}`, {
              code: error['code'],
              status: error['status'],
              details: error['details'] || responseStructure,
              stage: 'api_error',
            })
          )
        }

        return Err(
          new GeminiAPIError('Invalid response structure from Gemini API', {
            message: 'The API returned an unexpected response format',
            responseStructure,
            stage: 'response_validation',
            suggestion: 'Check if the API endpoint or model configuration is correct',
          })
        )
      }

      const responseData = (rawResponse as Record<string, unknown>)['response']
        ? ((rawResponse as Record<string, unknown>)['response'] as GeminiResponse)
        : (rawResponse as GeminiResponse)

      const responseAsRecord = responseData as Record<string, unknown>
      if (responseAsRecord['promptFeedback']) {
        const promptFeedback = responseAsRecord['promptFeedback'] as Record<string, unknown>
        if (promptFeedback['blockReason'] === 'SAFETY') {
          return Err(
            new GeminiAPIError('Image generation blocked for safety reasons', {
              stage: 'prompt_analysis',
              blockReason: promptFeedback['blockReason'],
              suggestion: 'Rephrase your prompt to avoid potentially sensitive content',
            })
          )
        }
        if (
          promptFeedback['blockReason'] === 'OTHER' ||
          promptFeedback['blockReason'] === 'PROHIBITED_CONTENT'
        ) {
          return Err(
            new GeminiAPIError('Image generation blocked due to prohibited content', {
              stage: 'prompt_analysis',
              blockReason: promptFeedback['blockReason'],
              suggestion: 'Remove any prohibited content from your prompt and try again',
            })
          )
        }
      }

      if (!responseData.candidates || responseData.candidates.length === 0) {
        return Err(
          new GeminiAPIError('No image generated: Content may have been filtered', {
            stage: 'generation',
            candidatesCount: 0,
            suggestion: 'Try rephrasing your prompt to avoid potentially sensitive content',
          })
        )
      }

      const candidate = responseData.candidates[0]
      if (!candidate || !candidate.content || !candidate.content.parts) {
        return Err(
          new GeminiAPIError('No valid content in response', {
            stage: 'candidate_extraction',
            suggestion: 'The API response was incomplete. Please try again',
          })
        )
      }

      const parts = candidate.content.parts

      if (candidate.finishReason) {
        const finishReason = candidate.finishReason

        if (finishReason === 'IMAGE_SAFETY') {
          return Err(
            new GeminiAPIError('Image generation stopped for safety reasons', {
              finishReason,
              stage: 'generation_stopped',
              suggestion: 'Modify your prompt to avoid potentially sensitive content',
              safetyRatings: (candidate as Record<string, unknown>)['safetyRatings']
                ? (
                    (candidate as Record<string, unknown>)['safetyRatings'] as Record<
                      string,
                      unknown
                    >[]
                  )
                    ?.map((rating: Record<string, unknown>) => {
                      const category = (rating['category'] as string)
                        .replace('HARM_CATEGORY_', '')
                        .split('_')
                        .map((word: string) => word.charAt(0) + word.slice(1).toLowerCase())
                        .join(' ')
                      return `${category} (${rating['blocked'] ? 'BLOCKED' : 'ALLOWED'})`
                    })
                    .join(', ')
                : undefined,
            })
          )
        }

        if (finishReason === 'MAX_TOKENS') {
          return Err(
            new GeminiAPIError('Maximum token limit reached during generation', {
              finishReason,
              stage: 'generation_stopped',
              suggestion: 'Try using a shorter or simpler prompt',
            })
          )
        }
      }

      if (parts.length === 0) {
        return Err(
          new GeminiAPIError('No content parts in response', {
            stage: 'content_extraction',
            suggestion: 'The generation was incomplete. Please try again',
          })
        )
      }

      const imagePart = parts.find((part) => part.inlineData?.data)
      const textPart = parts.find((part) => part.text)

      if (!imagePart?.inlineData) {
        const errorMessage = textPart?.text || 'Image generation failed'

        return Err(
          new GeminiAPIError('Image generation failed due to content filtering', {
            reason: errorMessage,
            stage: 'image_extraction',
            suggestion:
              'The prompt was blocked by safety filters. Try rephrasing your prompt to avoid potentially sensitive content.',
          })
        )
      }

      const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
      const mimeType = imagePart.inlineData.mimeType || 'image/png'

      const metadata: GeneratedImageMetadata = {
        provider: 'gemini',
        model: modelName,
        prompt: params.prompt,
        mimeType,
        timestamp: new Date(),
        inputImageProvided: !!params.inputImage || !!(params.inputImages && params.inputImages.length > 0),
        ...(responseData.modelVersion && { modelVersion: responseData.modelVersion }),
        ...(responseData.responseId && { responseId: responseData.responseId }),
      }

      return Ok({
        imageData: imageBuffer,
        metadata,
      })
    } catch (error) {
      return this.handleError(error, params.prompt)
    }
  }

  private handleError(
    error: unknown,
    prompt: string
  ): Result<never, GeminiAPIError | NetworkError> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (this.isNetworkError(error)) {
      return Err(
        new NetworkError(
          `Network error during image generation: ${errorMessage}`,
          'Check your internet connection and try again',
          error instanceof Error ? error : undefined
        )
      )
    }

    if (this.isAPIError(error)) {
      return Err(
        new GeminiAPIError(
          `Failed to generate image: ${errorMessage}`,
          this.getAPIErrorSuggestion(errorMessage),
          this.extractStatusCode(error)
        )
      )
    }

    return Err(
      new GeminiAPIError(
        `Failed to generate image with prompt "${prompt}": ${errorMessage}`,
        'Check your API key, quota, and prompt validity. Try again with a different prompt'
      )
    )
  }

  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const networkErrorCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']
      return networkErrorCodes.some(
        (code) => error.message.includes(code) || (error as ErrorWithCode).code === code
      )
    }
    return false
  }

  private isAPIError(error: unknown): boolean {
    if (error instanceof Error) {
      const apiErrorKeywords = ['quota', 'rate limit', 'unauthorized', 'forbidden', 'api key']
      return apiErrorKeywords.some((keyword) => error.message.toLowerCase().includes(keyword))
    }
    return false
  }

  private getAPIErrorSuggestion(errorMessage: string): string {
    const lowerMessage = errorMessage.toLowerCase()

    if (lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
      return 'You have exceeded your API quota or rate limit. Wait before making more requests or upgrade your plan'
    }

    if (lowerMessage.includes('unauthorized') || lowerMessage.includes('api key')) {
      return 'Check that your GEMINI_API_KEY is valid and has the necessary permissions'
    }

    if (lowerMessage.includes('forbidden')) {
      return 'Your API key does not have permission for this operation'
    }

    return 'Check your API configuration and try again'
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'status' in error) {
      return typeof error.status === 'number' ? error.status : undefined
    }
    return undefined
  }
}

export function createGeminiClient(config: Config): Result<GeminiClient, GeminiAPIError> {
  try {
    const createClient = async () => {
      await applyProxyFetch()

      const httpOptions: { baseUrl?: string; timeout?: number } = {}
      if (config.geminiApiBaseUrl) {
        httpOptions.baseUrl = config.geminiApiBaseUrl
      }
      if (config.apiTimeout) {
        httpOptions.timeout = config.apiTimeout
      }

      return new GoogleGenAI({
        apiKey: config.geminiApiKey || '',
        ...(Object.keys(httpOptions).length > 0 && { httpOptions }),
      }) as unknown as GeminiClientInstance
    }

    let genaiInstance: GeminiClientInstance | null = null
    const genaiProxy = new Proxy({} as GeminiClientInstance, {
      get(_target, prop) {
        if (prop === 'models') {
          return new Proxy({} as GeminiClientInstance['models'], {
            get(_t, method) {
              return async (...args: unknown[]) => {
                if (!genaiInstance) {
                  genaiInstance = await createClient()
                }
                const models = genaiInstance.models as Record<string, (...a: unknown[]) => unknown>
                return models[method as string]!(...args)
              }
            },
          })
        }
        return undefined
      },
    })

    return Ok(new GeminiClientImpl(genaiProxy, config.imageQuality))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return Err(
      new GeminiAPIError(
        `Failed to initialize Gemini client: ${errorMessage}`,
        'Verify your GEMINI_API_KEY is valid and the @google/genai package is properly installed'
      )
    )
  }
}
