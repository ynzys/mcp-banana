import type { GenerateImageParams } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { InputValidationError } from '../utils/errors.js'

const EXPLICIT_MULTI_IMAGE_PATTERNS = [
  /第\s*[0-9一二三四五六七八九十百千]+\s*张/iu,
  /\bimage\s*[1-9]\d*\b/iu,
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+image\b/iu,
]
const EXPLICIT_MULTI_IMAGE_SECTION_REGEX =
  /(第\s*[0-9一二三四五六七八九十百千]+\s*张|Image[_\s]*[1-9]\d*(?:\s*\([^)]*\))?|(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+Image)\s*[:：]/giu

const CHINESE_NUMBER_MAP: Record<string, number> = {
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
  十三: 13,
  十四: 14,
  十五: 15,
}

function trimNonEmpty(value: string): string {
  return value.trim()
}

function buildAutomaticImageRequest(index: number): string {
  return `在满足总体要求的前提下，生成第${index}张独立图片；允许构图、景别、姿态或细节自然变化，但不要输出拼图，也不要缺少图片。`
}

function buildNormalizedMultiImagePrompt(sharedPrompt: string, imageRequests: string[]): string {
  const total = imageRequests.length
  const sections = [
    `总体要求：${sharedPrompt.trim()}`,
    `请一次性生成${total}张彼此独立的图片。必须返回${total}张单独图片，不要合并成拼图，不要只返回1张。`,
    ...imageRequests.map((request, index) => `第${index + 1}张：${request.trim()}`),
    `最终输出要求：严格返回${total}张独立图片，并分别对应第1张到第${total}张的描述。`,
  ]

  return sections.join('\n')
}

export function hasExplicitMultiImageStructure(prompt: string): boolean {
  return EXPLICIT_MULTI_IMAGE_PATTERNS.some((pattern) => pattern.test(prompt))
}

export function inferRequestedImageCount(prompt: string): number | undefined {
  const arabicMatch = prompt.match(
    /(?:生成|创建|做|出|给我|提供|返回|输出|一组|组|共|total)?\s*([2-9]|1[0-5])\s*(?:张|幅|个|套)\s*(?:图|图片|图像|海报|产品图)?/iu
  )
  if (arabicMatch?.[1]) {
    return Number.parseInt(arabicMatch[1], 10)
  }

  const englishMatch = prompt.match(/\b([2-9]|1[0-5])\s*(?:images?|variations?|shots?|posters?|renders?)\b/iu)
  if (englishMatch?.[1]) {
    return Number.parseInt(englishMatch[1], 10)
  }

  const chineseMatch = prompt.match(
    /(?:生成|创建|做|出|给我|提供|返回|输出|一组|组)?\s*(两|二|三|四|五|六|七|八|九|十|十一|十二|十三|十四|十五)\s*(?:张|幅|个|套)\s*(?:图|图片|图像|海报|产品图)?/iu
  )
  if (chineseMatch?.[1]) {
    return CHINESE_NUMBER_MAP[chineseMatch[1]]
  }

  return undefined
}

export function extractExplicitImageRequests(prompt: string): { sharedPrompt?: string; imageRequests: string[] } {
  const matches = Array.from(prompt.matchAll(EXPLICIT_MULTI_IMAGE_SECTION_REGEX))
  if (!matches.length) {
    return { imageRequests: [] }
  }

  const imageRequests: string[] = []
  for (let index = 0; index < matches.length; index++) {
    const currentMatch = matches[index]
    if (!currentMatch) {
      continue
    }
    const nextMatch = matches[index + 1]
    const currentIndex = currentMatch.index
    if (currentIndex === undefined) {
      continue
    }

    const segmentStart = currentIndex + currentMatch[0].length
    const segmentEnd = nextMatch?.index ?? prompt.length
    const segment = prompt.slice(segmentStart, segmentEnd).trim()
    if (segment) {
      imageRequests.push(segment)
    }
  }

  const firstMatchIndex = matches[0]?.index
  const sharedPrompt =
    firstMatchIndex !== undefined ? prompt.slice(0, firstMatchIndex).trim() || undefined : undefined

  return {
    ...(sharedPrompt ? { sharedPrompt } : {}),
    imageRequests,
  }
}

export function buildIndependentImagePrompt(sharedPrompt: string | undefined, imageRequest: string): string {
  const parts = [
    sharedPrompt?.trim(),
    '只生成1张独立图片，不要拼图，不要四宫格，不要在同一画面中合成多张子图。',
    imageRequest.trim(),
  ].filter(Boolean)

  return parts.join('\n\n')
}

export function prepareGenerateMultiImageParams(
  params: GenerateImageParams
): Result<GenerateImageParams, InputValidationError> {
  const inferredCount =
    params.outputCount ?? params.imageRequests?.length ?? inferRequestedImageCount(params.prompt)

  if (inferredCount === undefined || inferredCount < 2) {
    return Err(
      new InputValidationError(
        'generate_multi_image requires a multi-image request with outputCount >= 2, imageRequests, or an explicit image count in the prompt',
        'Provide outputCount, imageRequests, or mention an explicit count such as "4张图" or "4 images".'
      )
    )
  }

  return Ok({
    ...params,
    outputCount: params.outputCount ?? inferredCount,
  })
}

export function normalizeMultiImageParams(params: GenerateImageParams): GenerateImageParams {
  const imageRequests = params.imageRequests?.map(trimNonEmpty).filter(Boolean)
  const requestedCount = imageRequests?.length ?? params.outputCount
  let prompt = params.prompt
  let promptWasNormalized = false

  if (imageRequests?.length) {
    prompt = buildNormalizedMultiImagePrompt(params.prompt, imageRequests)
    promptWasNormalized = true
  } else if (params.outputCount && params.outputCount > 1 && !hasExplicitMultiImageStructure(params.prompt)) {
    prompt = buildNormalizedMultiImagePrompt(
      params.prompt,
      Array.from({ length: params.outputCount }, (_, index) => buildAutomaticImageRequest(index + 1))
    )
    promptWasNormalized = true
  }

  const shouldPreserveMultiImagePrompt =
    params.skipPromptEnhancement === undefined &&
    requestedCount !== undefined &&
    requestedCount > 1 &&
    (promptWasNormalized || hasExplicitMultiImageStructure(prompt))

  return {
    ...params,
    prompt,
    ...(imageRequests?.length ? { imageRequests } : {}),
    ...(imageRequests?.length && params.outputCount === undefined ? { outputCount: imageRequests.length } : {}),
    ...(shouldPreserveMultiImagePrompt ? { skipPromptEnhancement: true } : {}),
  }
}
