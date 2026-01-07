# DONE: Per-Pipeline Model Store

✅ **Implemented in `refactor/single-factory-pattern` branch**

## Summary

Each `VoicePipeline` and `VoiceClient` now owns its own model store (`Map<string, unknown>`), passed to the factory function when creating components. This replaces the global singleton cache pattern for Transformers backends.

## How It Works

1. **Pipeline owns the store:**
   ```typescript
   export class VoicePipeline {
     private modelStore: ModelStore = new Map();
     
     async initialize() {
       // Factory receives store - first call populates cache
       this.components = this.factory(this.modelStore);
       // ...
     }
     
     async createSessionBackends() {
       // Same store passed - finds cached models
       const components = this.factory(this.modelStore);
       // ...
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

3. **Backends use the store for caching:**
   ```typescript
   export class TransformersLLM implements LLMPipeline {
     constructor(config: TransformersLLMConfig, modelStore?: ModelStore) {
       this.modelStore = modelStore;
     }
   
     async initialize() {
       const cacheKey = `transformers-llm:${model}:${dtype}:${device}`;
       
       if (this.modelStore?.has(cacheKey)) {
         this.pipe = this.modelStore.get(cacheKey);
       } else {
         this.pipe = await pipeline('text-generation', ...);
         this.modelStore?.set(cacheKey, this.pipe);
       }
     }
   }
   ```

## Backwards Compatibility

- **modelStore is optional** - backends fall back to global `getCachedOrLoad` if not provided
- Native/Cloud backends ignore the store (they don't need caching)
- Simple examples can use `(/* modelStore */)` to acknowledge but ignore the parameter

## Benefits Achieved

| Aspect | Before (Global) | After (Per-Pipeline) |
|--------|-----------------|----------------------|
| Scope | Process-wide singleton | Instance-scoped |
| Lifecycle | Persists forever | GC'd with pipeline |
| Independence | All pipelines share | Each pipeline isolated |
| API | Multiple factory functions | Single unified factory |

## Files Changed

- `src/voice-pipeline.ts` - Added `ModelStore` type and `modelStore` field
- `src/client/voice-client.ts` - Added `modelStore` field, pass to factory
- `src/backends/transformers/*.ts` - Accept optional `modelStore`, use for caching
- `src/index.ts`, `src/client/index.ts` - Export `ModelStore` type
- All examples - Updated to new factory signature
