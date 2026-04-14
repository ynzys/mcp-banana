import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { createVolcengineClient } from '../volcengineClient'

const mockImagesGenerate = vi.fn()
const mockOpenAI = vi.fn()

vi.mock('openai', () => ({
  default: class {
    images = {
      generate: mockImagesGenerate,
    }

    constructor(...args: unknown[]) {
      mockOpenAI(...args)
    }
  },
}))

vi.mock('../../utils/proxyFetch', () => ({
  applyProxyFetch: vi.fn().mockResolvedValue(undefined),
}))

describe('volcengineClient', () => {
  const testConfig: Config = {
    imageProvider: 'volcengine',
    geminiApiKey: undefined,
    volcengineApiKey: 'test-volcengine-api-key',
    volcengineModel: 'doubao-seedream-5-0-260128',
    imageOutputDir: './output',
    apiTimeout: 30000,
    skipPromptEnhancement: false,
    imageQuality: 'fast',
    volcengineApiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockImagesGenerate.mockResolvedValue({
      data: [
        {
          b64_json: Buffer.from('generated-image').toString('base64'),
          size: '1024x1024',
        },
      ],
    })
  })

  it('should send single input image as Data URL', async () => {
    const clientResult = createVolcengineClient(testConfig)
    expect(clientResult.success).toBe(true)
    if (!clientResult.success) return

    const result = await clientResult.data.generateImage({
      prompt: 'edit image',
      inputImage: 'YWJj',
      inputImageMimeType: 'image/png',
    })

    expect(result.success).toBe(true)
    expect(mockImagesGenerate).toHaveBeenCalledTimes(1)
    const request = mockImagesGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.image).toBe('data:image/png;base64,YWJj')
  })

  it('should preserve existing Data URL input', async () => {
    const clientResult = createVolcengineClient(testConfig)
    expect(clientResult.success).toBe(true)
    if (!clientResult.success) return

    const result = await clientResult.data.generateImage({
      prompt: 'edit image',
      inputImage: 'data:image/webp;base64,QUJDRA==',
      inputImageMimeType: 'image/webp',
    })

    expect(result.success).toBe(true)
    const request = mockImagesGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.image).toBe('data:image/webp;base64,QUJDRA==')
  })

  it('should infer size from source image dimensions when editing without explicit size or ratio', async () => {
    const clientResult = createVolcengineClient(testConfig)
    expect(clientResult.success).toBe(true)
    if (!clientResult.success) return

    const png1x2Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAADElEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC'

    const result = await clientResult.data.generateImage({
      prompt: 'return original image',
      inputImage: png1x2Base64,
      inputImageMimeType: 'image/png',
    })

    expect(result.success).toBe(true)
    const request = mockImagesGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.size).toBe('64x64')
  })

  it('should prefer explicit aspect ratio over source dimensions', async () => {
    const clientResult = createVolcengineClient(testConfig)
    expect(clientResult.success).toBe(true)
    if (!clientResult.success) return

    const png1x2Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAADElEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC'

    const result = await clientResult.data.generateImage({
      prompt: 'edit image',
      inputImage: png1x2Base64,
      inputImageMimeType: 'image/png',
      aspectRatio: '16:9',
      imageSize: '2K',
    })

    expect(result.success).toBe(true)
    const request = mockImagesGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.size).toBe('2048x1152')
  })

  it('should keep all generated images when provider returns multiple items', async () => {
    mockImagesGenerate.mockResolvedValueOnce({
      data: [
        {
          b64_json: Buffer.from('generated-image-1').toString('base64'),
          size: '1024x1024',
        },
        {
          b64_json: Buffer.from('generated-image-2').toString('base64'),
          size: '1024x1024',
        },
      ],
    })

    const clientResult = createVolcengineClient(testConfig)
    expect(clientResult.success).toBe(true)
    if (!clientResult.success) return

    const result = await clientResult.data.generateImage({
      prompt: 'generate two images',
      outputCount: 2,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.images).toHaveLength(2)
    expect(result.data.imageData.toString()).toBe('generated-image-1')
    expect(result.data.images?.[0]?.imageData.toString()).toBe('generated-image-1')
    expect(result.data.images?.[1]?.imageData.toString()).toBe('generated-image-2')
  })
})
