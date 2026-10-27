/**
 * A heading that comes in word by word, each one sharpening from a light blur
 * (the idea of React Bits' "BlurText", written here with CSS only: no
 * animation library). For a rare moment, the home page's first view, never
 * for text people see many times a day (docs/DESIGN.md, Motion).
 *
 * The words stay real text separated by real spaces, so the heading reads
 * (and is found, copied, translated) as one sentence. With
 * prefers-reduced-motion they only fade in (index.css).
 */
export function BlurText({ text, delayMs = 0, stepMs = 60 }: { text: string; delayMs?: number; stepMs?: number }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, index) => (
        <span key={index}>
          <span className="inline-block animate-blur-in" style={{ animationDelay: `${delayMs + index * stepMs}ms` }}>
            {word}
          </span>
          {index < words.length - 1 && ' '}
        </span>
      ))}
    </>
  )
}
