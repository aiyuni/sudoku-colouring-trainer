import { TUTORIAL_COLOUR_HEX, type TutorialColor, type TutorialFrame } from './tutorialTypes'

// What each look on the board means - shown under the lesson player and the
// practice quiz, and only the ones the pictures in hand actually use.
type LegendKind = TutorialColor | 'split' | 'eliminated' | 'solved' | 'link' | 'helper'
const LEGEND_TEXT: Record<LegendKind, { label: string; note?: string }> = {
  blue: { label: 'Blue' },
  yellow: { label: 'Yellow' },
  darkBlue: { label: 'Dark blue', note: 'true if light blue is' },
  orange: { label: 'Orange', note: 'true if yellow is' },
  pink: { label: 'Pink', note: 'second Dragon' },
  limeGreen: { label: 'Lime green', note: 'second Dragon' },
  purple: { label: 'Purple', note: 'true if pink is' },
  darkGreen: { label: 'Dark green', note: 'true if lime green is' },
  split: { label: 'Two colours', note: 'coloured by both Dragons' },
  eliminated: { label: 'Eliminated' },
  solved: { label: 'Answer' },
  link: { label: 'Link' },
  helper: { label: 'Helper technique' },
}

const COLOUR_KINDS: readonly LegendKind[] = ['blue', 'yellow', 'darkBlue', 'orange', 'pink', 'limeGreen', 'purple', 'darkGreen', 'split']
const SECOND_DRAGON_KINDS: readonly LegendKind[] = ['pink', 'limeGreen', 'purple', 'darkGreen']

type KeyFrame = Pick<TutorialFrame, 'coloured' | 'eliminated' | 'solved' | 'links' | 'greenCells'>

function legendFor(frames: readonly KeyFrame[]): LegendKind[] {
  const used = new Set<LegendKind>()
  for (const frame of frames) {
    const seen = new Set<string>()
    for (const c of frame.coloured ?? []) {
      used.add(c.color)
      const key = `${c.row},${c.col},${c.digit}`
      if (seen.has(key)) used.add('split')
      seen.add(key)
    }
    if (frame.eliminated?.length) used.add('eliminated')
    if (frame.solved?.length) used.add('solved')
    if (frame.links?.some((l) => l.kind === 'strong')) used.add('link')
    if (frame.greenCells?.length) used.add('helper')
  }
  const order: LegendKind[] = [...COLOUR_KINDS, 'link', 'eliminated', 'solved', 'helper']
  return order.filter((kind) => used.has(kind))
}

/** The first candidate the frames draw in two colours, as [first Dragon,
 * second Dragon] - the key's split swatch shows that pair. */
function firstSplitPair(frames: readonly KeyFrame[]): [TutorialColor, TutorialColor] | null {
  for (const frame of frames) {
    const seen = new Map<string, TutorialColor>()
    for (const c of frame.coloured ?? []) {
      const key = `${c.row},${c.col},${c.digit}`
      const earlier = seen.get(key)
      if (earlier) return [earlier, c.color]
      seen.set(key, c.color)
    }
  }
  return null
}

interface ColourKeyProps {
  frames: readonly KeyFrame[]
  /** Only the colours, not the eliminated/answer/link looks: a practice
   * question's key must not hint at what its answer picture will show. */
  coloursOnly?: boolean
}

export default function ColourKey({ frames, coloursOnly = false }: ColourKeyProps) {
  const all = legendFor(frames)
  const items = coloursOnly ? all.filter((kind) => COLOUR_KINDS.includes(kind)) : all
  if (items.length === 0) return null
  // Dragon pictures talk about "light blue" next to "dark blue".
  const hasDragonColours = all.some((kind) => COLOUR_KINDS.includes(kind) && kind !== 'blue' && kind !== 'yellow' && kind !== 'split')
  // With two Dragons on the board, say which one light blue and yellow are.
  const hasSecondDragon = all.some((kind) => SECOND_DRAGON_KINDS.includes(kind))
  const split = firstSplitPair(frames)
  return (
    <ul className="tutorial-legend" aria-label="Colour key">
      {items.map((kind) => {
        const { label } = LEGEND_TEXT[kind]
        const text = kind === 'blue' && hasDragonColours ? 'Light blue' : label
        const note = hasSecondDragon && (kind === 'blue' || kind === 'yellow') ? 'first Dragon' : LEGEND_TEXT[kind].note
        return (
          <li key={kind}>
            <span
              className={`tutorial-swatch tutorial-swatch-${kind}`}
              style={
                kind === 'split' && split
                  ? { background: `linear-gradient(to top right, ${TUTORIAL_COLOUR_HEX[split[0]]} 50%, ${TUTORIAL_COLOUR_HEX[split[1]]} 50%)` }
                  : undefined
              }
              aria-hidden="true"
            />
            <span>
              {text}
              {note && <span className="tutorial-legend-note"> - {note}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
