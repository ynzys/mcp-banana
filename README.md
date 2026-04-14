# MCP HydroCoder Image 🍌

> AI image generation and editing MCP server for Cursor, Claude Code, Codex, and any MCP-compatible tool — powered by Nano Banana 2 and Nano Banana Pro (Google Gemini).

[![npm version](https://badge.fury.io/js/mcp-hydrocoder-image.svg)](https://www.npmjs.com/package/mcp-hydrocoder-image)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that turns simple text prompts into high-quality images. Unlike a simple API wrapper, this server automatically enhances your prompt and configures sensible defaults for generation — you don't need to learn prompt engineering or tune settings. Just describe what you want.

## How It Works

```
You: "cat on a roof"
        ↓
  Your AI assistant infers context
  (purpose, style, mood, resolution...)
        ↓
  MCP optimizes your prompt
  (adds lighting, composition, atmosphere, artistic details)
        ↓
  Image generation with smart defaults
  (grounding, consistency, resolution — all configured automatically)
        ↓
  High-quality image, zero effort
```

Your AI assistant interprets your intent — the style, purpose, and context behind your request. The MCP focuses on output quality by refining the prompt to meet a structured visual clarity standard and selecting appropriate generation settings. You just describe what you want.

The prompt optimizer uses a **Subject–Context–Style** framework (powered by Gemini 2.5 Flash) to fill in missing visual details — subject characteristics, environment, lighting, camera work — while preserving your original intent. It doesn't blindly add details: prompts that already meet the quality standard are left largely intact.

**Example — what the optimizer does to a short prompt:**

> **Input:** "cat on a roof"
>
> **After optimization:** "A sleek, midnight black cat, perched with poised elegance on the apex of a weathered, terracotta tile roof. Its emerald eyes, narrowed slightly, reflect the warm glow of a setting sun. Each individual tile is distinct, showing subtle variations in color and texture, with patches of moss clinging to the crevices. The cat's fur is sharply defined, catching the golden hour light, highlighting its sleek contours. In the background, the silhouettes of distant, old-world city buildings with ornate spires are softly blurred, bathed in a gradient of fiery orange, soft pink, and deep violet twilight. A gentle, ethereal mist begins to rise from the alleyways below, adding a touch of mystery. The composition is a medium shot, taken from a slightly low angle, emphasizing the cat's commanding presence against the vast sky. Photorealistic style, captured with a prime lens, wide aperture to create a beautiful bokeh, enhancing the depth of field."

## Features

- **Multi-Provider Support**: Use either Google Gemini or Volcengine Seedream behind the same MCP server, with provider selection via config or per-request override.
- **Built-in Prompt Optimization**: Your simple prompt is automatically enriched with photographic and artistic details — lighting, composition, atmosphere — using Gemini 2.5 Flash. No prompt engineering skills required.
- **Three Quality Tiers**: Choose between fast iteration, balanced quality, or maximum fidelity with Nano Banana 2 (Gemini 3.1 Flash Image) and Nano Banana Pro (Gemini 3 Pro Image). [See Quality Presets](#quality-presets).
- **Image Editing**: Transform existing images with natural language instructions (image-to-image) while preserving original style and visual consistency.
- **High-Resolution Output**: Up to 4K image generation for professional-grade output with superior text rendering and fine details.
- **Flexible Aspect Ratios**: From square (1:1) to ultra-wide (21:9) and ultra-tall (1:8) formats.
- **Character Consistency**: Maintain consistent character appearance across multiple generations — ideal for storyboards, product shots, and visual series.
- **Advanced Capabilities**:
  - Google Search grounding for real-time factual accuracy
  - World knowledge for photorealistic depictions of historical figures, landmarks, and factual scenarios
  - Multi-image blending for composite scenes
  - Purpose-aware generation (e.g., "cookbook cover" produces different results than "social media post")
- **Multiple Output Formats**: PNG, JPEG, WebP support.

## Agent Skill: Image Generation Prompt Guide

This project also provides a standalone **[Agent Skill](https://agentskills.io)** (`SKILL.md`) that teaches AI assistants to write better image generation prompts — no MCP server or API key required.

> **Note:** This skill does not generate images itself. It teaches your AI assistant to write better prompts for tools that already have built-in image generation (e.g., Cursor's native image generation).

Based on the **Subject-Context-Style** framework, covering prompt structure, visual details (lighting, textures, camera angles), advanced techniques (character consistency, composition), and image editing. Works with any image model (Gemini, GPT Image, Flux, Stable Diffusion, Midjourney, etc.).

### Install

```bash
npx mcp-hydrocoder-image skills install --path <target-directory>
```

The skill will be placed at `<path>/image-generation/SKILL.md`. Specify the skills directory for your AI tool:

```bash
# Cursor
npx mcp-hydrocoder-image skills install --path ~/.cursor/skills

# Codex
npx mcp-hydrocoder-image skills install --path ~/.codex/skills

# Claude Code
npx mcp-hydrocoder-image skills install --path ~/.claude/skills
```

### When to Use the Skill vs the MCP Server

| | MCP Server | Agent Skill |
|---|---|---|
| **Use when** | Your AI tool does not have built-in image generation | Your AI tool already generates images natively |
| **Requires** | Gemini API key | Nothing |
| **What it does** | Generates images via Gemini API with automatic prompt optimization | Teaches the AI to write better prompts |
| **Works with** | MCP-compatible tools (Cursor, Claude Code, Codex, etc.) | Any tool supporting the [Agent Skills](https://agentskills.io) open standard |

---

## Prerequisites

- **Node.js** 20 or higher
- **API Key**
  - Gemini: get yours at [Google AI Studio](https://aistudio.google.com/apikey)
  - Volcengine: create an Ark API key in the Volcengine console
- An MCP-compatible AI tool: **Cursor**, **Claude Code**, **Codex**, or others
- Basic terminal/command line knowledge

## Quick Start

### 1. Get Your API Key

Choose a provider and create an API key:
- **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)
- **Volcengine**: Volcengine Ark console (`ARK_API_KEY`-compatible key)

### 2. MCP Configuration

#### For Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.mcp-hydrocoder-image]
command = "npx"
args = ["-y", "mcp-hydrocoder-image"]

[mcp_servers.mcp-hydrocoder-image.env]
IMAGE_PROVIDER = "gemini"
GEMINI_API_KEY = "your_gemini_api_key_here"
IMAGE_OUTPUT_DIR = "/absolute/path/to/images"
API_TIMEOUT = "120000"  # Optional: timeout in milliseconds (default: 120s)
```

#### For Cursor

Add to your Cursor settings:
- **Global** (all projects): `~/.cursor/mcp.json`
- **Project-specific**: `.cursor/mcp.json` in your project root

**macOS / Linux:**
```json
{
  "mcpServers": {
    "mcp-hydrocoder-image": {
      "command": "npx",
      "args": ["-y", "mcp-hydrocoder-image"],
      "env": {
        "IMAGE_PROVIDER": "gemini",
        "GEMINI_API_KEY": "your_gemini_api_key_here",
        "IMAGE_OUTPUT_DIR": "/absolute/path/to/images",
        "API_TIMEOUT": "120000"
      }
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "mcp-hydrocoder-image": {
      "command": "npx",
      "args": ["-y", "mcp-hydrocoder-image"],
      "env": {
        "IMAGE_PROVIDER": "gemini",
        "GEMINI_API_KEY": "your_gemini_api_key_here",
        "IMAGE_OUTPUT_DIR": "C:\\absolute\\path\\to\\images",
        "API_TIMEOUT": "120000"
      }
    }
  }
}
```

#### For Claude Code

Run in your project directory to enable for that project:

```bash
cd /path/to/your/project
claude mcp add mcp-hydrocoder-image \
  --env IMAGE_PROVIDER=gemini \
  --env GEMINI_API_KEY=your-api-key \
  --env IMAGE_OUTPUT_DIR=/absolute/path/to/images \
  --env API_TIMEOUT=120000 \
  -- npx -y mcp-hydrocoder-image
```

Or add globally for all projects:

```bash
claude mcp add mcp-hydrocoder-image --scope user \
  --env IMAGE_PROVIDER=gemini \
  --env GEMINI_API_KEY=your-api-key \
  --env IMAGE_OUTPUT_DIR=/absolute/path/to/images \
  --env API_TIMEOUT=120000 \
  -- npx -y mcp-hydrocoder-image
```

Or add via JSON config (`~/.claude/settings.json` for global, `.mcp.json` for project):

**macOS / Linux:**
```json
{
  "mcpServers": {
    "mcp-hydrocoder-image": {
      "command": "npx",
      "args": ["-y", "mcp-hydrocoder-image"],
      "env": {
        "IMAGE_PROVIDER": "gemini",
        "GEMINI_API_KEY": "your_gemini_api_key_here",
        "IMAGE_OUTPUT_DIR": "/absolute/path/to/images",
        "API_TIMEOUT": "120000"
      }
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "mcp-hydrocoder-image": {
      "command": "npx",
      "args": ["-y", "mcp-hydrocoder-image"],
      "env": {
        "IMAGE_PROVIDER": "gemini",
        "GEMINI_API_KEY": "your_gemini_api_key_here",
        "IMAGE_OUTPUT_DIR": "C:\\absolute\\path\\to\\images",
        "API_TIMEOUT": "120000"
      }
    }
  }
}
```

⚠️ **Security Note**: Never commit your API key to version control. Keep it secure and use environment-specific configuration.

📁 **Path Requirements**:
- `IMAGE_OUTPUT_DIR` must be an absolute path (e.g., `/Users/username/images`, not `./images`)
- Defaults to `./output` in the current working directory if not specified
- Directory will be created automatically if it doesn't exist

#### Custom API Base URL (Third-party Proxy)

To use a third-party API endpoint or proxy, add the `GEMINI_API_BASE_URL` environment variable:

**Claude Code:**
```bash
claude mcp add mcp-hydrocoder-image \
  --env GEMINI_API_KEY=your-api-key \
  --env GEMINI_API_BASE_URL=https://your-api-proxy.com \
  --env IMAGE_OUTPUT_DIR=/absolute/path/to/images \
  -- npx -y mcp-hydrocoder-image
```

**Cursor / JSON config:**
```json
{
  "mcpServers": {
    "mcp-hydrocoder-image": {
      "command": "npx",
      "args": ["-y", "mcp-hydrocoder-image"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key_here",
        "GEMINI_API_BASE_URL": "https://your-api-proxy.com",
        "IMAGE_OUTPUT_DIR": "/absolute/path/to/images"
      }
    }
  }
}
```

**Codex (TOML):**
```toml
[mcp_servers.mcp-hydrocoder-image.env]
GEMINI_API_KEY = "your_gemini_api_key_here"
GEMINI_API_BASE_URL = "https://your-api-proxy.com"
IMAGE_OUTPUT_DIR = "/absolute/path/to/images"
```

> **Note**: The base URL should be the root domain (e.g., `https://llm.myseek.fun`), without the `/v1` suffix — the SDK will append the API version automatically.

### Volcengine Example

To use Volcengine Seedream as the default backend, switch provider and set a Volcengine API key.

Current implementation status for Volcengine in this repo:
- Stable path: text-to-image
- Reference-image workflows are wired through the OpenAI-compatible image API using the `image` field
- Base64 image inputs are normalized to the official Volcengine format: `data:image/<format>;base64,<Base64编码>`
- Grouped output (`outputCount`) is best-effort and depends on provider-side behavior
- If the user does not specify `aspectRatio` or `imageSize`, Gemini and Volcengine default to `16:9` and `4K`
- If the user specifies `aspectRatio` and/or `imageSize`, the server automatically normalizes the final `WxH` into Volcengine's legal pixel range
- When the user provides local image paths, they should be passed through `inputImagePath` / `inputImagePaths` instead of being summarized into the prompt

**Claude Code:**
```bash
claude mcp add mcp-hydrocoder-image \
  --env IMAGE_PROVIDER=volcengine \
  --env VOLCENGINE_API_KEY=your-volcengine-api-key \
  --env VOLCENGINE_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 \
  --env IMAGE_OUTPUT_DIR=/absolute/path/to/images \
  -- npx -y mcp-hydrocoder-image
```

**Cursor / JSON config:**
```json
{
  "mcpServers": {
    "mcp-hydrocoder-image": {
      "command": "npx",
      "args": ["-y", "mcp-hydrocoder-image"],
      "env": {
        "IMAGE_PROVIDER": "volcengine",
        "VOLCENGINE_API_KEY": "your_volcengine_api_key_here",
        "VOLCENGINE_MODEL": "doubao-seedream-4-5-251128",
        "VOLCENGINE_API_BASE_URL": "https://ark.cn-beijing.volces.com/api/v3",
        "IMAGE_OUTPUT_DIR": "/absolute/path/to/images"
      }
    }
  }
}
```


Choose the right balance of speed, quality, and cost:

| Preset | Model | Best for | Speed |
|--------|-------|----------|-------|
| `fast` (default) | Nano Banana 2 (Gemini 3.1 Flash Image) | Quick iterations, drafts, high-volume generation | ~30–40s |
| `balanced` | Nano Banana 2 + Thinking | Production images, good quality with reasonable speed | Medium |
| `quality` | Nano Banana Pro (Gemini 3 Pro Image) | Final deliverables, maximum fidelity, critical visuals | Slow |

Set the default via `IMAGE_QUALITY` environment variable:

```
IMAGE_QUALITY=fast       # (default) Fastest generation
IMAGE_QUALITY=balanced   # Enhanced thinking for better quality
IMAGE_QUALITY=quality    # Maximum quality output
```

To override per-request, just tell your AI assistant (e.g., "generate in high quality" or "use balanced quality"). The assistant will pass the appropriate `quality` parameter automatically.

**Codex:**
```toml
[mcp_servers.mcp-hydrocoder-image.env]
GEMINI_API_KEY = "your_gemini_api_key_here"
IMAGE_QUALITY = "balanced"
```

**Cursor:**
Add `"IMAGE_QUALITY": "balanced"` to the env section in your config.

**Claude Code:**
```bash
claude mcp add mcp-hydrocoder-image --env GEMINI_API_KEY=your-api-key --env IMAGE_QUALITY=balanced --env IMAGE_OUTPUT_DIR=/absolute/path/to/images -- npx -y mcp-hydrocoder-image
```

### Skip Prompt Enhancement

Control prompt enhancement via the `skipPromptEnhancement` tool parameter or the `SKIP_PROMPT_ENHANCEMENT` environment variable. **Parameter takes priority over environment variable.**

| Parameter | Env Variable | Result |
|-----------|-------------|--------|
| Not set | Not set | Enhancement enabled (default) |
| Not set | `true` | Enhancement skipped |
| `true` | Any | Enhancement skipped |
| `false` | `true` | Enhancement enabled (parameter overrides) |

Skipping enhancement is recommended for multi-image blending, where the prompt enhancer may rewrite your blending intent into unrelated content.

## Usage Examples

Once configured, just describe what you want in natural language:

### Basic Image Generation

```
"Generate a serene mountain landscape at sunset with a lake reflection"
```

Your prompt is automatically enhanced with rich details about lighting, materials, composition, and atmosphere.

### Image Editing

```
"Edit this image to make the person face right"
(with inputImagePath: "/path/to/image.jpg")
```

### Advanced Features

**Character Consistency:**
```
"Generate a portrait of a medieval knight, maintaining character consistency for future variations"
(with maintainCharacterConsistency: true)
```

**High-Resolution 4K with Text Rendering:**
```
"Generate a professional product photo of a smartphone with clear text on the screen"
(with imageSize: "4K")
```

**Custom Aspect Ratio:**
```
"Generate a cinematic landscape of a desert at golden hour"
(with aspectRatio: "21:9")
```

### Grouped Multi-Image Generation

For a grouped multi-image task, prefer `generate_multi_image` instead of repeating `generate_image`.

**Natural-language grouped request:**
```text
"Use generate_multi_image to create 4 unified e-commerce product images of the same minimalist white thermos cup: hero shot, side-detail shot, handheld lifestyle shot, and desk scene. Return 4 separate images in one run."
```

**Structured grouped request with inferred numbering:**
```json
{
  "prompt": "同一款极简白色保温杯，整体风格统一，高级感、干净、真实、适合品牌官网和详情页使用。",
  "outputCount": 4,
  "provider": "volcengine"
}
```

**Structured grouped request with explicit per-image prompts:**
```json
{
  "prompt": "同一款极简白色保温杯，整体风格统一，高级感、干净、真实、适合品牌官网和详情页使用。",
  "provider": "volcengine",
  "imageRequests": [
    "电商主图，白底，正面展示产品",
    "侧面细节图，突出杯盖和材质纹理",
    "手持使用场景图，突出尺寸感",
    "办公桌场景图，氛围高级"
  ]
}
```

## API Reference

### `generate_image` Tool

The server uses a two-stage process with separate models for each stage:
1. **Prompt Optimization** (Gemini 2.5 Flash): Refines your prompt using the Subject–Context–Style framework. Skippable via `SKIP_PROMPT_ENHANCEMENT`.
2. **Image Generation** (Nano Banana 2 or Pro): Creates the final image. Model varies by quality preset.

Use `generate_image` as the default tool for single-image generation and image editing. If the user wants multiple images in one grouped request, prefer `generate_multi_image`.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Text description or editing instruction |
| `provider` | string | - | Optional provider override: `gemini` or `volcengine`. Defaults to `IMAGE_PROVIDER` |
| `quality` | string | - | Quality preset: `fast` (default), `balanced`, `quality`. Overrides `IMAGE_QUALITY` env var for this request |
| `outputFormat` | string | - | Output image format if supported by the provider. Some provider endpoints may ignore or reject format overrides |
| `outputCount` | integer | - | Backward-compatible grouped output count for `generate_image`. For new multi-image requests, prefer `generate_multi_image` |
| `inputImagePath` | string | - | Absolute path to input image for image-to-image editing. Supported by Gemini and by Volcengine reference-image workflows |
| `inputImage` | string | - | Base64 encoded image data for image-to-image editing. Gemini accepts raw base64; Volcengine sends it as `data:image/<format>;base64,<data>` and uses `inputImageMimeType` to build the official request format |
| `inputImageMimeType` | string | - | MIME type of the input image (`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/bmp`). Required for correct Volcengine Data URL formatting when `inputImage` is provided |
| `inputImages` | array | - | Multiple input images for multi-image composition. Each item uses `{ data, mimeType }`; Volcengine converts them to `data:image/<format>;base64,<data>` entries in the `image` array |
| `inputImagePaths` | array | - | Multiple input image file paths for multi-image composition. Supported by Gemini and by Volcengine when mapped to reference-image arrays |
| `returnBase64` | boolean | - | Return the generated image as base64 data in the response. Image is always saved to disk regardless |
| `fileName` | string | - | Custom filename for output (auto-generated if not specified). Extension is auto-appended based on output format if omitted |
| `skipPromptEnhancement` | boolean | - | Skip prompt enhancement and use the prompt as-is. Recommended for multi-image blending. Overrides `SKIP_PROMPT_ENHANCEMENT` env var. Default: `false` |
| `aspectRatio` | string | - | `1:1` (default), `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`, `1:4`, `1:8`, `4:1`, `8:1` |
| `imageRequests` | array | - | Backward-compatible per-image prompts for `generate_image`. For new grouped multi-image requests, prefer `generate_multi_image` |
| `imageSize` | string | - | `1K`, `2K`, `4K`. Leave unspecified for standard quality |
| `blendImages` | boolean | - | Enable multi-image blending for combining multiple visual elements naturally |
| `maintainCharacterConsistency` | boolean | - | Maintain character appearance consistency across different poses and scenes |
| `useWorldKnowledge` | boolean | - | Use real-world knowledge for accurate context (historical figures, landmarks, factual scenarios) |
| `useGoogleSearch` | boolean | - | Enable Google Search grounding for real-time factual accuracy |
| `purpose` | string | - | Intended use (e.g., "cookbook cover", "social media post"). Helps tailor visual style and details |

### `generate_multi_image` Tool

Use `generate_multi_image` for grouped multi-image generation in a single tool call. This is the preferred entry for Notebook planners that might otherwise split one user request into multiple `generate_image` calls.

#### Recommended patterns

- Use `outputCount` when the user wants multiple images with shared overall constraints.
- Use `imageRequests` when the user wants several distinct images in one grouped request.
- If `outputCount` is omitted, the server will try to infer it from phrases such as `4张图`, `四张海报`, or `4 images`.

#### Example

```json
{
  "prompt": "请生成4张统一风格的电商产品图，主题都是同一款极简白色保温杯，分别覆盖主图、侧面细节、手持使用场景、办公桌场景。要求返回4张独立图片，不要拆成多次生成。",
  "provider": "volcengine"
}
```

#### Response

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///path/to/generated/image.png",
    "name": "image-filename.png",
    "mimeType": "image/png"
  },
  "metadata": {
    "model": "gemini-3.1-flash-image-preview",
    "processingTime": 5000,
    "timestamp": "2026-01-01T12:00:00.000Z"
  }
}
```

## Troubleshooting

### Common Issues

**"API key not found"**
- Ensure `GEMINI_API_KEY` is set in your environment
- Verify the API key is valid and has image generation permissions

**"Input image file not found"**
- Use absolute file paths, not relative paths
- Ensure the file exists and is accessible
- Supported formats: PNG, JPEG, WebP (max 10MB)

**"No image data found in Gemini API response"**
- Try rephrasing your prompt with more specific details
- Ensure your prompt is appropriate for image generation
- Check if your API key has sufficient quota

### Performance Tips

- `fast` preset: ~30–40 seconds typical (includes prompt optimization)
- `balanced` preset: Slightly longer due to enhanced thinking
- `quality` preset: Slower but highest fidelity output
- High-resolution (2K/4K): Additional processing time for superior detail
- Simple prompts work great — the optimizer automatically adds professional details
- Complex prompts are preserved and further enhanced
- Consider `useWorldKnowledge` for historical or factual subjects
- Use `imageSize: "4K"` when text clarity and fine details are critical

## Usage Notes

- This MCP server uses the paid Gemini API:
  - **Prompt optimization**: Gemini 2.5 Flash (minimal token usage)
  - **Image generation**: Model depends on quality preset
    - `fast` / `balanced`: Nano Banana 2 — Gemini 3.1 Flash Image (lower cost)
    - `quality`: Nano Banana Pro — Gemini 3 Pro Image (higher cost)
  - `balanced` uses additional thinking tokens (slightly higher cost than `fast`)
- Check current pricing and rate limits at [Google AI Studio](https://aistudio.google.com/)
- Monitor your API usage to avoid unexpected charges
- The prompt optimization step adds minimal cost while significantly improving output quality

## Local Development

If you want to test a local build (e.g., after cloning the repo or making changes), follow these steps instead of using `npx`.

### 1. Build the Project

```bash
cd /path/to/mcp-hydrocoder-image
npm install
npm run build
```

### 2. Configure the MCP Server

Add the following to your MCP configuration file, pointing directly to the local `dist/index.js`:

- **Claude Code**: `~/.claude.json`
- **Cursor**: `~/.cursor/mcp.json` or `.cursor/mcp.json`
- **Codex**: `~/.codex/config.toml`

**Claude Code / Cursor (JSON):**

```json
{
  "mcp-hydrocoder-image": {
    "command": "node",
    "args": ["/absolute/path/to/mcp-hydrocoder-image/dist/index.js"],
    "env": {
      "GEMINI_API_KEY": "your_gemini_api_key_here",
      "IMAGE_OUTPUT_DIR": "/absolute/path/to/output"
    }
  }
}
```

> **Proxy users**: If you need a proxy, add `HTTPS_PROXY` and `HTTP_PROXY` to the `env` section.

### 3. Allow Tool Permissions (Claude Code)

To skip the permission prompt on every call, add the tool to your allow list in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__mcp-hydrocoder-image__generate_image"
    ]
  }
}
```

### 4. Restart and Test

Restart your AI tool to load the new MCP server, then try:

```
"Generate a serene mountain landscape at sunset"
```

If the image is saved to your `IMAGE_OUTPUT_DIR`, the local setup is working correctly.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Need help?** [Open an issue](https://github.com/ynzys/mcp-hydrocoder-image/issues) or check the [troubleshooting section](#troubleshooting) above.
