# Migration Guide: v2.0

## Overview

v2 introduces a new WebSocket protocol with structured envelopes and request/response tracking.

---

## Key Changes

### 1. Envelope Format

All messages are now wrapped:

#### Client → Server

```json
{
  "sessionId": "...",
  "requestId": "...",
  "message": { ... }
}
````

#### Server → Client

```json
{
  "sessionId": "...",
  "requestId": "...",
  "responseId": "...",
  "message": { ... }
}
```

---

### 2. Session Initialization

A `session_init` message is sent on connection.

Clients must wait for this before sending messages.

---

### 3. ID System

ULID-based IDs:

* `sessionId`
* `requestId`
* `responseId`

---

## If Using VoiceClient

No changes required.

---

## If Using Custom WebSocket

### Required Changes

* Wrap outgoing messages in `ClientEnvelope`
* Unwrap incoming `ServerEnvelope`
* Handle `session_init`

---

## New Types

* `ClientEnvelope`
* `ServerEnvelope`
* `SessionInitMessage`
* `generateId()`

---

## Summary

This change improves:

* Debuggability
* Request tracing
* Streaming consistency