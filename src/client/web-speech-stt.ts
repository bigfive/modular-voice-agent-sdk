/**
 * Web Speech STT (Browser Speech Recognition)
 *
 * Uses the browser's native SpeechRecognition API for speech-to-text.
 * Client-side only - sends text to server instead of audio.
 */

export interface WebSpeechSTTConfig {
  /** Language code (e.g., 'en-US', 'en-GB') */
  language?: string;
  /** Whether to return interim results while speaking */
  interimResults?: boolean;
  /** Maximum alternatives to return */
  maxAlternatives?: number;
}

export type WebSpeechSTTResult = {
  transcript: string;
  isFinal: boolean;
  confidence: number;
};

// Cross-browser SpeechRecognition
const SpeechRecognition =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

/**
 * Detect if browser is Brave (blocks WebSpeech for privacy)
 */
function isBraveBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as any).brave !== undefined;
}

export class WebSpeechSTT {
  private config: Required<WebSpeechSTTConfig>;
  private recognition: any = null;
  private isListening = false;
  private onResultCallback: ((result: WebSpeechSTTResult) => void) | null = null;
  private onEndCallback: (() => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;

  constructor(config: WebSpeechSTTConfig = {}) {
    this.config = {
      language: config.language ?? 'en-US',
      interimResults: config.interimResults ?? false,
      maxAlternatives: config.maxAlternatives ?? 1,
    };
  }

  /**
   * Check if Web Speech API is available.
   * Note: This only checks if the API exists, not if it will work.
   * Brave has the API but blocks it for privacy. Use isBraveBlocked() to check.
   */
  static isSupported(): boolean {
    return SpeechRecognition !== null;
  }

  /**
   * Check if the browser is Brave, which has the WebSpeech API but blocks it
   * for privacy reasons (it connects to Google servers).
   */
  static isBraveBlocked(): boolean {
    return isBraveBrowser();
  }

  /**
   * Check if WebSpeech STT is actually usable (API exists and not blocked)
   */
  static isUsable(): boolean {
    return WebSpeechSTT.isSupported() && !WebSpeechSTT.isBraveBlocked();
  }

  /**
   * Check if currently listening
   */
  get listening(): boolean {
    return this.isListening;
  }

  /**
   * Set callback for speech results
   */
  onResult(callback: (result: WebSpeechSTTResult) => void): void {
    this.onResultCallback = callback;
  }

  /**
   * Set callback for when recognition ends
   */
  onEnd(callback: () => void): void {
    this.onEndCallback = callback;
  }

  /**
   * Set callback for errors
   */
  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Start listening for speech
   */
  start(): void {
    if (!SpeechRecognition) {
      this.onErrorCallback?.(new Error('Web Speech API not supported in this browser'));
      return;
    }

    // Warn about Brave browser blocking
    if (isBraveBrowser()) {
      this.onErrorCallback?.(new Error(
        'WebSpeech STT is blocked in Brave browser for privacy reasons. ' +
        'Brave blocks connections to Google\'s speech recognition servers. ' +
        'Try using Chrome, Edge, or Safari, or use a different STT backend like TransformersSTT.'
      ));
      return;
    }

    if (this.isListening) return;

    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.config.language;
    this.recognition.interimResults = this.config.interimResults;
    this.recognition.maxAlternatives = this.config.maxAlternatives;
    this.recognition.continuous = false; // Single utterance mode

    this.recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const alternative = result[0];

      this.onResultCallback?.({
        transcript: alternative.transcript,
        isFinal: result.isFinal,
        confidence: alternative.confidence,
      });
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onEndCallback?.();
    };

    this.recognition.onerror = (event: any) => {
      this.isListening = false;
      // Map common error types to helpful messages
      const errorMessages: Record<string, string> = {
        'not-allowed': 'Microphone permission denied. Please allow microphone access.',
        'network': 'Network error - speech recognition service unavailable. This may be blocked by your browser or ad blocker.',
        'service-not-allowed': 'Speech recognition service not allowed. This browser may block speech recognition for privacy.',
        'audio-capture': 'No microphone found. Please connect a microphone and try again.',
        'language-not-supported': `Language "${this.config.language}" is not supported for speech recognition.`,
      };

      // 'no-speech' and 'aborted' are not really errors worth reporting
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        const message = errorMessages[event.error] || `Speech recognition error: ${event.error}`;
        this.onErrorCallback?.(new Error(message));
      }
    };

    this.isListening = true;

    try {
      this.recognition.start();
    } catch (err) {
      this.isListening = false;
      this.onErrorCallback?.(new Error(
        `Failed to start speech recognition: ${err instanceof Error ? err.message : String(err)}`
      ));
    }
  }

  /**
   * Stop listening
   */
  stop(): void {
    if (!this.isListening || !this.recognition) return;
    this.recognition.stop();
    this.isListening = false;
  }

  /**
   * Abort recognition (doesn't return results)
   */
  abort(): void {
    if (!this.recognition) return;
    this.recognition.abort();
    this.isListening = false;
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.abort();
    this.recognition = null;
    this.onResultCallback = null;
    this.onEndCallback = null;
    this.onErrorCallback = null;
  }
}

