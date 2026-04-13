/**
 * Tests for GeminiAPIError suggestion getter
 * Verifies model name references in suggestion text for multi-model support
 */

import { describe, expect, it } from 'vitest'
import { GeminiAPIError, VolcengineAPIError } from '../errors'

describe('VolcengineAPIError', () => {
  describe('suggestion getter', () => {
    it('should reference Seedream model when message contains model/access/permission keywords', () => {
      const error = new VolcengineAPIError('Permission denied for model access')

      expect(error.suggestion).toContain('doubao-seedream-4-5-251128')
    })

    it('should use custom suggestion when provided', () => {
      const customSuggestion = 'Custom Volcengine suggestion'
      const error = new VolcengineAPIError('Some error', customSuggestion)

      expect(error.suggestion).toBe(customSuggestion)
    })
  })
})
