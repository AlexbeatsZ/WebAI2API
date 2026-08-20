# Site drivers

## Public identity

Every public model ID has exactly one shape: `<site-id>/<model-id>`. A website has one public site identity even if internal legacy adapters use different workflows. Examples are `gemini-web/gemini-3.1-pro`, `chatgpt-web/gpt-thinking`, and `ai-studio/gemini-3.1-pro`.

## Driver contract

A site definition owns its entry URL, internal adapter priority, model aggregation, capabilities, optional live discovery, and error classification. Driver selection is internal. It is never encoded as a user-visible text/image category.

Static manifests seed startup. An initialized page may discover current model labels and refresh a timestamped last-good cache. Selecting an unavailable requested model fails with `model_unavailable`; it must not silently use the webpage default.

## Messages and media

All OpenAI messages are compiled in order. System content is returned separately for drivers with a native system-instruction control. The remaining transcript contains every prior user and assistant turn plus the current input. Image validation uses model input capabilities only; output capabilities never cause history to be discarded.

Text and configured Markdown media responses retain the existing OpenAI-compatible response shape.
