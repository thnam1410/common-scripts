import * as fs from "fs";
import * as path from "path";
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

  let selectedAlias: string;
  try {
    const result = await inquirer.prompt([
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
      console.log("\nCancelled!");
      process.exit(0);
    }
    throw error;
  }

  console.log(`Running: ${selectedAlias}`);

  if (selectedAlias.startsWith("cd ")) {
    // Get target directory from the alias
    let targetDir = selectedAlias.split("cd ")[1].trim();
    // Replace ~ with the home directory
    targetDir = targetDir.replace(/^~(\/|$)/, `${process.env.HOME}$1`);

    try {
      spawn("zsh", ["-i"], { stdio: "inherit", cwd: targetDir });
      console.log(`Opened shell in: ${targetDir}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Failed to change directory: ${errorMessage}`);
    }
  } else {
    const shell = spawn("zsh", ["-i", "-c", selectedAlias], {
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
