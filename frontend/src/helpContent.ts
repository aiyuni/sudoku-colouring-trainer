import { GENERIC_AIC_MAX_LENGTH } from './sudoku/SudokuGenericAicFinder'
import { MIN_BASE_MEDUSA_CANDIDATES, type AppSettings } from './settingsDefaults'
import { DEFAULT_HOTKEYS, HOTKEY_LABELS, formatHotkey } from './hotkeys'

/**
 * The text of the "Settings guide" page (the ? button next to Generate Puzzle).
 * This file is plain data on purpose - to change what the page says, edit the
 * strings below; nothing else needs touching.
 *
 * How it's put together:
 *  - HELP_QUICKSTART_HEADING / HELP_QUICKSTART are the highlighted box at the
 *    very top, shown above the tabs whichever tab is open.
 *  - HELP_TABS is one tab per settings menu (plus Solve Path). Each tab has a
 *    list of sections (matching that menu's section headings), each with a
 *    title, an optional `intro` paragraph, and a list of `items` (one per
 *    setting).
 *  - An item's `name` should match the label in the menu.
 *  - Set `settingKey` (a key of AppSettings in settingsDefaults.ts) and the
 *    page shows "Default: ..." for you, read straight from the real defaults,
 *    so it can never go out of date. For anything that isn't one of those
 *    settings, use `defaultText` instead to write the default yourself.
 *  - `description` is a plain-text paragraph. Use "\n\n" to start a new one.
 *  - Any text can hold a link: write [some text](how-it-works) and "some
 *    text" becomes a link that opens the Techniques overview page.
 *  - Write **some text** to show "some text" in bold.
 *  - To add a setting: add an item to a section. To add a section or tab:
 *    add an object to the list. To reorder: move things around.
 */

export interface HelpItem {
  /** Shown as the item's heading - match the label in the menu. */
  name: string
  /** Pulls the default (On/Off, a choice, ...) from DEFAULT_SETTINGS. */
  settingKey?: keyof AppSettings
  /** Free-text default, for things that aren't an AppSettings key. Ignored
   * when settingKey is set. */
  defaultText?: string
  description: string
}

export interface HelpSection {
  title: string
  intro?: string
  items: HelpItem[]
}

export interface HelpTab {
  /** The tab's label - match the menu's name. */
  label: string
  /** One line under the tab bar saying where these settings live. */
  intro?: string
  sections: HelpSection[]
}

export const HELP_TITLE = 'QuickStart / Settings explanation'

export const HELP_QUICKSTART_HEADING = 'New to Colouring? Keep the default settings.'

export const HELP_QUICKSTART =
  "The defaults give the best Colouring and Sudoku solving experience. Leave them alone if you're learning Colouring or still learning what AICs are, " +
  'and use "Reset to defaults" in Settings to get back to them at any time. \n\nTo start, generate or import a puzzle. ' +
  '\n\n For how the techniques work, see the [Techniques overview](how-it-works).\n\n' +
  'For advanced players, the tabs below explain the customizations for the solver.' 

export const HELP_TABS: HelpTab[] = [
  {
    label: 'Dragon Configuration',
    intro: 'The Dragon Configuration menu.  Every setting here has a **major impact** on what Dragons the solver shows, especially the **"Exhaustive Dragon Colouring"** setting. ' +
    'In addition, **"Select Dragon Colouring techniques"**, **"Enable Double Dynamic Dragons"**, **"Limit to 1 AIC per step"**, and **"Max techniques per Dragon step"** affect the solver strength.  **Advanced players** may want to tinker with these settings to analyze Dragons. \n\n **Beginners should use default settings**.',
    sections: [
      {
        title: 'Dragon Colouring',
        intro: 'These apply to both plain and Dynamic Dragon Colouring.',
        items: [
          {
            name: 'Exhaustive Dragon Colouring',
            settingKey: 'exhaustiveDragonColouring',
            description:
              'ON: Recycles its colours and does not stop on the first elimination it finds. ' +
              '' +
              '**This is the setting most human-like**, shows promotions, and, as a result, **a single Exhaustive Dragon might be able to solve the entire puzzle.** \n\n' +
              'OFF: stops at the first elimination (AIC-like).  As a result, does not utilize Dragon promotions. Use this in combination with "Optimize Dragons" to show the simplest Dragon that can progress, or to compare Dragons with AICs.',
          },
          {
            name: 'Optimize Dragons',
            settingKey: 'optimizeDragons',
            description:
              'OFF: the two colours take turns to extend.\n\n' +
              'ON: for each Medusa base, searches for the order of colour extensions that reaches the elimination(s) ' +
              'with the fewest extensions.\n\n' +
              '"Find by elims" feature is always optimized, so it will always uses this, whether ON or OFF.',
          },
          {
            name: `Dragon: require ${MIN_BASE_MEDUSA_CANDIDATES}+ base Medusa candidates`,
            settingKey: 'minBaseMedusaFilter',
            description:
              `ON: the Techniques panel only lists Dragons whose starting Medusa has at least ` +
              `${MIN_BASE_MEDUSA_CANDIDATES} coloured candidates, i.e. the easily spotted ones. ` +
              'Auto-solve and Solve Path ignore it.',
          },
        ],
      },
      {
        title: 'Double Dragon Colouring',
        items: [
          {
            name: 'Enable Double Dragon',
            settingKey: 'doubleDragonEnabled',
            description:
              'Enables the solver to find Double Plain Dragons, to solve puzzles that a single Plain Dragon cannot. Refer to "Techniques overview" for more details.\n\n' +
              'Follows all Dragon settings. ON also enables "Generate Double Dragon colouring puzzle" in the Generate Puzzle menu.',
          },
        ],
      },
      {
        title: 'Dynamic Dragon Colouring',
        items: [
          {
            name: 'Optimize Dynamic Dragons',
            settingKey: 'optimizeDynamicDragons',
            description:
              'ON: Same as Optimize Dragons, but for Dynamic Dragons. Looks for the shortest path to find an elimination using ' +
              'Dynamic Dragon extensions.\n\n' +
              'Performance wise is a bit slower, especially with AICs enabled or with Exhaustive Dragon Colouring OFF.  It never uses ' +
              'more extensions than Optimize Dragons alone. "Find by elims" follows this setting.',
          },
          {
            name: 'Enable Double Dynamic Dragons',
            settingKey: 'doubleDynamicDragonEnabled',
            description:
              'Enables the solver to find Double Dynamic Dragons.  A Double Dynamic Dragon can solve puzzles normal Dynamic Dragons cannot.  See "Techniques Overview" for an explanation.\n\n' +
              'Follows all Dynamic Dragon settings. Has no effect while Dynamic Dragons are disabled.',
          },
          {
            name: 'Limit to 1 AIC per step',
            settingKey: 'aicLimitPerDragonStep',
            description:
              'ON: a Dynamic Dragon step may rely on at most one AIC.  Suitable for the average human solver.\n\nOFF: no limit to amount of AICs it can use - a stronger Dragon, but much ' +
              'harder for the normal human to find.',
          },
          {
            name: 'Max techniques per step',
            settingKey: 'maxTechniquesPerDragonStep',
            description:
              'Controls how many non-singles techniques a single Dynamic Dragon step may use to extend its colours.  Does not control the techniques used; only controls the quantity of techniques used. \n\nInfinite: no limits - makes the solver extremely strong if all techniques are enabled.',
          },
        ],
      },
      {
        title: 'Select Dynamic Dragon Colouring techniques',
        items: [
          {
            name: 'Disable Dynamic Dragons',
            settingKey: 'dynamicDragonDisabled',
            description:
              'ON: Dynamic Dragon Colouring is not used anywhere, so plain Dragon Colouring becomes the strongest ' +
              'technique the solver can use. Thus, turning it ON or OFF will recheck whether the puzzle is solvable by the solver.',
          },
          {
            name: 'Select Dynamic Dragon Colouring techniques',
            //settingKey: 'allowedRule3Techniques',
            description:
              "The most important setting for Dynamic Dragons. Controls the non-colouring and non-singles techniques Dynamic Dragon may use to extend the Dragon colouring. " +
              'Locked Candidates & Naked Pair are always ON.',
          },
        ],
      },
    ],
  },
  {
    label: 'Settings',
    intro: 'The ⚙ Settings menu.  Controls the non-Dragon techniques the solver uses, and keyboard hotkeys.',
    sections: [
      // Keyboard input is no longer in Settings - it is the "Use as Keyboard
      // Input" switch in the Solution / Candidates group headers.
      // {
      //   title: 'Keyboard input',
      //   items: [
      //     {
      //       name: 'Toggle input',
      //       settingKey: 'keyboardMode',
      //       description: 'Whether typing a digit places a solution or toggles a candidate.',
      //     },
      //   ],
      // },
      {
        title: 'Techniques',
        intro: 'Enables or disables certain techniques for the solver. Advanced players may want to enable AICs or fish.  Note that Plain Dragons will find all AICs eliminations.',
        items: [
          {
            name: 'Enable Short Single-Digit AIC',
            settingKey: 'shortSingleDigitAicEnabled',
            description:
              'Single-digit AICs of length up to 3, including Empty Rectangles. Chains that are a Skyscraper, Two-String Kite, Crane or Empty Rectangle are shown by that name. Leave OFF for a pure Colouring experience.',
          },
          {
            name: 'Enable Short AIC',
            settingKey: 'shortAicEnabled',
            description:
              'General AICs of length up to 5, including W-Wings, which are shown by that name and listed first. Needs Short Single-Digit AIC ON.',
          },
          {
            name: 'Enable Generic AIC',
            settingKey: 'genericAicEnabled',
            description:
              `AICs longer than a Short AIC, up to ${GENERIC_AIC_MAX_LENGTH} links. Needs Short AIC ON.`,
          },
          {
            name: 'Enable X-Wing',
            settingKey: 'xWingEnabled',
            description:
              'Enable X-Wings to be found by the solver.',
          },
          {
            name: 'Enable Finned X-Wing',
            settingKey: 'finnedXWingEnabled',
            description:
              'Enable Finned X-Wings to be found by the solver.',
          },
          {
            name: 'Enable Swordfish',
            settingKey: 'swordfishEnabled',
            description:
                'Enable Swordfish to be found by the solver.',
          },
          {
            name: 'Enable Finned Swordfish',
            settingKey: 'finnedSwordfishEnabled',
            description:
              'Enable Finned Swordfish to be found by the solver.',
          },
          {
            name: 'Enable ALS-xz',
            settingKey: 'alsXzEnabled',
            description:
              'Enable ALS-xz to be found by the solver.',
          },
        ],
      },
      {
        title: 'Exotic Techniques',
        intro:
          'Advanced techniques for experienced solvers, hidden until you click Show exotic techniques. ' +
          'Once enabled, the solver finds them, each at its own place in the difficulty order (Sue-de-Coq: after Finned Swordfish, before Generic AIC). ' +
          'They are never used inside Dynamic Dragon Colouring and do not affect puzzle generation.',
        items: [
          {
            name: 'Enable Sue-de-Coq',
            settingKey: 'sueDeCoqEnabled',
            description:
              'Two or three cells where a row or column crosses a box hold two more digits than cells. A two-digit cell in the row/column and another in the box, each using digits from that set but none in common, lock those digits into the row/column and the box.',
          },
        ],
      },
      {
        title: 'Keyboard shortcuts',
        intro:
          'These work while the grid or the Solution, Candidates, Candidate Colours or Highlight digit pad has focus (click a cell or a pad button first). ' +
          'Click a shortcut in Settings, then press the new key combination; × removes it. Cmd works as Ctrl on a Mac.',
        items: [
          {
            name: HOTKEY_LABELS.toggleInputMode,
            defaultText: formatHotkey(DEFAULT_HOTKEYS.toggleInputMode),
            description: 'Switches whether typing 1-9 places a solution digit or toggles a candidate (the Keyboard Input switches).',
          },
          {
            name: HOTKEY_LABELS.candidateDigit,
            defaultText: `${formatHotkey(DEFAULT_HOTKEYS.candidateDigit)}`,
            description: 'Holding this modifier while typing 1-9 always toggles a candidate, whichever way Keyboard Input is set.',
          },
          {
            name: HOTKEY_LABELS.deselect,
            defaultText: formatHotkey(DEFAULT_HOTKEYS.deselect),
            description: 'Deselects the selected cell.',
          },
          {
            name: HOTKEY_LABELS.undo,
            defaultText: formatHotkey(DEFAULT_HOTKEYS.undo),
            description: 'Undoes the last move.',
          },
          {
            name: HOTKEY_LABELS.redo,
            defaultText: formatHotkey(DEFAULT_HOTKEYS.redo),
            description: 'Redoes the last undone move.',
          },
          {
            name: HOTKEY_LABELS.copyGrid,
            defaultText: formatHotkey(DEFAULT_HOTKEYS.copyGrid),
            description: 'Same as the Copy Puzzle As-Is button: copies the current progress (givens, solved cells, candidates and colours) as a string that pastes into Sudoku.Coach (without the colours) or back into this app.',
          },
          {
            name: HOTKEY_LABELS.paste,
            defaultText: formatHotkey(DEFAULT_HOTKEYS.paste),
            description:
              'Imports whatever is on the clipboard: a puzzle string (81 digits, Sudoku.Coach or SudokuWiki format) or a screenshot of a grid, which is read like a dropped one.',
          },
        ],
      },
      {
        title: 'Display & hints',
        items: [
          {
            name: 'Show strong links',
            settingKey: 'showStrongLinks',
            description: 'Draws every strong link on the grid.',
          },
          {
            name: 'Show bivalue cells',
            settingKey: 'showBivalueCells',
            description: 'Highlights every cell with exactly two candidates.',
          },
          {
            name: 'Light mode for grid',
            settingKey: 'gridWhiteMode',
            description: "Light or dark colour scheme for the grid.",
          },
        ],
      }
    ],
  },
  {
    label: 'Solve Path',
    intro: 'The controls next to Generate/Regenerate on the Solve Path tab.  Customizes the Solve Path shown.',
    sections: [
      {
        title: 'Solve Path',
        items: [
          {
            name: 'Easy Solve',
            settingKey: 'easySolveEnabled',
            description:
              'OFF: each step takes the technique that makes the most progress (most cells solved, then most ' +
              'candidates eliminated, then the simplest).\n\n' +
              'ON: each step takes the simplest technique regardless of progress; ties go to the shortest Dragon, ' +
              'then most candidates eliminated.',
          },
          {
            name: 'Timeout',
            settingKey: 'solvePathTimeoutMs',
            description:
              'How long the Solver attempts to find the optimal solve path before it stops and shows the steps found so far. ' +
              'The "Solvable" check under the grid uses the same limit. \n\n Increase this value if you frequently see the solver timing out (Optimize Dynamic Dragons ON with Exhaustive Dragons OFF can take more time).\n\n' +
              'The search runs in the background.',
          },
        ],
      },
    ],
  },
  {
    label: 'Generate Puzzle',
    intro: 'We can specify what type of Dragon Colouring puzzles to generate here.  However, unless you are looking for the hardest of hard puzzles (Beyond Hell/Almost Impossible SC category), there is no reason to touch these default settings.',
    sections: [
      {
        title: 'Puzzle generation',
        intro: 'Enabling an AIC in Settings unticks its matching "disregards" box.',
        items: [
          {
            name: 'Dragon Generation disregards single digit AIC',
            settingKey: 'dragonGenerationDisregardsSingleDigitAic',
            description:
              'ON: a generated state may also have a Short Single-Digit AIC available alongside the Dragon. ' +
              'OFF: states with one are rejected. Can only be OFF while Short Single-Digit AIC is enabled.',
          },
          {
            name: 'Dragon Generation disregards AIC',
            settingKey: 'dragonGenerationDisregardsAic',
            description:
              'The same for Short AICs (<= 5 links). Can only be OFF while the box above is OFF and Short AIC is enabled. ' +
              'OFF makes Dynamic Dragon puzzles noticeably slower to generate.',
          },
          {
            name: 'Dragon Generation disregards Generic AIC',
            settingKey: 'dragonGenerationDisregardsGenericAic',
            description:
              'The same for Generic AICs. Can only be OFF while the box above is OFF and Generic AIC is enabled.',
          },
          {
            name: 'Dynamic Dragon puzzles must not allow plain Dragon',
            settingKey: 'dynamicDragonPuzzleForbidsPlainDragon',
            description:
              'ON: Dynamic Dragon (or Double plain Dragon) is required to progress the puzzle. \n\n OFF: there is a Dynamic Dragon in the puzzle, but plain Dragon may also progress the puzzle.',
          },
          {
            name: 'Dynamic Dragon puzzles must not allow Double Dragons',
            settingKey: 'dynamicDragonPuzzleForbidsDoubleDragon',
            description:
              'Can only be ON while "Dynamic Dragon puzzles must not allow plain Dragon" is ON.\n\n' +
              'ON: a Dynamic Dragon is required to progress the puzzle.' +
              '\n\nOFF: a Double Dragon may also progress the puzzle.',
          },
          {
            name: 'Dynamic Dragon only uses defaults',
            settingKey: 'dynamicDragonPuzzleUsesDefaultsOnly',
            description:
              'ON: "Double Dynamic Dragon Colouring puzzle" picks from a stock where the Dynamic Dragons need only the default ' +
              'Dynamic Dragon techniques (at most 3 per step), checked with every other technique enabled except Sue-de-Coq, ' +
              'so it holds whatever techniques you have enabled.' +
              '\n\nOFF: Double Dynamic Dragon puzzles come from the stock that needs every Dynamic Dragon technique.' +
              '\n\n"Dynamic Dragon Colouring puzzle" is the same either way: its Dynamic Dragon only ever uses the default techniques.',
          },
          {
            name: 'Dragon puzzle generation max timeout',
            settingKey: 'dragonGenerationTimeoutMs',
            description:
              'How long to search before giving up. Keep this on the default value unless you are experiencing performance issues.',
          },
        ],
      },
    ],
  },
]
