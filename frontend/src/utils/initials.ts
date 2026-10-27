/** Suffixes that are not part of the name the initials stand for: "… Montgomery III", "… King Jr." */
const SUFFIX = /^(?:i{1,3}|iv|v|vi{1,3}|jr\.?|sr\.?)$/i

/**
 * The letters of a name's avatar: "Hà Anh Tuấn" → "HT", "Đen" → "Đ",
 * "🎸 Ban nhạc Ngũ Cung" → "BC", "Christopher Montgomery III" → "CM".
 * Only words with a letter count (an emoji or a symbol is no initial), from
 * their first letter, taken whole (Array.from: never half of a character).
 * A name with no letter at all (emoji only) keeps its first character.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
  while (words.length > 1 && SUFFIX.test(words[words.length - 1])) words.pop()
  const first = (word: string) => (Array.from(word).find((ch) => /\p{L}/u.test(ch)) ?? '').toLocaleUpperCase('vi')
  if (words.length === 0) return Array.from(name.trim())[0] ?? ''
  return words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0])
}
