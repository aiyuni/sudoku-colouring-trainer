import { GENERIC_AIC_MAX_LENGTH } from './sudoku/SudokuGenericAicFinder'
import { MIN_BASE_MEDUSA_CANDIDATES, type AppSettings } from './settingsDefaults'

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
  "The defaults give the best Colouring experience. Leave them alone if you're learning Colouring or don't know what AICs are, " +
  'and use "Reset to defaults" in Settings to get back to them at any time. \n\nTo start, generate or import a puzzle. ' +
  '\n\n For how the techniques work, see the [Techniques overview](how-it-works).\n\n' +
  'For advanced players, the tabs below explain the customizations for the solver.'

export const HELP_TABS: HelpTab[] = [
  {
    label: 'Dragon Configuration',
    intro: 'The Dragon Configuration menu.  Every setting here has a major impact on what the solver shows.  Advanced players may want to play around with these settings',
    sections: [
      {
        title: 'Dragon Colouring',
        intro: 'These apply to both plain and Dynamic Dragon Colouring.',
        items: [
          {
            name: 'Exhaustive Dragon Colouring',
            settingKey: 'exhaustiveDragonColouring',
            description:
              'ON: Recycles its colours and does not stop on the first elimination it finds.  1 Dragon might be able to solve the entire puzzle. ' +
              '' +
              'This is the setting most human-like, and shows promotions.\n\n' +
              'OFF: stops at the first elimination (AIC-like).',
          },
          {
            name: 'Optimize Dragons',
            settingKey: 'optimizeDragons',
            description:
              'OFF: the two colours take turns to extend.\n\n' +
              'ON: for each Medusa base, searches for the order of colour extensions that reaches the elimination(s) ' +
              'with the fewest extensions.\n\n' +
              'Find by elims always uses this, whether ON or OFF.',
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
        title: 'Dynamic Dragon Colouring',
        items: [
          {
            name: 'Optimize Dynamic Dragons',
            settingKey: 'optimizeDynamicDragons',
            description:
              'ON: Dynamic Dragons get the Optimize Dragons search (whether or not that is ON), and at every step it also ' +
              'tries every candidate the Dynamic techniques can force, not just the first one found. Dynamic Dragons ' +
              'typically come out with far fewer extensions.\n\n' +
              'Slower, especially with AICs enabled. It never finds a Dynamic Dragon that OFF would not, and never uses ' +
              'more extensions than Optimize Dragons alone. Find by elims follows this setting.',
          },
          {
            name: 'Limit to 1 AIC per step',
            settingKey: 'aicLimitPerDragonStep',
            description:
              'ON: a Dynamic Dragon step may chain at most one AIC. \n\nOFF: no limit - a stronger Dragon, but much ' +
              'harder for a human to find.',
          },
          {
            name: 'Auto-solve includes AICs',
            settingKey: 'dynamicDragonAutoSolveIncludesAics',
            description:
              'OFF: the Dynamic Dragon auto-solve button skips Dragons whose steps needed an AIC, even with AICs ' +
              'enabled. \n\n ON: applies those too.',
          },
        ],
      },
      {
        title: 'Select Dynamic Dragon Colouring techniques',
        items: [
          {
            name: 'Select Dynamic Dragon Colouring techniques',
            //settingKey: 'allowedRule3Techniques',
            description:
              "The most important setting for Dynamic Dragons. Controls the non-colouring techniques Dynamic Dragon may apply under a colour's assumption to extend the Dragon. " +
              'Hidden Single, Locked Candidates and Naked Pair are always ON. Each AIC kind only takes effect ' +
              'while that AIC is enabled in Settings.',
          },
        ],
      },
    ],
  },
  {
    label: 'Settings',
    intro: 'The ⚙ Settings menu.  Controls the techniques the solver uses.',
    sections: [
      {
        title: 'Keyboard input',
        items: [
          {
            name: 'Toggle input',
            settingKey: 'keyboardMode',
            description: 'Whether typing a digit places a solution or toggles a candidate.',
          },
        ],
      },
      {
        title: 'Display & hints',
        items: [
          {
            name: 'Show strong links',
            settingKey: 'showStrongLinks',
            description: 'Draws every strong link (conjugate pairs) on the grid.',
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
      },
      {
        title: 'Techniques',
        intro: 'Enables or disables certain techniques, for both the solver and the generator.  Advanced players may want to enable AICs',
        items: [
          {
            name: 'Enable Short Single-Digit AIC',
            settingKey: 'shortSingleDigitAicEnabled',
            description: 'Single-digit AICs of length <= 3. Leave OFF for a pure Colouring experience.',
          },
          {
            name: 'Enable Short AIC',
            settingKey: 'shortAicEnabled',
            description: 'General AICs of length <= 5. Needs Short Single-Digit AIC ON.',
          },
          {
            name: 'Enable Generic AIC',
            settingKey: 'genericAicEnabled',
            description:
              `AICs longer than a Short AIC, up to ${GENERIC_AIC_MAX_LENGTH} links. Needs Short AIC ON, and asks ` +
              'to confirm first because Dragon puzzle generation gets slower.',
          },
        ],
      },
    ],
  },
  {
    label: 'Solve Path',
    intro: 'The checkbox next to Generate/Regenerate on the Solve Path tab.',
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
        ],
      },
    ],
  },
  {
    label: 'Generate Puzzle',
    intro: 'We can specify what type of Dragon Colouring puzzles to generate. Unless you are looking for the hardest of hard puzzles (Beyond Hell/Almost Impossible SC category), there is no reason to touch these.',
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
              'ON: Dynamic Dragon is required to progress the puzzle. \n\n OFF: there is a Dynamic Dragon in the puzzle, but plain Dragon may also progress the puzzle.',
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
