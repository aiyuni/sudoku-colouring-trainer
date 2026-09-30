// Prints the BUG+1/2/3 lessons' frames (fails loudly if one was skipped).
// Build: npx rolldown dragon-research/bug-n/lesson-check.ts --format esm --platform node -o dragon-research/bug-n/.out/lesson-check.mjs
import { buildUniquenessGroups } from '../../src/tutorial/tutorialExamples'
for (const title of ['BUG+1', 'BUG+2', 'BUG+3']) {
  const group = buildUniquenessGroups().find((g) => g.title === title)
  if (!group || group.lessons.length !== 1) throw new Error(`${title}: ${group?.lessons.length}`)
  for (const lesson of group.lessons) {
    console.log(`== ${lesson.title} (${lesson.hint})`)
    for (const f of lesson.frames) console.log(`[${f.badge}] ${f.caption}  elim=${(f.eliminated ?? []).map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`)} solved=${(f.solved ?? []).map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`)}`)
  }
}
