# Text Messages (skip TTS)

The SDK supports sending text through the voice pipeline without triggering speech synthesis.

## Overview

Use `VoiceClient.sendText()` to send a message that will return a **text-only response**.

This bypasses TTS while still using the full pipeline (LLM, tools, etc.).

## Example

```ts
client.sendText("Hello world");
````

## Per-request Control

You can disable TTS per message using:

```ts
{ skipTTS: true }
```

## Behavior

* TTS is skipped for this request only
* LLM + tools still execute normally
* Works in both client/server and local pipelines

## Related

* `wantsTTS` (session-level control)

````

------------------------------------------------------------

# 3. 🎨 New doc: `docs/ui/chat-renderer.md`

------------------------

```
# ChatRenderer

`ChatRenderer` is a prebuilt UI component for rendering voice agent conversations.

## Import

```ts
import { ChatRenderer } from "modular-voice-agent-sdk/ui";
````

## Features

* Message bubbles
* Thinking / intermediate states
* Tool call display with loading states
* Expandable tool detail views
* Auto-scroll with smart follow
* Link detection
* Light / dark theme support (CSS variables)

## Types

* `ChatRendererOptions`
* `ContentBlock`
* `MessageData`
* `ToolCallInfo`
* `ToolDetailContent`
* `VoiceClientStatus`

## Use Cases

* Debugging agent behavior
* Rapid prototyping
* Internal tools

## Styling

The component uses CSS custom properties for theming.
