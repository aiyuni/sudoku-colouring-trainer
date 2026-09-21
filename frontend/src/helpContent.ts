import { MIN_BASE_MEDUSA_CANDIDATES, type AppSettings } from './settingsDefaults'

/**
 * The text of the "Settings guide" page (the ? button next to Generate Puzzle).
 * This file is plain data on purpose - to change what the page says, edit the
 * strings below; nothing else needs touching.
 *
 * How it's put together:
 *  - HELP_SECTIONS is a list of sections, each with a title, an optional
 *    `intro` paragraph, and a list of `items` (one per setting).
 *  - An item's `name` should match the label in the Settings menu.
 *  - Set `settingKey` (a key of AppSettings in settingsDefaults.ts) and the
 *    page shows "Default: ..." for you, read straight from the real defaults,
 *    so it can never go out of date. For anything that isn't one of those
 *    settings, use `defaultText` instead to write the default yourself.
 *  - `description` is a plain-text paragraph. Use "\n\n" to start a new one.
 *  - HELP_INTRO can hold a link: write [some text](how-it-works) and "some
 *    text" becomes a link that opens the How It Works page.
 *  - To add a setting: add an item to a section. To add a section: add an
 *    object to HELP_SECTIONS. To reorder: move things around.
 */

export interface HelpItem {
  /** Shown as the item's heading - match the label in the Settings menu. */
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

export const HELP_TITLE = 'QuickStart / Settings explanation'

export const HELP_INTRO =
  "This section explains the various available Settings.  Use default settings for the best Colouring experience, or if you don't know what AICs are.   To start, generate or import a puzzle. "

export const HELP_SECTIONS: HelpSection[] = [
    {
    title: 'Colouring techniques',
    items: [
      {
        name: 'Colouring Techniques',
        description:
          'For an overview of Colouring techniques, [click here](how-it-works) and navigate to the correct tab',
      },
    ],
  },
  {
    title: 'Techniques Settings',
    intro:
      'These switch whole solving techniques ON or OFF.  They apply to both the solver and generator.',
    items: [
      {
        name: 'Enable Short Single-Digit AIC',
        settingKey: 'shortSingleDigitAicEnabled',
        description:
          'When OFF, the solver never looks for short single-digit AIC chains (length <= 3). Leave it OFF ' +
          'for a pure Colouring experience.',
      },
      {
        name: 'Enable Short AIC',
        settingKey: 'shortAicEnabled',
        description:
          'When OFF, the solver never looks for the general short AIC chains (length <= 5). It can only be turned ON while Short Single-Digit AIC is ON.',
      },
      {
        name: `Dragon: require ${MIN_BASE_MEDUSA_CANDIDATES}+ base Medusa candidates`,
        settingKey: 'minBaseMedusaFilter',
        description:
          `When ON, the solver will only consider Dragon or Dynamic Dragon Colouring if its 3D Medusa base has ` +
          `least ${MIN_BASE_MEDUSA_CANDIDATES} coloured candidates.  As it is rare to consider starting a Dragon with less than 3 coloured candidates, turning this ON filters for easily spottable Dragons. `
      },
    ],
  },
  {
    title: 'Dynamic Dragon Colouring techniques',
    intro:
      'Dynamic Dragon Colouring can reach further than plain Dragon Colouring by using all other non-colouring techniques to extend the Dragon. This list is which of those techniques it may use, both when ' +
      'solving and when generating puzzles.',
    items: [
      {
        name: 'Select Dynamic Dragon Colouring techniques',
        //settingKey: 'allowedRule3Techniques',
        description:
          'Tick the techniques you want Dragon Colouring to use. Hidden Single, Locked Candidates and Naked Pair are always ON.  \n\n' +
          'AIC options for Dragon Colouring cannot be turned ON unless AIC is enabled (see above).',
      },
    ],
  },
  {
    title: 'Dragon Colouring',
    items: [
      {
        name: 'Exhaustive Dragon Colouring',
        settingKey: 'exhaustiveDragonColouring',
        description:
          'When ON, Dragon Colouring does not stop at the first elimination; it will continue to colour, only stopping when one colour is proven false or no more eliminations can be found. ' +
          'Turn this ON to mimic human-friendly solving approach and to see promotions. \n\n' +
          'When OFF, it stops at the first elimination it finds, mimicing AIC-like behaviour.',
      },
      {
        name: 'Limit to 1 AIC per step',
        settingKey: 'aicLimitPerDragonStep',
        description:
          'When ON and AIC is enabled for Dynamic Dragon Colouring, a single Dragon Colouring step may ' +
          'utlize at most one AIC. \n\n Turn it OFF to allow as many as the step needs, which makes the Dragon more powerful, but makes the technique much more harder to find for a human player.',
      },
      {
        name: 'Auto-solve includes AICs',
        settingKey: 'dynamicDragonAutoSolveIncludesAics',
        description:
          'When OFF, the Dynamic Dragon Colouring auto-solve feature skips any Dragon whose steps needed an AIC, even ' +
          'if AICs are enabled. Turn it ON to let auto-solve use those too.',
      },
    ],
  },
  {
    title: 'Puzzle generation',
    intro: 'These are in the Generate Puzzle menu and only affect the Dragon and Dynamic Dragon practice puzzles.',
    items: [
      {
        name: 'Dragon Generation disregards single digit AIC',
        settingKey: 'dragonGenerationDisregardsSingleDigitAic',
        description:
          'When ON, a generated puzzle may also have a short single-digit AIC available at the same time as the Dragon ' +
          'technique. When OFF, generation rejects any position where one exists, so Dragon is the only way forward. ' +
          'It can only be turned OFF while Short Single-Digit AIC is enabled.',
      },
      {
        name: 'Dragon Generation disregards AIC',
        settingKey: 'dragonGenerationDisregardsAic',
        description:
          'The same functionality as above, except for short AICs (length <=5). It can only be turned OFF when the setting above is also OFF and ' +
          'Short AIC is enabled. \n\n  Note that turning this option OFF makes it harder to generate a Dynamic Dragon Colouring puzzle.',
      },
      {
        name: 'Dragon puzzle generation max timeout',
        settingKey: 'dragonGenerationTimeoutMs',
        description:
          'How long to keep searching for a suitable puzzle before giving up. Dynamic Dragon puzzles are rare and can ' +
          'take anywhere from a few seconds to a couple of minutes to find.',
      },
    ],
  }
]
