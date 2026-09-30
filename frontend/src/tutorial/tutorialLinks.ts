import type { ColourTabId } from './tutorialExamples'

export type TutorialTabId = 'basics' | ColourTabId | 'double' | 'uniqueness'

/** Where on the How It Works page a technique is taught: a tab, and on a
 * tab with sub-tabs (Basics, Double Dragons, Abusing Uniqueness) the
 * sub-tab's `LessonGroup.title` in tutorialExamples.ts. */
export interface TutorialTarget {
  tab: TutorialTabId
  group?: string
}

/** Unique Rectangle types that have their own sub-tab ("UR Type 1"...). */
const UR_TYPES_TAUGHT = new Set(['1', '2', '3', '4', '5', '7a', '7b', '7c', '7d'])

/**
 * The How It Works section that teaches the technique behind a Techniques
 * row (by its `TechniqueInstance.id`), or null when the page doesn't teach
 * it yet - the Hint popup's "Learn this technique" link only appears when
 * this returns something. A new lesson for a technique must be added here
 * too, and a renamed sub-tab title changed here to match.
 */
export function tutorialTargetFor(instanceId: string): TutorialTarget | null {
  const id = instanceId
  if (id.startsWith('naked-single') || id.startsWith('hidden-single')) return { tab: 'basics', group: 'Singles' }
  if (id.startsWith('locked-candidate-')) return { tab: 'basics', group: 'Locked Candidates' }
  if (/^naked-(pair|triple|quad)/.test(id) || id.startsWith('hidden-pair')) return { tab: 'basics', group: 'Locked Sets' }
  if (id.startsWith('ur-')) {
    // "ur-type4-..." or, for a merged row, "ur-types1&4-..." - its first type.
    const type = /^ur-types?(\d[a-d]?)/.exec(id)?.[1]
    return type && UR_TYPES_TAUGHT.has(type) ? { tab: 'uniqueness', group: `UR Type ${type}` } : null
  }
  // BUG+N ids carry N: "bug-plus-n-2-...". Each N has its own sub-tab.
  if (id.startsWith('bug-plus-n-')) return { tab: 'uniqueness', group: `BUG+${id.split('-')[3]}` }
  if (id.startsWith('bivalue-oddagon-')) return { tab: 'uniqueness', group: 'Bivalue Oddagon' }
  if (id.startsWith('avoidable-rectangle-')) return { tab: 'uniqueness', group: 'Avoidable Rectangle' }
  if (id.startsWith('simple-color-')) return { tab: 'simple' }
  if (id.startsWith('medusa-')) return { tab: 'medusa' }
  if (id.startsWith('double-dynamic-dragon-')) return { tab: 'double', group: 'Double Dynamic Dragon Colouring example 1' }
  if (id.startsWith('double-dragon-')) return { tab: 'double', group: 'Double Plain Dragon Colouring' }
  if (id.startsWith('dynamic-dragon-')) return { tab: 'dynamic' }
  if (id.startsWith('dragon-')) return { tab: 'dragon' }
  // Fish, AICs and ALS-xz aren't taught on the page yet.
  return null
}
