/**
 * Web Speech TTS (Browser Speech Synthesis)
 *
 * Uses the browser's native speechSynthesis API for text-to-speech.
 * Client-side only - speaks text directly without needing audio from server.
 */

export interface WebSpeechTTSConfig {
  /** Voice name (e.g., 'Samantha', 'Daniel', 'Martha') */
  voiceName?: string;
  /** Language code (e.g., 'en-US', 'en-GB') */
  language?: string;
  /** Speech rate (0.5 - 2.0, default 1.0) */
  rate?: number;
  /** Pitch (0.5 - 2.0, default 1.0) */
  pitch?: number;
  /** Volume (0.0 - 1.0, default 1.0) */
  volume?: number;
}

export class WebSpeechTTS {
  private config: Required<WebSpeechTTSConfig>;
  private voice: SpeechSynthesisVoice | null = null;
  private initialized = false;

  constructor(config: WebSpeechTTSConfig = {}) {
    this.config = {
      voiceName: config.voiceName ?? '',
      language: config.language ?? 'en',
      rate: config.rate ?? 1.0,
      pitch: config.pitch ?? 1.0,
      volume: config.volume ?? 1.0,
    };
  }

  /**
   * Check if Web Speech API is available
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * Get available voices
   */
  static getVoices(): SpeechSynthesisVoice[] {
    if (!WebSpeechTTS.isSupported()) return [];
    return speechSynthesis.getVoices();
  }

  /**
   * Initialize and select voice
   */
  async initialize(): Promise<void> {
    if (!WebSpeechTTS.isSupported()) {
      throw new Error('Web Speech API not supported');
    }

    await this.loadVoices();
    this.initialized = true;
  }

  private async loadVoices(): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;

      const tryLoad = () => {
        if (resolved) return false;
        const voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
          this.selectVoice(voices);
          resolved = true;
          resolve();
          return true;
        }
        return false;
      };

      // Try immediately
      if (tryLoad()) return;

      // Listen for voiceschanged (Chrome needs this)
      speechSynthesis.addEventListener('voiceschanged', () => {
        tryLoad();
      });

      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 1000);
    });
  }

  private selectVoice(voices: SpeechSynthesisVoice[]): void {
    // Try to find voice by name
    if (this.config.voiceName) {
      const byName = voices.find((v) =>
        v.name.toLowerCase().includes(this.config.voiceName.toLowerCase())
      );
      if (byName) {
        this.voice = byName;
        return;
      }
    }

    // Try to find by language
    if (this.config.language) {
      const byLang = voices.find((v) => v.lang.startsWith(this.config.language));
      if (byLang) {
        this.voice = byLang;
        return;
      }
    }

    // Fall back to default or first English voice
    this.voice =
      voices.find((v) => v.default) || voices.find((v) => v.lang.startsWith('en')) || voices[0] || null;
  }

  /**
   * Speak text
   */
  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!WebSpeechTTS.isSupported()) {
        reject(new Error('Web Speech API not supported'));
        return;
      }

      // Cancel any ongoing speech
      speechSynthesis.cancel();

      // Re-select voice from fresh list (cancel() can invalidate voice references)
      const voices = speechSynthesis.getVoices();
      if (voices.length > 0) {
        this.selectVoice(voices);
      }

      const utterance = new SpeechSynthesisUtterance(text);

      if (this.voice) {
        utterance.voice = this.voice;
        utterance.lang = this.voice.lang;
      }
      utterance.rate = this.config.rate;
      utterance.pitch = this.config.pitch;
      utterance.volume = this.config.volume;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        // 'canceled' is not an error (happens when we call stop())
        if (e.error === 'canceled') {
          resolve();
        } else {
          reject(new Error(`Speech error: ${e.error}`));
        }
      };

      speechSynthesis.speak(utterance);
    });
  }

  /**
   * Stop any ongoing speech
   */
  stop(): void {
    if (WebSpeechTTS.isSupported()) {
      speechSynthesis.cancel();
    }
  }

  /**
   * Check if currently speaking
   */
  get speaking(): boolean {
    return WebSpeechTTS.isSupported() && speechSynthesis.speaking;
  }

  /**
   * Check if initialized
   */
  get ready(): boolean {
    return this.initialized;
  }

  /**
   * Get selected voice name
   */
  get selectedVoice(): string | null {
    return this.voice?.name ?? null;
  }
}

