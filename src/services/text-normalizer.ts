/**
 * Text Normalizer
 * Converts text to TTS-friendly format
 */

import numberToWords from 'number-to-words';
const { toWords, toWordsOrdinal } = numberToWords;

/**
 * A text replacement rule for speech normalization.
 * Pattern can be a string (exact match) or RegExp (for complex patterns).
 * Replacement can be a string or function (like String.replace).
 *
 * @example
 * // Simple string replacement
 * ['1:1', 'one on one']
 *
 * // Regex with capture groups
 * [/PR#(\d+)/g, 'PR $1']
 *
 * // Function replacement
 * [/v(\d+)\.(\d+)/g, (_, major, minor) => `version ${major} point ${minor}`]
 *
 * // Case-insensitive
 * [/\bAPI\b/gi, 'A P I']
 */
export type TextReplacement = [
  pattern: string | RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string)
];

export interface TextNormalizerConfig {
  /** Custom text replacements applied before other normalizations */
  replacements?: TextReplacement[];
}

export class TextNormalizer {
  private customReplacements: TextReplacement[];

  constructor(config?: TextNormalizerConfig) {
    this.customReplacements = config?.replacements ?? [];
  }

  /**
   * Apply custom text replacements.
   * Runs first so replacements happen before number/symbol normalization.
   */
  private normalizeCustomReplacements(text: string): string {
    let result = text;
    for (const [pattern, replacement] of this.customReplacements) {
      if (typeof pattern === 'string') {
        // Escape special regex characters for literal string matching
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), replacement as string);
      } else {
        // RegExp pattern - use directly
        result = result.replace(pattern, replacement as string);
      }
    }
    return result;
  }

  normalize(text: string): string {
    let result = text;
    result = this.normalizeCustomReplacements(result);
    result = this.normalizeTimes(result);
    result = this.normalizeMonthAbbreviations(result);
    result = this.normalizeDecimalNumbers(result);
    result = this.normalizeOrdinals(result);
    result = this.normalizeCurrency(result);
    result = this.normalizePercentages(result);
    result = this.normalizeYears(result);
    result = this.normalizeSymbols(result);
    result = this.normalizeStandaloneNumbers(result);
    result = this.normalizePunctuation(result);
    result = result.replace(/\s+/g, ' ').trim();
    result = this.capitalizeSentences(result);
    return result;
  }

  private capitalizeSentences(text: string): string {
    // Capitalize first character of text
    let result = text.charAt(0).toUpperCase() + text.slice(1);
    // Capitalize first letter after sentence-ending punctuation
    result = result.replace(/([.!?])\s+([a-z])/g, (_, punct, letter) => `${punct} ${letter.toUpperCase()}`);
    return result;
  }

  private normalizeTimes(text: string): string {
    return text.replace(
      /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\b/g,
      (_, hourStr, minuteStr, period) => {
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);
        const hourWord = toWords(hour);
        let minuteWord = minute === 0 ? '' : minute < 10 ? 'oh ' + toWords(minute) : toWords(minute);
        const periodWord = period ? ' ' + period.toUpperCase().split('').join(' ') : '';
        return (hourWord + ' ' + minuteWord + periodWord).trim();
      }
    );
  }

  private readonly monthAbbreviations: Record<string, string> = {
    'Jan': 'January',
    'Feb': 'February',
    'Mar': 'March',
    'Apr': 'April',
    'Jun': 'June',
    'Jul': 'July',
    'Aug': 'August',
    'Sep': 'September',
    'Sept': 'September',
    'Oct': 'October',
    'Nov': 'November',
    'Dec': 'December',
  };

  private normalizeMonthAbbreviations(text: string): string {
    const monthPattern = /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,4})\b/gi;

    return text.replace(monthPattern, (_, month, num) => {
      const normalized = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
      const fullMonth = this.monthAbbreviations[normalized] || normalized;
      const n = parseInt(num, 10);

      // If it's a year (4 digits or > 31), leave the number for normalizeYears to handle
      // If it's a day (1-31), convert to ordinal
      if (num.length === 4 || n > 31) {
        return `${fullMonth} ${num}`;
      } else {
        return `${fullMonth} ${toWordsOrdinal(n)}`;
      }
    });
  }

  private normalizeDecimalNumbers(text: string): string {
    return text.replace(/(\d+)\.(\d+)/g, (_, whole, decimal) => {
      const wholeWords = toWords(parseInt(whole, 10));
      const decimalDigits = decimal.split('').map((d: string) => toWords(parseInt(d, 10))).join(' ');
      return `${wholeWords} point ${decimalDigits}`;
    });
  }

  private normalizeOrdinals(text: string): string {
    return text.replace(/(\d+)(st|nd|rd|th)\b/gi, (_, num) => toWordsOrdinal(parseInt(num, 10)));
  }

  private normalizeCurrency(text: string): string {
    let result = text.replace(/\$(\d+)\.(\d{2})\b/g, (_, dollars, cents) => {
      const d = parseInt(dollars, 10);
      const c = parseInt(cents, 10);
      let phrase = toWords(d) + (d === 1 ? ' dollar' : ' dollars');
      if (c > 0) phrase += ' and ' + toWords(c) + (c === 1 ? ' cent' : ' cents');
      return phrase;
    });
    return result.replace(/\$(\d+)\b/g, (_, dollars) => {
      const d = parseInt(dollars, 10);
      return toWords(d) + (d === 1 ? ' dollar' : ' dollars');
    });
  }

  private normalizePercentages(text: string): string {
    return text.replace(/(\d+)%/g, (_, num) => toWords(parseInt(num, 10)) + ' percent');
  }

  private normalizeYears(text: string): string {
    return text.replace(/\b(1\d{3}|2\d{3})\b/g, (match) => {
      const year = parseInt(match, 10);
      if (year >= 2000 && year < 2010) return 'two thousand ' + (year === 2000 ? '' : toWords(year - 2000));
      if (year >= 2010 && year < 3000) {
        const first = Math.floor(year / 100);
        const last = year % 100;
        return toWords(first) + ' ' + (last < 10 ? 'oh ' + toWords(last) : toWords(last));
      }
      if (year >= 1000 && year < 2000) {
        const first = Math.floor(year / 100);
        const last = year % 100;
        return toWords(first) + ' ' + (last === 0 ? 'hundred' : last < 10 ? 'oh ' + toWords(last) : toWords(last));
      }
      return toWords(year);
    });
  }

  private normalizeStandaloneNumbers(text: string): string {
    return text.replace(/\b(\d+)\b/g, (match) => toWords(parseInt(match, 10)));
  }

  private normalizeSymbols(text: string): string {
    return text
      .replace(/&/g, ' and ')
      .replace(/@/g, ' at ')
      .replace(/\+(\d)/g, 'plus $1')
      .replace(/\+/g, ' plus ')
      .replace(/-(\d)/g, ' minus $1')
      .replace(/=/g, ' equals ')
      .replace(/\//g, ' to ')
      .replace(/#(\d+)/g, ' number $1')
      .replace(/#(\w+)/g, ' hashtag $1')
      .replace(/#/g, ' number ');
  }

  private normalizePunctuation(text: string): string {
    return text
      .replace(/[\r\n]+/g, '. ')
      .replace(/[;:]/g, '. ')
      .replace(/[()[\]{}]/g, ' ')
      .replace(/[""«»]/g, '')
      .replace(/(?<!\w)[''']|['''](?!\w)/g, '')
      .replace(/[*_~`]/g, ' ')
      .replace(/ - /g, '. ')
      .replace(/\.\s*\./g, '.')
      .replace(/\.+/g, '.');
  }
}

