# Changelog

All notable changes to this project will be documented in this file.

---

## [2.10.0] - 2026-03-31

### Added
- `VoiceClient.sendText()` for text-only messages (per-request `skipTTS`)
- `modular-voice-agent-sdk/ui` subpath with `ChatRenderer` and related types
- New examples:
  - `example-12-ui-demo`
  - `example-13-browser-agent-speech`

### Fixed
- `WebSpeechTTS` voice loading race condition
- Voice invalidation after `speechSynthesis.cancel()`

---

## [2.9.3] - 2026-02-27

### Fixed
- Sentence splitter handling of decimals and abbreviations

---

## [2.9.2] - 2026-02-27

### Fixed
- Post-build script now adds `.js` extensions for Node ESM compatibility

---

## [2.9.1] - 2026-02-19

### Fixed
- `tts: null` now correctly disables TTS (previously fell back to default backend)

---

## [2.9.0] - 2026-02-19

### Added
- Session-level `wantsTTS` flag to globally disable TTS

---

## [2.8.0] - 2026-02-19

### Added
- `recording_start` protocol message (required before sending audio)
- `PipelineSession` busy state machine (`idle` → `recording` → `processing`)
- Recording timeout configuration
- `PipelineSession.injectFromServer(text)`

---

## [2.7.0] - 2026-02-18

### Breaking
- `connect()` now waits for full session initialization (configurable timeout)

### Fixed
- `isReady()` now validates session initialization state

---

## [2.6.2] - 2026-02-18

### Added
- Convenience APIs:
  - `encodeWav()`
  - `synthesizeToWav()`
  - Model/cache inspection APIs
- Programmatic setup API (`modular-voice-agent-sdk/setup`)

---

## [2.6.1] - 2026-02-18

### Changed
- Reduced and standardized pipeline logging

---

## [2.6.0] - 2026-02-17

### Added
- Transport abstraction layer (`Transport` interface)
- `HttpSseTransport`
- `getTransport()` method

### Deprecated
- `getWebSocket()`

---

## [2.5.1] - 2026-02-17

### Fixed
- Protocol types now exported from server package

---

## [2.5.0] - 2026-02-17

### Added
- Agent SDK backend (`AgentLLM`)
- Custom text replacement rules
- Pipeline cancellation support

### Fixed
- Empty LLM responses with `end_turn` handled correctly
- Empty assistant messages excluded from history

---

## [2.4.0] - 2026-02-17

### Added
- Custom text replacement rules
- Pipeline cancellation support

### Fixed
- Empty response handling improvements
- Conversation history cleanup

---

## [2.3.0] - 2026-01-16

### Added
- `VoiceClient.isSpeaking` and `stopSpeaking()`

---

## [2.2.1] - 2026-01-15

### Fixed
- Improved `responseId` grouping for streaming segments

---

## [2.2.0] - 2026-01-15

### Added
- `EventMeta` for request/response correlation

---

## [2.1.0] - 2026-01-15

### Added
- `getWebSocket()` access

---

## [2.0.0] - 2026-01-15

### Breaking
- WebSocket protocol now uses envelope format (`ClientEnvelope`, `ServerEnvelope`)
- Introduced `session_init` message
- ULID-based ID system (`sessionId`, `requestId`, `responseId`)

→ See `/docs/migration/v2.md`

---

## [1.4.1] and earlier

See git history.