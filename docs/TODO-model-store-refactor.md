# DONE: Per-Pipeline Model Store

✅ **Implemented in `refactor/single-factory-pattern` branch**

## Summary

Each `VoicePipeline` and `VoiceClient` now owns its own model store (`Map<string, unknown>`), passed to the factory function when creating components. Transformers backends **require** a `modelStore` - no fallback to global cache.

## How It Works

1. **Pipeline owns the store:**
   ```typescript
   export class VoicePipeline {
     private modelStore: ModelStore = new Map();

     async initialize() {
       // Factory receives store - first call populates cache
       this.components = this.factory(this.modelStore);
     }

     async createSessionBackends() {
       // Same store passed - finds cached models
       const components = this.factory(this.modelStore);
     }
   }
   ```

2. **Factory receives the store:**
   ```typescript
   createVoicePipeline({
     create: (modelStore) => ({
       stt: new TransformersSTT(sttConfig, modelStore),
       llm: new TransformersLLM(llmConfig, modelStore),
       tts: new TransformersTTS(ttsConfig, modelStore),
       systemPrompt: 'You are a helpful assistant.',
     }),
   });
   ```

3. **Backends require the store (no fallback):**
   ```typescript
   export class TransformersLLM implements LLMPipeline {
     constructor(config: TransformersLLMConfig, modelStore: ModelStore) {
       this.modelStore = modelStore;  // Required!
     }

     async initialize() {
       const cacheKey = `transformers-llm:${model}:${dtype}:${device}`;

       if (this.modelStore.has(cacheKey)) {
         this.pipe = this.modelStore.get(cacheKey);
       } else {
         this.pipe = await pipeline('text-generation', ...);
         this.modelStore.set(cacheKey, this.pipe);
       }
     }
   }
   ```

## Design Decisions

- **modelStore is required** for Transformers backends - no global fallback
- **Global cache-runtime.ts deleted** - no more process-wide singleton
- Native/Cloud backends ignore the store (they don't need caching)
- Client examples that don't use Transformers can use `(/* modelStore */)` to ignore the parameter

## Benefits

| Aspect | Before (Global) | After (Per-Pipeline) |
|--------|-----------------|----------------------|
| Scope | Process-wide singleton | Instance-scoped |
| Lifecycle | Persists forever | GC'd with pipeline |
| Independence | All pipelines share | Each pipeline isolated |
| Complexity | Fallback logic | Clean, required param |

## Files Changed

- `src/voice-pipeline.ts` - Added `ModelStore` type and `modelStore` field
- `src/client/voice-client.ts` - Added `modelStore` field, pass to factory
- `src/backends/transformers/*.ts` - **Require** `modelStore`, no fallback
- `src/cache-runtime.ts` - **Deleted** (no longer needed)
- `src/cache.ts` - Removed re-exports of runtime cache functions
- All examples - Updated to pass `modelStore` to Transformers backends
