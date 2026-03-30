# TTS Control

The SDK provides multiple levels of control over text-to-speech behavior.

## Session-level: `wantsTTS`

Disable TTS globally for a session:

```ts
client.setWantsTTS(false);
````

* Applies to all future messages
* Synced to server automatically

## Request-level: `skipTTS`

Disable TTS for a single message:

```ts
client.sendText("Hello", { skipTTS: true });
```

## Behavior Summary

| Setting    | Scope       | Effect            |
| ---------- | ----------- | ----------------- |
| `wantsTTS` | Session     | Global default    |
| `skipTTS`  | Per-request | Overrides session |