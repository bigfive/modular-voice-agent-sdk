# TODO: Refactor Global Cache to Per-Pipeline Model Store

## Current State

Backends use a **global singleton cache** (`runtimeCache` in `cache.ts`) with magic string keys:

```typescript
// cache.ts - process-wide singleton
const runtimeCache = new Map<string, unknown>();

// Backend builds magic key string
const cacheKey = `transformers-llm:${model}:${dtype}:${device}`;
this.pipe = await getCachedOrLoad(cacheKey, async () => { ... });
```

**Problems:**
- Global state shared across all pipelines in the process
- Magic string keys are fragile and hard to maintain
- Cache persists even after pipelines are destroyed (memory leak potential)
- Two pipelines with same config unintentionally share state

## Proposed: Per-Pipeline Model Store

Each `VoicePipeline` instance owns its own model stores (one per slot):

```typescript
// VoicePipeline
private sttModelStore = new Map<string, unknown>();
private llmModelStore = new Map<string, unknown>();
private ttsModelStore = new Map<string, unknown>();

// Factory signature changes
type BackendFactory<T> = (modelStore: Map<string, unknown>) => T;
```

**User code:**
```typescript
const pipeline = new VoicePipeline({
  stt: (modelStore) => new TransformersSTT(CONFIG.stt, modelStore),
  llm: (modelStore) => new TransformersLLM(CONFIG.llm, modelStore),
  tts: (modelStore) => new TransformersTTS(CONFIG.tts, modelStore),
  systemPrompt: CONFIG.systemPrompt,
});
```

**Backend code:**
```typescript
export class TransformersLLM implements LLMPipeline {
  constructor(
    private config: TransformersLLMConfig,
    private modelStore: Map<string, unknown>
  ) {}

  async initialize() {
    // Simple local key - no magic strings
    if (this.modelStore.has('pipe')) {
      this.pipe = this.modelStore.get('pipe');
      this.ready = true;
      return;
    }

    this.pipe = await pipeline('text-generation', this.config.model, ...);
    this.modelStore.set('pipe', this.pipe);
    this.ready = true;
  }
}
```

## Why It's Better

| Aspect | Current (Global) | Proposed (Per-Pipeline) |
|--------|------------------|-------------------------|
| Scope | Process-wide singleton | Instance-scoped |
| Keys | Magic strings: `transformers-llm:model:dtype:device` | Simple: `'pipe'` |
| Lifecycle | Persists forever | GC'd with pipeline |
| Independence | All pipelines share | Each pipeline independent |
| Coupling | Backends import global `getCachedOrLoad` | Backends just use a Map |

## Changes Required

1. **`cache.ts`**: Remove `runtimeCache` and `getCachedOrLoad` (or keep for file/binary caching only)

2. **`voice-pipeline.ts`**:
   - Add `sttModelStore`, `llmModelStore`, `ttsModelStore` instance fields
   - Update `BackendFactory<T>` type to `(modelStore: Map<string, unknown>) => T`
   - Pass model store when calling factories

3. **All Transformers backends** (`stt.ts`, `llm.ts`, `tts.ts`):
   - Add `modelStore` constructor parameter
   - Replace `getCachedOrLoad` with simple Map get/set

4. **Native/Cloud backends**: No changes needed (they don't cache heavy resources)

5. **All examples**: Update factory syntax from `() => new Backend(config)` to `(modelStore) => new Backend(config, modelStore)`

## Trade-offs

- **Pro**: Cleaner architecture, proper encapsulation, no global state
- **Con**: Slightly more verbose factory syntax (`(modelStore) =>` instead of `() =>`)

