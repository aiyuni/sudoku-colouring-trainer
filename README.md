# Advanced Sudoku Colouring Solver/Trainer

An advanced Sudoku web app and solver focused on helping you learn to solve Sudoku puzzles (of all difficulties) using human-friendly **Colouring techniques** , rather than chain-based techniques, guess-and-check, or brute force.

Try it here: https://aiyuni.github.io/sudoku-colouring-trainer/

## Features

* **Step-by-step**, human-readable **Colouring technique explanations**
* Every Colouring techniques implemented: 

  * **[Simple Colouring](https://www.sudokuwiki.org/Simple_Colouring)** — a widely documented single-digit Colouring technique.
  * **[3D Medusa](https://www.sudokuwiki.org/3D_Medusa)** — a widely documented advanced multi-digit Colouring technique.
  * **Dragon Colouring** — a novel, previously undocumented Colouring technique developed and implemented for this solver. Dragon Colouring builds on 3D Medusa, and is designed to solve puzzles where even 3D Medusa cannot.
    * In testing against the hardest puzzles from Sudoku.Coach, Dragon Colouring solves all **Hell** and **Beyond Hell** puzzles, whereas 3D Medusa gets stuck at most **Hell** puzzles.
* Generate puzzles that can only be solved by Simple Colouring, Medusa, or Dragon Colouring, for practice.
* Extremely strong Colouring solver:
  * Shows **every** possible Colouring technique to progress a given Sudoku grid state, sorted by complexity.  
  * Customizable Solve Path: Find the **easiest** solve path, or the **quickest** solve path.
  * For advanced users/solvers:  implements all traditional AIC, Fish, ALS-XZ, and Uniqueness techniques, all of which Colouring can utilize. 
* Import puzzles via OCR or grid strings from by **[Sudoku.Coach](https://sudoku.coach/)** and **[SudokuWiki](https://www.sudokuwiki.org/)**
