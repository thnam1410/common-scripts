import * as fs from "fs";
import * as path from "path";
import * as tty from "tty";
import { spawn } from "child_process";
import inquirer from "inquirer";

interface Alias {
  name: string;
  command: string;
}

const DEFAULT_EXCLUDE = process.env.ALIAS_SELECTOR_EXCLUDE || "tf,k,aaa";
const DEFAULT_ALIAS_FILE =
  process.env.ALIAS_SELECTOR_FILE || path.join(process.env.HOME || "", ".zshrc");

// Read alias file and extract aliases
function getAliases(): Alias[] {
  if (!fs.existsSync(DEFAULT_ALIAS_FILE)) {
    console.error(
      `Alias file not found at ${DEFAULT_ALIAS_FILE}. Set ALIAS_SELECTOR_FILE to override.`
    );
    process.exit(1);
  }

  let content: string;
  try {
    content = fs.readFileSync(DEFAULT_ALIAS_FILE, "utf-8");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Unable to read ${DEFAULT_ALIAS_FILE}: ${errorMessage}`);
    process.exit(1);
  }

  const aliasRegex = /^alias\s+(\w+)\s*=\s*['\"]([^'\"]+)['\"]/gm;
  const aliases: Alias[] = [];

  let match: RegExpExecArray | null;
  while ((match = aliasRegex.exec(content)) !== null) {
    aliases.push({ name: match[1], command: match[2] });
  }

  return aliases;
}

// Prompt user to select an alias
async function selectAndRunAlias(): Promise<void> {
  const isPrintMode = process.argv.includes("--print");

  const excludeList = DEFAULT_EXCLUDE.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const aliases = getAliases();
  if (aliases.length === 0) {
    console.log(`No aliases found in ${DEFAULT_ALIAS_FILE}`);
    return;
  }

  const visibleAliases = aliases.filter((x) => !excludeList.includes(x.name));
  if (visibleAliases.length === 0) {
    console.log(
      "All aliases were filtered out. Adjust ALIAS_SELECTOR_EXCLUDE to show some entries."
    );
    return;
  }

  // In --print mode, render the interactive UI on /dev/tty so stdout stays
  // clean for shell command substitution $(...) to capture just the command.
  let ttyIn: tty.ReadStream | undefined;
  let ttyOut: tty.WriteStream | undefined;
  const promptFn = isPrintMode
    ? inquirer.createPromptModule({
        input: (ttyIn = new tty.ReadStream(fs.openSync("/dev/tty", "r"))),
        output: (ttyOut = new tty.WriteStream(fs.openSync("/dev/tty", "w"))),
      })
    : inquirer.createPromptModule();

  let selectedAlias: string;
  try {
    const result = await promptFn([
      {
        type: "list",
        name: "selectedAlias",
        message: "Select an alias to execute:",
        choices: visibleAliases.map((a) => ({
          name: `${a.name} → ${a.command}`,
          value: a.command,
        })),
      },
    ]);
    selectedAlias = result.selectedAlias;
  } catch (error) {
    // Handle user interruption (Ctrl+C)
    if (error instanceof Error && error.name === "ExitPromptError") {
      process.stderr.write("\nCancelled!\n");
      process.exit(0);
    }
    throw error;
  }

  if (isPrintMode) {
    ttyIn?.destroy();
    ttyOut?.destroy();
    // Print only the command to stdout; the shell eval's it in the current shell.
    process.stdout.write(selectedAlias + "\n");
    return;
  }

  // Legacy spawn mode (used when invoked without --print)
  console.log(`Running: ${selectedAlias}`);

  const ZSH = "/bin/zsh";

  // Only treat as a simple cd if the command is purely "cd <dir>" with no shell operators
  const simpleCdMatch = /^cd\s+([^&|;]+)$/.exec(selectedAlias);
  if (simpleCdMatch) {
    let targetDir = simpleCdMatch[1].trim();
    // Replace ~ with the home directory
    targetDir = targetDir.replace(/^~(\/|$)/, `${process.env.HOME}$1`);

    try {
      const shell = spawn(ZSH, ["-i"], { stdio: "inherit", cwd: targetDir });
      console.log(`Opened shell in: ${targetDir}`);
      shell.on("exit", (code, signal) => {
        if (signal === "SIGINT" || code === 130) {
          console.log("\nCancelled!");
        }
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Failed to change directory: ${errorMessage}`);
    }
  } else {
    const shell = spawn(ZSH, ["-i", "-c", selectedAlias], {
      stdio: "inherit",
    });

    shell.on("exit", (code, signal) => {
      if (signal === "SIGINT" || code === 130) {
        console.log("\nCancelled!");
      }
    });
  }
}

selectAndRunAlias();
