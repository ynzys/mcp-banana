import { describe, expect, it } from 'vitest'
import {
  buildIndependentImagePrompt,
  extractExplicitImageRequests,
  hasExplicitMultiImageStructure,
  inferRequestedImageCount,
  normalizeMultiImageParams,
  prepareGenerateMultiImageParams,
} from '../multiImagePrompt'

describe('multiImagePrompt', () => {
  it('normalizes imageRequests into a numbered multi-image prompt', () => {
    const result = normalizeMultiImageParams({
      prompt: '整体风格统一为高级感电商视觉',
      imageRequests: ['白底主图，正面展示产品', '生活方式场景图，展示手持使用'],
    })

    expect(result.outputCount).toBe(2)
    expect(result.skipPromptEnhancement).toBe(true)
    expect(result.prompt).toContain('总体要求：整体风格统一为高级感电商视觉')
    expect(result.prompt).toContain('第1张：白底主图，正面展示产品')
    expect(result.prompt).toContain('第2张：生活方式场景图，展示手持使用')
  })

  it('rewrites prompt when outputCount is greater than 1 without explicit numbering', () => {
    const result = normalizeMultiImageParams({
      prompt: '生成一组同主题的海报',
      outputCount: 3,
    })

    expect(result.skipPromptEnhancement).toBe(true)
    expect(result.prompt).toContain('请一次性生成3张彼此独立的图片')
    expect(result.prompt).toContain('第1张：')
    expect(result.prompt).toContain('第2张：')
    expect(result.prompt).toContain('第3张：')
  })

  it('preserves explicit numbered prompts and only protects enhancement', () => {
    const result = normalizeMultiImageParams({
      prompt: '请生成两张图。第1张：白天街景。第2张：夜晚街景。',
      outputCount: 2,
    })

    expect(result.prompt).toBe('请生成两张图。第1张：白天街景。第2张：夜晚街景。')
    expect(result.skipPromptEnhancement).toBe(true)
  })

  it('detects explicit multi-image structure', () => {
    expect(hasExplicitMultiImageStructure('第1张：猫。第2张：狗。')).toBe(true)
    expect(hasExplicitMultiImageStructure('Generate one landscape image')).toBe(false)
  })

  it('infers requested image count from prompt text', () => {
    expect(inferRequestedImageCount('请生成4张电商产品图')).toBe(4)
    expect(inferRequestedImageCount('请生成四张海报')).toBe(4)
    expect(inferRequestedImageCount('Create 4 images for a campaign')).toBe(4)
  })

  it('extracts explicit image sections from a planner-style prompt', () => {
    const result = extractExplicitImageRequests(
      'Create 4 cohesive product images. Image 1 (Hero Shot): white bottle on white background. Image 2 (Side Detail): close-up side view. Image 3 (Handheld Lifestyle): held by a person. Image 4 (Desk Scene): placed on an office desk.'
    )

    expect(result.sharedPrompt).toBe('Create 4 cohesive product images.')
    expect(result.imageRequests).toEqual([
      'white bottle on white background.',
      'close-up side view.',
      'held by a person.',
      'placed on an office desk.',
    ])
  })

  it('builds an independent per-image prompt', () => {
    const result = buildIndependentImagePrompt('统一高级电商风格', '白底主图，正面展示产品')

    expect(result).toContain('统一高级电商风格')
    expect(result).toContain('只生成1张独立图片')
    expect(result).toContain('白底主图，正面展示产品')
  })

  it('prepares generate_multi_image params by inferring outputCount', () => {
    const result = prepareGenerateMultiImageParams({
      prompt: '请生成4张电商产品图，风格统一',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.outputCount).toBe(4)
    }
  })

  it('rejects generate_multi_image requests without a clear multi-image count', () => {
    const result = prepareGenerateMultiImageParams({
      prompt: '请生成一张电商产品图',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('generate_multi_image requires a multi-image request')
    }
  })
})
