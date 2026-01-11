# alias-selector

Small helper that lists every alias defined in your `~/.zshrc` and lets you pick one to execute. No more trying to remember that obscure `kubectl` helper you wrote two months ago.

## Installation
1. Install dependencies
   ```bash
   cd alias-selector
   npm install
   ```
2. Build the TypeScript source
   ```bash
   npm run build
   ```
3. Link it to your shell (example for zsh)
   ```bash
   # ~/.zshrc
   alias aaa="node /absolute/path/to/alias-selector/dist/index.js"
   ```
   Replace `/absolute/path/to` with this folder on your machine. Now typing `aaa` launches the selector.

## Development
- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run directly with ts-node (requires ts-node installed)
- `npm start` - Build and run the compiled output

## Usage
- The CLI shows every alias except ones you exclude via `ALIAS_SELECTOR_EXCLUDE` (comma-separated list, default `tf,k,aaa`).
- Selecting an alias executes it inside an interactive `zsh` subshell so environment and nested aliases still work.
- `cd` aliases open a new shell in the target directory so you can keep working there.

## Configuration
| Env Var | Default | Description |
| --- | --- | --- |
| `ALIAS_SELECTOR_FILE` | `~/.zshrc` | Alternate file to scan for aliases |
| `ALIAS_SELECTOR_EXCLUDE` | `tf,k,aaa` | Comma-separated alias names to hide |

## Notes
- Only lines that look like `alias name='command'` are detected. If you keep aliases in other files, `source` them into the file you point at via `ALIAS_SELECTOR_FILE`.
- Errors are reported with actionable messages—ensure your shell config exists and is readable.
- Now written in TypeScript for better type safety and maintainability.
