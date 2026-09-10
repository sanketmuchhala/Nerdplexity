import emojiRegex from 'emoji-regex';

/**
 * Removes all emojis from a text string
 * Used to enforce emoji-free UI throughout the application
 */
export function stripEmojis(text: string): string {
  if (!text) return text;
  
  const regex = emojiRegex();
  return text.replace(regex, '').trim();
}

/**
 * Sanitizes text for display in UI components
 * Removes emojis while preserving Markdown and code whitespace.
 */
export function sanitizeDisplayText(text: string): string {
  if (!text) return '';
  
  // Remove emojis
  const withoutEmojis = stripEmojis(text);
  
  return withoutEmojis;
}

/**
 * Checks if text contains emojis
 * Used for validation in forms and inputs
 */
export function containsEmojis(text: string): boolean {
  if (!text) return false;
  
  const regex = emojiRegex();
  return regex.test(text);
}
