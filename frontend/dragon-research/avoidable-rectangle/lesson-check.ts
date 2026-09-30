// Prints the Avoidable Rectangle lessons' frames (fails loudly if one was skipped).
import { buildUniquenessGroups } from '../../src/tutorial/tutorialExamples'
const group = buildUniquenessGroups().find((g) => g.title === 'Avoidable Rectangle')
if (!group || group.lessons.length !== 2) throw new Error(`lessons: ${group?.lessons.length}`)
for (const lesson of group.lessons) {
  console.log(`== ${lesson.title} (${lesson.hint})`)
  for (const f of lesson.frames) console.log(`[${f.badge}] ${f.caption}  elim=${(f.eliminated ?? []).map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`)}`)
}
