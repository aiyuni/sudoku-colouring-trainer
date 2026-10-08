import { HELP_TABS, type HelpItem, type HelpTab } from '../helpContent'
import { NOT_ON_ANTI_KNIGHT, NOT_ON_ENTROPY, TECHNIQUE_APPLICABILITY } from '../sudoku/variantApplicability'

/**
 * The Variant solver's part of the "Settings guide": its own quickstart box
 * and a "Variant Sudoku" tab, put in front of the Classic page's tabs (the
 * settings menus are the same ones, so their tabs are reused as they are;
 * the Generate Puzzle tab is dropped, since that menu isn't on this page).
 * Plain data, like helpContent.ts - edit the strings here to change what the
 * page says. The "which techniques apply" section is not written by hand: it
 * is read from the applicability table (sudoku/variantApplicability.ts), the
 * same one the Technique Selections menu uses, so it can't drift from what
 * the solver actually does.
 */
export const VARIANT_HELP_QUICKSTART_HEADING = 'The Colouring solver, on Killer and Jigsaw puzzles.'

export const VARIANT_HELP_QUICKSTART =
  'Everything works as it does on the Classic solver - the candidates, the colours, the Techniques list, the Solve Path, ' +
  'Dragon Colouring - on a puzzle that has Killer cages, Jigsaw regions, or both.\n\n' +
  'To start, pick a puzzle from the **Puzzle** menu, paste one into the import box, or draw one with **Edit cages** / ' +
  '**Draw regions** under Puzzle layout. Then click **Autofill all** and open the Techniques list.\n\n' +
  'The tabs below explain the variant rules and which techniques apply to them, then the same settings menus as the Classic solver.'

const applicabilityItem = (title: string, entries: typeof TECHNIQUE_APPLICABILITY): HelpItem => ({
  name: title,
  description: entries.map((entry) => `**${entry.name}** - ${entry.note}`).join('\n\n'),
})

const VARIANT_TAB: HelpTab = {
  label: 'Variant Sudoku',
  intro:
    'A variant is the Classic rules plus more. The solver treats it that way: the Classic techniques run on the variant wherever ' +
    'their logic still holds, and the extra rules add techniques of their own.',
  sections: [
    {
      title: 'The variants',
      items: [
        {
          name: 'Killer Sudoku',
          description:
            'The grid is covered with **cages** (dashed outlines). The digits in a cage add up to the number in its corner, and no ' +
            'digit repeats inside a cage. Rows, columns and boxes work as usual. A Killer usually has no givens at all.\n\n' +
            'The cages bring four techniques, marked **Killer** in the Techniques list: **Cage Sum** (one empty cell left in a cage), ' +
            '**Cage Combinations** (a candidate that fits no way of filling its cage), **Cage Locked Candidate** (a digit the cage must ' +
            'hold, so cells seeing all its places lose it) and the **Rule of 45** (innies and outies: rows, columns and boxes add up to 45 each).',
        },
        {
          name: 'Jigsaw Sudoku',
          description:
            'The nine 3x3 boxes are replaced by nine irregular **regions** of nine cells (thick borders). Each row, column and region ' +
            'holds 1-9 once.\n\n' +
            'There is no separate Jigsaw technique list: wherever a technique says "box", it works on the region instead. A Locked ' +
            'Candidate, a Naked Pair, a colouring link or a Unique Rectangle on a Jigsaw is the same deduction, read off the regions. ' +
            'The explanations say "region" too.',
        },
        {
          name: 'Killer Jigsaw',
          description: 'Both at once: cages over irregular regions. Everything above applies together.',
        },
        {
          name: 'X-Sudoku',
          description:
            'A Classic Sudoku with one more rule: each of the two long **diagonals** (tinted on the grid) also holds 1-9 once.\n\n' +
            'The diagonals are simply two more units, like a row or a box. So every technique that works on units uses them as it ' +
            'is: a Hidden Single, a Naked Pair, a colouring link or a chain can run along a diagonal. One technique is new, marked ' +
            '**X** in the Techniques list: **Locked Candidate (Diagonal)** - a digit whose places in a box all lie on a diagonal ' +
            'leaves the rest of that diagonal, and a digit whose places on a diagonal all lie in one box leaves the rest of the box.\n\n' +
            'Get one from the Puzzle menu (a random one, or a published example from SudokuWiki), or paste the digits into the ' +
            'import box and tick **X-Sudoku (diagonals)** when it asks what kind of puzzle it is. For digits typed in by hand, ' +
            'tick **Diagonals (X-Sudoku)** in the Puzzle menu.',
        },
        {
          name: 'Anti-Knight Sudoku',
          description:
            "A Classic Sudoku with one more rule: two cells a chess **knight's move** apart (two steps one way, one step sideways) " +
            "can't hold the same digit. Click a cell and the up to eight cells a knight's move from it are marked with a small ♞.\n\n" +
            'The rule adds no unit, only more pairs of cells that "see" each other. Autofill and every placed digit remove the ' +
            "digit from the knight cells too, and colouring and chains use a knight's move as a link. One technique is new, marked " +
            "**Knight** in the Techniques list: **Locked Candidate (Knight's Move)** - when every place a digit can still go in a " +
            'row, column or box is seen by one cell elsewhere (a knight\'s move counts as seeing), that cell loses the digit.\n\n' +
            'Get one from the Puzzle menu (a random one, or a published example from SudokuTodo), or paste the digits into the ' +
            'import box and tick **Anti-Knight** when it asks what kind of puzzle it is. For digits typed in by hand, tick ' +
            '**Anti-Knight rule** in the Puzzle menu.',
        },
        {
          name: 'Entropy Sudoku',
          description:
            'A Classic Sudoku with one more rule. The digits fall into three groups - **low** 1-3, **middle** 4-6, **high** 7-9 - ' +
            'and **every 2x2 square of cells** (all 64 of them, overlapping, across box borders) must hold at least one digit of ' +
            'each group.' + '\n\n' +
            'The rule adds no unit and no pair of cells that must differ; it speaks about groups. Autofill already leaves a cell ' +
            'only the groups its squares\' placed digits allow (two lows and a middle placed: the fourth cell is high). One ' +
            'technique is new, marked **Entropy** in the Techniques list: **Entropy Square** - four cells, three groups, so each ' +
            'group needs a cell of its own. A group only one cell of a square can still hold belongs to that cell, which loses ' +
            'its other digits; two groups only two cells can still hold take those two, which lose the third group.' + '\n\n' +
            'The uniqueness techniques are off (swapping a low digit with a high one changes what the squares hold). Chains and ' +
            'colouring run as on a Classic grid; they do not use the squares as links.' + '\n\n' +
            'Get one from the Puzzle menu, or paste one into the import box: a Sudoku.Coach Entropy link is recognised, and for ' +
            'plain digits tick **Entropy** when it asks what kind of puzzle it is.',
        },
        {
          name: 'Entropy: colour cells by group',
          settingKey: 'entropyGroupMarking',
          description:
            'In the Settings menu. On an Entropy puzzle it tints every cell that is down to one or two groups: **blue** = low ' +
            '(1-3), **amber** = middle (4-6), **pink** = high (7-9). A solved cell takes the group of its digit, an empty one the ' +
            'groups its candidates still allow; a cell split in two colours can still be either, and a cell that can be all ' +
            'three (or has no candidates marked) is left plain.' + '\n\n' +
            'Drawing only: it changes no candidates and no technique reads it.',
        },
      ],
    },
    {
      title: 'Which techniques apply',
      intro:
        'Each Classic technique was checked for what its logic rests on. The Technique Selections menu greys out the ones that ' +
        "can't be used on the puzzle on the grid, with the reason.",
      items: [
        applicabilityItem(
          'On both Killer and Jigsaw',
          TECHNIQUE_APPLICABILITY.filter((entry) => !entry.variantOnly && entry.killer && entry.jigsaw),
        ),
        applicabilityItem(
          'On a Jigsaw, not on a Killer',
          TECHNIQUE_APPLICABILITY.filter((entry) => !entry.variantOnly && !entry.killer && entry.jigsaw),
        ),
        applicabilityItem(
          'On a Killer, not on a Jigsaw',
          TECHNIQUE_APPLICABILITY.filter((entry) => !entry.variantOnly && entry.killer && !entry.jigsaw),
        ),
        applicabilityItem(
          'On neither',
          TECHNIQUE_APPLICABILITY.filter((entry) => !entry.variantOnly && !entry.killer && !entry.jigsaw),
        ),
        applicabilityItem(
          'Killer only (needs cages)',
          TECHNIQUE_APPLICABILITY.filter((entry) => entry.variantOnly),
        ),
        {
          name: 'On X-Sudoku, Anti-Knight and Entropy',
          description:
            'Everything that rests on units or on "these two cells can\'t hold the same digit" applies to both, with the diagonals ' +
            "as extra units and the knight's move as an extra link.\n\n" +
            '**X-Sudoku** - the uniqueness techniques (Unique Rectangle, Avoidable Rectangle, UR-AIC) skip any rectangle with a ' +
            'corner on a diagonal: swapping its digits would change the diagonal. BUG+N holds as it is. **Extended UR** is off.\n\n' +
            '**Anti-Knight** - no uniqueness technique at all (Unique Rectangle, BUG+N, Avoidable Rectangle, Extended UR, UR-AIC): ' +
            `${NOT_ON_ANTI_KNIGHT.replace('Not on an Anti-Knight puzzle: s', 'S')}\n\n` +
            '**Entropy** - every unit technique applies unchanged (they just do not use the 2x2 squares), and no uniqueness ' +
            `technique at all: ${NOT_ON_ENTROPY.replace('Not on an Entropy puzzle: s', 's')}`,
        },
      ],
    },
    {
      title: 'Difficulty rating',
      items: [
        {
          name: 'The rating under the grid',
          description:
            'A number on the **Sudoku Explainer (SE) scale**, the one the Classic solver shows: the puzzle is solved step by step, ' +
            'always with the easiest technique that applies, and the rating is the hardest step that was needed. Roughly: up to 2.5 ' +
            'easy, to 4.5 medium, to 7.9 hard, 8 and up very hard. Hover over it for the detail.\n\n' +
            '**Jigsaw**: the rating of SukakuExplainer, the Sudoku Explainer that knows Jigsaw regions - an established rating, ' +
            'directly comparable with the SE rating of a Classic puzzle.\n\n' +
            '**Killer** and **Killer Jigsaw**: Sudoku Explainer does not know cages, and no other rater on its scale does, so this ' +
            'one is this solver\'s own: the same method, with the cage techniques (Cage Sum, Cage Combinations, Cage Locked ' +
            'Candidate, Rule of 45) given places on the scale. It is not an official SE rating. Up to about 4.3 it reads like one; ' +
            'a Killer that needs more than those cage techniques jumps to 8 or more, which means "hard", not an exact measure - a ' +
            'practised Killer solver has moves this rater does not. The easiest Killer rates 2.4.\n\n' +
            '**X-Sudoku**: SukakuExplainer again, which knows the two diagonals as extra units - an established rating, on the ' +
            'same scale as a Classic puzzle.\n\n' +
            "**Anti-Knight**: Sudoku Explainer has no Anti-Knight rule. The rule adds no technique, only cells that can't hold " +
            "the same digit, so the same solver is simply told about the knight's move; every technique and difficulty is still " +
            'its own. It is not an official SE rating, and it is flat for easy puzzles: one that falls to singles rates 1.2 however ' +
            'much knight-move checking it took, because the scale measures the hardest technique, not the work of finding candidates. ' +
            'Puzzles with very few givens rate 9 and up and can take minutes.\n\n' +
            '**Entropy**: Sudoku Explainer has no Entropy rule either. The same solver keeps the 2x2 squares in its candidates ' +
            '(what the placed digits of a square leave its empty cells) and gets one technique, Entropy Square, rated 2.6 (one ' +
            'group, one cell) and 2.8 (two groups, two cells) - beside pointing and claiming. Those numbers were checked against ' +
            'five puzzles graded by Sudoku.Coach: its Easy came out 1.2, Moderately Easy 2.3, Moderate 2.6, Moderately Hard 3.4 ' +
            'and Hard 3.0. It is not an official SE rating, and puzzles with very few givens can take minutes.\n\n' +
            'The hardest puzzles take a while; the rating so far is shown as it climbs, and after three minutes it stops at "X or higher".',
        },
      ],
    },
    {
      title: 'Brute force',
      items: [
        {
          name: 'Brute force solve',
          description:
            'Fills in the solution by trial and error, checking every rule of the puzzle on the grid (rows, columns, regions, cage ' +
            'sums, no repeats in a cage). It is **not** a solving technique and explains nothing - it is there to check a puzzle ' +
            'has exactly one solution, and to see the answer. The line under the grid says whether the techniques alone can solve ' +
            'the puzzle ("Solvable") or brute force would be needed.',
        },
      ],
    },
    {
      title: 'Getting a puzzle onto the grid',
      items: [
        {
          name: 'Puzzle menu',
          description:
            'Random Killer, Jigsaw and Killer Jigsaw practice puzzles, each with exactly one solution. "Harder puzzles" makes a ' +
            'Jigsaw with as few givens as it can have, and a Killer with bigger cages. They are valid puzzles, not graded ones.',
        },
        {
          name: 'Drawing a Jigsaw: Draw regions',
          description:
            '**Puzzle > Draw a new Jigsaw** clears the grid and lets you draw the regions first; the digits come after. ' +
            '(**Draw regions** under Puzzle layout does the same on the grid as it stands.)\n\n' +
            '**Drag across the grid** to draw a region. When it has nine cells the next region is chosen for you, so the nine ' +
            'can be drawn one after the other. To fix a mistake, drag starting from a cell that is already in the chosen region: ' +
            'that rubs cells out. Click a region button (or press 1-9) to go back to a region. While drawing, clicks and digit ' +
            'keys never change the cells. When all nine regions have nine cells, click **Use regions** - then click a cell and ' +
            'type its digit as usual.',
        },
        {
          name: 'Entering a Killer: Edit cages',
          description:
            'Click the cells of a cage, type its sum, Add cage. A new cage replaces any cage it overlaps. Every change is one Undo step.',
        },
        {
          name: 'Importing: "What kind of puzzle is this?"',
          description:
            'Every puzzle pasted into the import box or read from a screenshot first opens a box asking which rules it has: ' +
            '**X-Sudoku (diagonals)**, **Anti-Knight**, **Entropy**, **Jigsaw**, **Killer** - tick every one that applies, or none for a ' +
            'Classic Sudoku. Nothing is put on the grid until you answer; Cancel import leaves the grid as it was.\n\n' +
            "Plain digits can't say which rules a puzzle uses, and a puzzle loaded under the wrong rules shows up as having " +
            'several solutions, so the box starts with nothing ticked. When the text or screenshot does carry its rules ' +
            '(regions, cages, a SudokuWiki X-Sudoku link, this solver\'s own text) they are already ticked and you only confirm, ' +
            'or correct them.\n\n' +
            'Ticking Jigsaw or Killer when the regions or cages were not in the import opens Draw regions / Edit cages right ' +
            'after, with the digits already on the grid.',
        },
        {
          name: 'Screenshot of a Jigsaw',
          description:
            'Drag, paste or upload a screenshot of a Jigsaw (from SudokuWiki, Sudoku.Coach or elsewhere). The regions are read ' +
            'from the heavier lines between them and the digits as on the Classic solver. Check both against the screenshot, ' +
            'fix any digit that was misread, then click **Lock as givens**. If the regions could not be made out, tick ' +
            'Jigsaw in the box that asks what kind of puzzle it is and draw them yourself. Killer cages and their sums are not read from screenshots.',
        },
        {
          name: 'Import box: SudokuWiki strings',
          description:
            'Paste a puzzle string from sudokuwiki.org into the import box (the whole link works too).\n\n' +
            '**Jigsaw**: shape=1&bd= followed by the 81 clue digits. The shape number picks one of the 32 layouts of the ' +
            'SudokuWiki Jigsaw solver; a layout of your own goes in as shape=33&bd=...&jigmap= followed by 81 digits 1-9.\n\n' +
            '**Killer**: bd= followed by 81 colour digits, a comma and 162 clue digits (two per cell: the sum of the cage, in the ' +
            'one cell that shows it). Touching cells of one colour are one cage.\n\n' +
            'The packed strings of that site (bd=J9B..., L9B...) are not read.',
        },
        {
          name: 'Copy Original, Copy Puzzle As-Is',
          description:
            'Both copy a **SudokuWiki string**, the same kind the import box reads - so it pastes back in here, and loads on ' +
            'sudokuwiki.org. **Copy Original** is the puzzle alone (a Jigsaw as shape=...&bd=..., a Killer as its colour and clue ' +
            'numbers). **Copy Puzzle As-Is** adds the solved cells and candidates, in the "with current progress" form of that site.\n\n' +
            'Two things that format can\'t hold: the colours on candidates are left out, and a cell whose candidates are down to ' +
            'one digit comes back as that digit placed.\n\n' +
            'A Killer with givens, or with cells in no cage, can\'t be written as a SudokuWiki string at all; it is copied in this ' +
            'solver\'s own text instead (it starts with {"variantSudoku"...), which the import box also reads.',
        },
      ],
    },
  ],
}

/** The Variant page's help tabs: its own, then the Classic settings menus'. */
export function variantHelpTabs(): HelpTab[] {
  return [VARIANT_TAB, ...HELP_TABS.filter((tab) => tab.label !== 'Generate Puzzle')]
}
