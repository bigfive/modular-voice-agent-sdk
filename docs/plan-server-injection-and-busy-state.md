# Plan: Server Injection + Busy State with Timeout

## Goal

1. **Server knows when session is busy** — recording (push-to-talk held), processing (STT→LLM→TTS), or idle
2. **Timeout for interrupted streams** — if client never sends `end_audio`, server doesn't stay busy forever
3. **Server can inject messages** — so responses can be spoken when a voice client is connected (e.g. parent agent notification)

---

## 1. Protocol Changes

### 1.1 New client message: `recording_start`

**File:** `src/client/protocol.ts`

```ts
export type RecordingStartMessage = {
  type: 'recording_start';
};

export type ClientMessage =
  | AudioMessage
  | EndAudioMessage
  | RecordingStartMessage  // NEW
  | ClearHistoryMessage
  | TextMessage
  | CapabilitiesMessage;
```

**When client sends:** On `startRecording()` — before first `audio` chunk. Signals "user pressed push-to-talk".

**Why:** Server needs explicit start so it can:
- Mark session as "recording" (busy)
- Start timeout timer (in case `end_audio` never arrives)

**Strict:** Server expects `recording_start` before `audio`. If `audio` arrives without a prior `recording_start` for this session, treat as protocol error (discard or error). No fallback.

---

## 2. PipelineSession: Busy State

### 2.1 State machine

```
idle
  ↑
  | recording_start or first audio
  ↓
recording  ←─── timeout (silence or max duration)
  ↑
  | end_audio
  ↓
processing  (STT → LLM → TTS)
  ↑
  | complete / error
  ↓
idle
```

### 2.2 New properties and config

**File:** `src/server/handler.ts`

```ts
// In PipelineSession
private busyState: 'idle' | 'recording' | 'processing' = 'idle';
private recordingStartedAt: number | null = null;
private lastAudioAt: number | null = null;
private busyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

// Config (constructor or static)
private static readonly SILENCE_TIMEOUT_MS = 5000;   // no audio for 5s = stream died
private static readonly MAX_RECORDING_MS = 90000;    // 90s max hold
```

### 2.3 Timeout logic

**Silence timeout:** If we're in `recording` and haven't received `audio` for 5s, assume stream interrupted (network drop, client crash). Force-end: clear `audioChunks`, set `busyState = 'idle'`, clear timer.

**Max recording timeout:** If we've been in `recording` for 90s total, force-end. Handles "user held forever" or stuck client.

**Implementation:**
- On `recording_start` or first `audio`: set `recordingStartedAt`, `lastAudioAt`, `busyState = 'recording'`, call `scheduleBusyTimeout()`
- On each `audio`: update `lastAudioAt`, call `scheduleBusyTimeout()` (reset silence timer)
- On `end_audio`: clear timeout, set `busyState = 'processing'`, process as now
- `scheduleBusyTimeout()`: clear existing timer, set new one for `min(silenceTimeout, maxRecording - elapsed)`
- When timeout fires: `forceEndRecording()` — clear chunks, set idle, optionally log

### 2.4 Public API

```ts
/** True while receiving audio, processing a turn, or waiting for pipeline. */
isBusy(): boolean {
  return this.busyState !== 'idle';
}

/** Subscribe to idle transitions. Returns unsubscribe. */
onIdle(callback: () => void): () => void;
```

### 2.5 Handler changes

**In `handle()`:**
- `case 'recording_start'`: set recording state, schedule timeout, `break` (no yield)
- `case 'audio'`: push chunk, update `lastAudioAt`, schedule timeout, `break`
- `case 'end_audio'`: clear timeout, set `busyState = 'processing'`, then `yield* this.processAudio()`. When `processAudio` completes (via `runPipeline`), set `busyState = 'idle'`, fire `onIdle`
- `case 'text'`: set `busyState = 'processing'`, process. When done, set `busyState = 'idle'`, fire `onIdle`

**In `runPipeline`:** When `onComplete` or `onError` fires, set `busyState = 'idle'`, fire `onIdle` callbacks.

---

## 3. PipelineSession: Server Injection

### 3.1 API

```ts
/**
 * Inject a message from the server (e.g. system notification).
 * Runs through the pipeline (LLM → TTS) and yields to the same output as client messages.
 *
 * @param message - Text to inject (treated as user message)
 * @param options - { queue: true } to wait until idle, then run. Default: run immediately if idle, else reject/queue based on implementation
 * @returns true if accepted (queued or running), false if rejected (e.g. busy and no queue)
 */
injectFromServer(
  message: { type: 'text'; text: string },
  options?: { queue?: boolean }
): boolean | Promise<boolean>;
```

### 3.2 Design choice: queue in SDK vs transport

**Option A: Queue in SDK** — `PipelineSession` maintains a queue. When `injectFromServer` is called and busy, push to queue. When `onIdle` fires, process next. Simpler for consumers.

**Option B: Queue in transport** — Transport checks `isBusy()`, maintains its own queue, calls `injectFromServer` when idle. SDK stays minimal.

**Recommendation:** Option A. SDK owns the session lifecycle; queueing is session-scoped. Transport just calls `injectFromServer` and doesn't need to track busy or manage a queue.

### 3.3 Implementation (with queue)

```ts
private injectQueue: Array<{ text: string }> = [];

injectFromServer(message: { type: 'text'; text: string }, options?: { queue?: boolean }): boolean {
  if (this.destroyed) return false;

  if (!this.isBusy()) {
    this.processInjectedText(message.text);
    return true;
  }

  if (options?.queue) {
    this.injectQueue.push(message);
    return true;
  }

  return false;
}

private async processInjectedText(text: string): Promise<void> {
  this.busyState = 'processing';
  // ... run processText, yield to... we need an output callback
}
```

**Problem:** `processText` yields to the caller. For client messages, the transport's `for await` loop receives yields and sends to WebSocket. For server injection, we need to send to the same WebSocket. So `injectFromServer` can't be fire-and-forget — it needs to know where to send responses.

**Options:**
1. **`injectFromServer` takes a `send` callback** — `injectFromServer(text, { send: (msg) => sendEnvelope(ws, ...) })`
2. **`injectFromServer` returns an async generator** — caller iterates and sends. Same pattern as `handle()`.
3. **Session holds a reference to "output sink"** — set by transport when creating session. Session calls sink when yielding. Couples session to transport.

**Recommendation:** Option 2. `injectFromServer` returns `AsyncGenerator<ServerMessage>`. The transport (or whoever has the WebSocket) iterates and sends. Keeps session pure.

```ts
async *injectFromServer(message: { type: 'text'; text: string }): AsyncGenerator<ServerMessage> {
  if (this.destroyed) return;
  if (this.isBusy()) {
    // Could throw or return empty — caller decides to queue
    throw new Error('Session is busy');
  }
  this.busyState = 'processing';
  try {
    yield* this.processText(message.text);
  } finally {
    this.busyState = 'idle';
    this.fireIdleCallbacks();
    this.processInjectQueue();
  }
}

private processInjectQueue(): void {
  if (this.injectQueue.length === 0 || this.isBusy()) return;
  const next = this.injectQueue.shift()!;
  // Can't easily recurse here — processText is async generator
  // Need to emit or schedule. For now, leave queue processing to caller.
}
```

**Simpler approach:** Don't put queue in SDK. SDK provides:
- `isBusy()`
- `injectFromServer(text)` → returns `AsyncGenerator<ServerMessage>` or throws if busy

Transport/consumer does:
- If busy, push to own queue
- On `onIdle`, pop from queue, call `injectFromServer`, iterate and send

That keeps SDK minimal. Plan updated.

### 3.4 Final inject API

```ts
/**
 * Inject a text message from the server. Runs through pipeline (LLM → TTS).
 * Yields ServerMessage — caller must iterate and send to client (e.g. WebSocket).
 *
 * @throws Error if session is busy (check isBusy() first, or queue externally)
 */
async *injectFromServer(text: string): AsyncGenerator<ServerMessage>;
```

---

## 4. Client Changes

### 4.1 Send `recording_start` on startRecording

**File:** `src/client/voice-client.ts`

In `startRecording()`, when using `recorder` (server STT path):

```ts
} else if (this.recorder) {
  await this.recorder.start();
  this.send({ type: 'recording_start' });  // NEW: before any audio
}
```

**Order:** `recorder.start()` then `send(recording_start)`. The recorder's `onChunk` will fire as audio arrives — those send `audio` messages. So `recording_start` arrives before first `audio`.

**WebSpeechSTT path:** No `recording_start` — client does STT locally, sends `text`. Server never receives audio. So no change.

**MediaRecorder path (local STT):** No server audio. No change.

---

## 5. Transport Integration (Sparkbox)

The Sparkbox voice transport will:

1. **Track active sessions:** `Map<sparkboxSessionId, { ws, pipelineSession }>`
2. **Expose `injectVoiceMessage(sessionId, text)`:** Look up session, check `isBusy()`, if idle call `injectFromServer(text)` and iterate/send to ws
3. **Queue if busy:** Maintain `Map<sessionId, string[]>` queue. On `session.onIdle()`, process next queued message

This lives in Sparkbox, not the SDK. SDK just provides `isBusy()`, `onIdle()`, `injectFromServer()`.

---

## 6. Files to Modify

| File | Changes |
|------|---------|
| `src/client/protocol.ts` | Add `RecordingStartMessage`, extend `ClientMessage` |
| `src/server/handler.ts` | Busy state, timeout, `isBusy()`, `onIdle()`, `injectFromServer()`, handle `recording_start` |
| `src/client/voice-client.ts` | Send `recording_start` in server-STT path |

---

## 7. Implementation Order

1. **Protocol** — Add `recording_start` to protocol.ts
2. **Handler busy state** — Add state machine, timeout logic, `isBusy()`, `onIdle()` in handler.ts
3. **Handler recording_start** — Handle new message type, wire into busy state
4. **Client** — Send `recording_start` in voice-client.ts
5. **Handler injectFromServer** — Add method, ensure it runs through same pipeline path as `processText`
6. **Tests** — Timeout behavior, busy state transitions, inject when idle vs busy

---

## 8. Edge Cases

| Case | Behavior |
|------|----------|
| Client sends `audio` without `recording_start` | Protocol error — discard audio or yield error. No fallback. |
| Timeout fires during recording | `forceEndRecording()`: clear chunks, set idle. Don't process partial audio (discard). |
| `injectFromServer` while busy | Throw (or return false). Caller queues. |
| Session destroyed during inject | `destroyed` check at start; generator exits early if destroyed mid-run |
| Multiple rapid `injectFromServer` | Caller serializes via queue. SDK processes one at a time. |

---

## 9. Configurability

Timeout values could be configurable:

```ts
export interface PipelineHandlerConfig {
  /** Silence timeout: no audio for this many ms = stream interrupted (default: 5000) */
  silenceTimeoutMs?: number;
  /** Max recording duration in ms (default: 90000) */
  maxRecordingMs?: number;
}
```

Pass through to `PipelineSession` via `PipelineHandler` constructor.
