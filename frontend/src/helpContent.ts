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
 *    text" becomes a link that opens the Learn techniques page.
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
  "The defaults give the best Colouring and Sudoku solving experience. Leave them alone if you're learning Colouring,  " +
  'and use "Reset to defaults" in Settings to get back to them at any time. \n\nTo start, generate or import a puzzle. ' +
  '\n\n For how the techniques work, see the [Learn Techniques](how-it-works) section.\n\n' +
  'For advanced solvers, the tabs below explain the customizations for the solver.' 

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
              `${MIN_BASE_MEDUSA_CANDIDATES} coloured candidates, i.e. the easily spotted ones. `
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
              'Enables the solver to find Double Plain Dragons, to solve puzzles that a single Plain Dragon cannot. Refer to "Learn techniques" for more details.\n\n' +
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
              'Enables the solver to find Double Dynamic Dragons.  A Double Dynamic Dragon can solve puzzles normal Dynamic Dragons cannot.  See "Learn techniques" for an explanation.\n\n' +
              'Follows all Dynamic Dragon settings. Can only be ON while both Double Dragons and Dynamic Dragons are enabled; turning either off turns it off too.',
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
              '\n\n Locked Candidates & Naked Pair are always ON.'
          },
        ],
      },
    ],
  },
  {
    label: 'Technique Selections',
    intro: 'The Technique Selections menu.  Controls the techniques the solver uses.',
    sections: [
      {
        title: 'Basic Techniques',
        intro:
          'Naked Singles, Hidden Singles, Naked Pairs, Locked Candidates, Naked Triples, Naked Quads and Hidden Pairs. ' +
          'These are always used by the solver and cannot be turned off.',
        items: [],
      },
      {
        title: 'Colouring Techniques',
        intro:
          'Simple Colouring, 3D Medusa and Dragon Colouring are always used by the solver and cannot be turned off. ' +
          'Double Dragon, Dynamic Dragon and Double Dynamic Dragon Colouring can be turned off here or in the Dragon Configuration menu.',
        items: [
          {
            name: 'Double Dragon Colouring',
            settingKey: 'doubleDragonEnabled',
            description: 'Same as Dragon Configuration -> Enable Double Dragons.',
          },
          {
            name: 'Dynamic Dragon Colouring',
            defaultText: 'On',
            description: 'Same as Dragon Configuration -> Disable Dynamic Dragons, the other way round: ticked here means Dynamic Dragons are on.',
          },
          {
            name: 'Double Dynamic Dragon Colouring',
            settingKey: 'doubleDynamicDragonEnabled',
            description: 'Same as Dragon Configuration -> Enable Double Dynamic Dragons. Can only be ON while both Double Dragon Colouring and Dynamic Dragon Colouring are ON; turning either off turns it off too.',
          },
        ],
      },
      {
        title: 'Techniques',
        intro:
          'Unique Rectangle, Bivalue Oddagon, BUG+1 and Avoidable Rectangle are always used by the solver and cannot be turned off. ' +
          'The rest enables or disables certain techniques for the solver. Advanced players may want to enable AICs or fish.  Note that Plain Dragons will find all AICs eliminations.',
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
              'General AICs of length up to 5, including W-Wings (shown by that name and listed first) and Y-Wings (shown by that name, with their pivot and wing cells, listed next). Needs Short Single-Digit AIC ON.',
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
        ],
      },
      {
        title: 'Extreme Techniques',
        intro:
          'Advanced techniques for experienced solvers, hidden by default.  ' +
          'Dynamic Dragon Colouring becomes especially strong in combination with these techniques. \n\n' +
          'If you are still reading this, then you know what you are doing - enable them at your own discretion.',
        items: [
          {
            name: 'Enable Sue-de-Coq',
            settingKey: 'sueDeCoqEnabled',
            description:
              'Enable Sue-de-Coq to be found by the solver.',
          },
          {
            name: 'Enable Extended UR',
            settingKey: 'extendedUrEnabled',
            description:
              'Enable Extended Unique Rectangles (Type 1) to be found by the solver.  Recognizes only 8-cell patterns.'
          },
          {
            name: 'Enable Grouped AIC',
            settingKey: 'groupedAicEnabled',
            description:
              'Enable Grouped AIC to be found by the solver.',
          },
          {
            name: 'Enable ALS-xz',
            settingKey: 'alsXzEnabled',
            description:
              'Enable ALS-xz to be found by the solver. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu)',
          },
          {
            name: 'Enable UR-AIC',
            settingKey: 'urAicEnabled',
            description:
              'Enable UR-AIC to be found by the solver.  It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu).',
          },
          {
            name: 'Enable ALS-AIC',
            settingKey: 'alsAicEnabled',
            description:
              'Enable ALS-AIC to be found by the solver. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu).',
          },
        ],
      },
    ],
  },
  {
    label: 'Settings',
    intro: 'The ⚙ Settings menu.  Keyboard hotkeys and display options.',
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
            description: 'Same as the Copy Puzzle As-Is button: copies the current progress (givens, solved cells, candidates and colours) as a string.',
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
          {
            name: 'Theme',
            settingKey: 'theme',
            description:
              "The colours of the whole page: System default (follows your device's light or dark setting), Light, Dark, Sepia, Solarized Light, Solarized Dark, Nord, Dracula, Midnight (true black), Dragon, Medusa or Rainbow. In a dark theme the grid stays white while \"Light mode for grid\" is on; turn that off to see the theme's own grid.",
          },
        ],
      },
      {
        title: 'Techniques list',
        items: [
          {
            name: 'All Possible Techniques',
            settingKey: 'allPossibleTechniques',
            description:
            'This setting affects the Techniques List only.  Does not affect the Solve Path. \n\n' +
              'OFF: The techniques list only shows a technique if there are no easier techniques that finds the same eliminations.\n\n' +
              'ON: every row of every enabled technique is listed, even when an easier technique finds the same eliminations - ' +
              'unless the easier technique is one of the Basic techniques.\n\n',
          },
          {
            name: 'Prefer easiest techs within dragon',
            settingKey: 'techniquesListEasiestDragonTechniquesFirst',
            description:
              'The checkbox at the top of the Techniques tab. Decides the order of the Dynamic Dragon rows (and of the ' +
              'Double Dynamic Dragon rows).\n\n' +
              'ON: the Dragon that needs the easiest techniques comes first. First, the hardest technique group it uses ' +
              '(Defaults, Advanced, Brutal, Unfair - the groups of Dragon Configuration\'s technique list). If tied, ' +
              'the fewest techniques used within a step, counting only the Dragon\'s busiest step. If still ' +
              'tied, the shortest Dragon.\n\n' +
              'OFF: the shortest Dragon comes first, regardless of the technqiues used.\n\n' +
              'Only the order of the list changes. It is separate from the Solve Path tab\'s checkbox of the same name: ' +
              'neither affects the other.',
          },
        ],
      },
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
            name: 'Prefer easiest techs within dragon',
            settingKey: 'preferEasiestDragonTechniques',
            description:
              'Only available while Easy Solve is ON. Decides which Dragon a step takes when several of the same ' +
              'kind are available - in practice, which Dynamic Dragon.\n\n' +
              'ON: the Dragon that needs the easiest techniques wins. First, the hardest technique group it uses ' +
              '(Defaults, Advanced, Brutal, Unfair - the groups of Dragon Configuration\'s technique list). If tied, ' +
              'the fewest techniques chained in a single step, counting only the Dragon\'s busiest step. If still ' +
              'tied, the shortest Dragon.\n\n' +
              'OFF: the shortest Dragon wins, whatever techniques it needs.',
          },
          {
            name: 'Prefer easier double dragons',
            settingKey: 'preferEasierDoubleDragons',
            description:
              'Only available while Easy Solve is ON (turning Easy Solve off turns this off too), and only matters ' +
              'with Double Dynamic Dragon Colouring enabled.\n\n' +
              'When every single Dynamic Dragon on the grid needs an Unfair technique, the Techniques list also shows ' +
              'the Double Dynamic Dragons that work without any Unfair technique. Likewise, when every single Dynamic ' +
              'Dragon needs something beyond the Defaults, it also shows the Double Dynamic Dragons that use only the ' +
              'Defaults.\n\n' +
              'ON: the solve path treats those Double Dynamic Dragons as easier than a single Dynamic Dragon.\n\n' +
              'OFF: a Double Dynamic Dragon is always the hardest technique.',
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
        title: 'Your own puzzle',
        items: [
          {
            name: 'Create From Empty Grid',
            description:
              'Clears the grid so you can enter a puzzle of your own. Fill in its givens, then click "Confirm givens" under the grid: ' +
              'the digits become fixed givens and you can solve the puzzle as usual. ' +
              'The givens are only accepted when they have exactly one solution - otherwise you are told why and can keep editing.',
          },
        ],
      },
      {
        title: 'Puzzle generation',
        intro: 'Enabling an AIC in Technique Selections unticks its matching "disregards" box.',
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
              'ON: The puzzle will be generated at a state where the Dynamic Dragon or Double Dynamic Dragon that progress the puzzle only uses Basic techniques.  ' +
              '\n\nOFF: The puzzle is generated so that any Dynamic/Double Dynamic Dragon is fair game.',
          },
          {
            name: 'Dragon puzzle generation max timeout',
            settingKey: 'dragonGenerationTimeoutMs',
            description:
              'How long the generator tries to generate a proper puzzle before giving up. Keep this on the default value unless you are experiencing performance issues, as I do not expect searches to take longer than 30 seconds.',
          },
        ],
      },
    ],
  },
]
