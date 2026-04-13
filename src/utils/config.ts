/**
 * Configuration management for MCP server
 * Handles environment variables and configuration validation
 */

import type { ImageProvider, ImageQuality } from '../types/mcp.js'
import { IMAGE_PROVIDER_VALUES, IMAGE_QUALITY_VALUES } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { ConfigError } from './errors.js'

/**
 * Configuration interface
 */
export interface Config {
  imageProvider: ImageProvider
  geminiApiKey: string | undefined
  volcengineApiKey: string | undefined
  volcengineModel: string | undefined
  imageOutputDir: string
  apiTimeout: number
  skipPromptEnhancement: boolean // Skip prompt enhancement for direct control
  imageQuality: ImageQuality
  geminiApiBaseUrl?: string // Optional custom API base URL
  volcengineApiBaseUrl?: string // Optional custom API base URL
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  imageProvider: 'gemini' as const,
  imageOutputDir: './output',
  apiTimeout: 120000, // 120 seconds (default for multi-image synthesis)
  volcengineApiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
} as const

/**
 * Validates the configuration
 * @param config The configuration to validate
 * @returns Result containing validated config or ConfigError
 */
export function validateConfig(config: Config): Result<Config, ConfigError> {
  const provider = config.imageProvider || 'gemini'
  const normalizedConfig: Config = {
    ...config,
    imageProvider: provider,
  }

  // Validate provider
  if (!IMAGE_PROVIDER_VALUES.includes(provider)) {
    return Err(
      new ConfigError(
        `Invalid IMAGE_PROVIDER value: "${provider}". Valid options: ${IMAGE_PROVIDER_VALUES.join(', ')}`,
        `Set IMAGE_PROVIDER to one of: ${IMAGE_PROVIDER_VALUES.join(', ')}`
      )
    )
  }

  // Validate selected provider API key
  if (provider === 'gemini') {
    if (!normalizedConfig.geminiApiKey || normalizedConfig.geminiApiKey.trim().length === 0) {
      return Err(
        new ConfigError(
          'GEMINI_API_KEY is required but not provided',
          'Set GEMINI_API_KEY environment variable with your Google AI API key'
        )
      )
    }

    if (normalizedConfig.geminiApiKey.length < 10) {
      return Err(
        new ConfigError(
          'GEMINI_API_KEY appears to be invalid - must be at least 10 characters',
          'Set the GEMINI_API_KEY environment variable to your valid Google AI API key'
        )
      )
    }
  }

  if (provider === 'volcengine') {
    if (!normalizedConfig.volcengineApiKey || normalizedConfig.volcengineApiKey.trim().length === 0) {
      return Err(
        new ConfigError(
          'VOLCENGINE_API_KEY is required but not provided',
          'Set VOLCENGINE_API_KEY environment variable with your Volcengine Ark API key'
        )
      )
    }

    if (normalizedConfig.volcengineApiKey.length < 10) {
      return Err(
        new ConfigError(
          'VOLCENGINE_API_KEY appears to be invalid - must be at least 10 characters',
          'Set the VOLCENGINE_API_KEY environment variable to your valid Volcengine Ark API key'
        )
      )
    }
  }

  // Validate apiTimeout
  if (normalizedConfig.apiTimeout <= 0) {
    return Err(
      new ConfigError(
        'API timeout must be a positive number',
        'Set a positive timeout value in milliseconds (e.g., 30000 for 30 seconds)'
      )
    )
  }

  // Validate imageOutputDir (basic check - non-empty string)
  if (!normalizedConfig.imageOutputDir || normalizedConfig.imageOutputDir.trim().length === 0) {
    return Err(
      new ConfigError(
        'IMAGE_OUTPUT_DIR cannot be empty',
        'Set IMAGE_OUTPUT_DIR to a valid directory path'
      )
    )
  }

  // Validate imageQuality
  if (!IMAGE_QUALITY_VALUES.includes(normalizedConfig.imageQuality)) {
    return Err(
      new ConfigError(
        `Invalid IMAGE_QUALITY value: "${normalizedConfig.imageQuality}". Valid options: ${IMAGE_QUALITY_VALUES.join(', ')}`,
        `Set IMAGE_QUALITY to one of: ${IMAGE_QUALITY_VALUES.join(', ')}`
      )
    )
  }

  return Ok(normalizedConfig)
}

/**
 * Loads configuration from environment variables
 * @returns Result containing config or ConfigError
 */
export function getConfig(): Result<Config, ConfigError> {
  const config: Config = {
    imageProvider: (process.env['IMAGE_PROVIDER'] || DEFAULT_CONFIG.imageProvider) as ImageProvider,
    geminiApiKey: process.env['GEMINI_API_KEY'] || undefined,
    volcengineApiKey: process.env['VOLCENGINE_API_KEY'] || undefined,
    volcengineModel: process.env['VOLCENGINE_MODEL'] || undefined,
    imageOutputDir: process.env['IMAGE_OUTPUT_DIR'] || DEFAULT_CONFIG.imageOutputDir,
    apiTimeout: parseInt(process.env['API_TIMEOUT'] || String(DEFAULT_CONFIG.apiTimeout), 10),
    skipPromptEnhancement: process.env['SKIP_PROMPT_ENHANCEMENT'] === 'true',
    imageQuality: (process.env['IMAGE_QUALITY'] || 'fast') as ImageQuality,
    volcengineApiBaseUrl:
      process.env['VOLCENGINE_API_BASE_URL'] || DEFAULT_CONFIG.volcengineApiBaseUrl,
    ...(process.env['GEMINI_API_BASE_URL'] && { geminiApiBaseUrl: process.env['GEMINI_API_BASE_URL'] }),
  }

  return validateConfig(config)
}
