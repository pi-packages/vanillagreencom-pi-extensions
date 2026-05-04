# pi-web-tools

First-party Pi package for web access tools.

Implemented in this package:

- `web_search` with provider selection (`auto`, `exa`, `openai-native`, `perplexity`, `gemini`). Direct execution is implemented for Exa; OpenAI-native is handled by a `before_provider_request` rewrite on supported OpenAI/Codex models.
- `web_research` using Exa Deep Search types: `deep-reasoning`, `deep-lite`, and `deep`.
- `web_research.outputPath` findings report writing with Pi's file mutation queue.
- `web_fetch` through Exa `contents`.
- `web_answer`, `web_find_similar`, `code_search` Exa-first tools.
- `get_web_content` retrieval for stored full content.
- `/web-tools doctor` and `/web-tools provider ...` guidance.

Staged for follow-up parity with `pi-web-access`:

- Perplexity/Gemini direct search execution.
- Readability/Jina/Gemini fallback extraction chain.
- PDF-to-markdown conversion.
- GitHub clone/API extraction cache.
- YouTube/local video understanding.
- Browser curator UI and activity monitor.

## Settings

Settings are read from the vstack extension-manager namespace:

```json
{
  "vstack": {
    "extensionManager": {
      "config": {
        "pi-web-tools": {
          "defaultProvider": "auto",
          "enabledProviders": "exa,openai-native,perplexity,gemini"
        }
      }
    }
  }
}
```

Secrets should be supplied with environment variables or a private config file:

- `EXA_API_KEY`
- `PERPLEXITY_API_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `PI_WEB_TOOLS_CONFIG_FILE=/path/to/private.json`

Shared Pi settings keys such as `exaApiKey` are loaded for compatibility but emit a warning.

API key values may be direct keys or 1Password references such as `op://Private/Exa API Key/credential` when the `op` CLI is installed and signed in.

## Migration

`web_search` moved here from `pi-codex-minimal-tools`. Install both updated packages together; `pi-codex-minimal-tools` now owns only `image_generation`, `view_image`, and `apply_patch`.

## Attribution

This implementation was designed after reviewing the MIT-licensed Pi web-access and Exa extension patterns referenced in the project implementation plan. No source code was copied verbatim.
