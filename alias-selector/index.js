const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const inquirer = require("inquirer").default;

const ZSHRC_PATH = path.join(process.env.HOME, ".zshrc");

// Read .zshrc and extract aliases
function getAliases() {
  if (!fs.existsSync(ZSHRC_PATH)) {
    console.error("~/.zshrc not found!");
    process.exit(1);
  }

  const content = fs.readFileSync(ZSHRC_PATH, "utf-8");
  const aliasRegex = /^alias\s+(\w+)=['"](.*)['"]$/gm;
  const aliases = [];

  let match;
  while ((match = aliasRegex.exec(content)) !== null) {
    aliases.push({ name: match[1], command: match[2] });
  }

  return aliases;
}

// Prompt user to select an alias
async function selectAndRunAlias() {
  const aliases = getAliases();
  if (aliases.length === 0) {
    console.log("No aliases found in ~/.zshrc");
    return;
  }

  const excludeList = ["tf", "k", "aaa"];

  let selectedAlias;
  try {
    const result = await inquirer.prompt([
      {
        type: "list",
        name: "selectedAlias",
        message: "Select an alias to execute:",
        choices: aliases
          .filter((x) => !excludeList.includes(x.name))
          .map((a) => ({
            name: `${a.name} → ${a.command}`,
            value: a.command,
          })),
      },
    ]);
    selectedAlias = result.selectedAlias;
  } catch (error) {
    // Handle user interruption (Ctrl+C)
    if (error.name === 'ExitPromptError') {
      console.log('\nCancelled!');
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
      spawn('zsh', ['-i'], { stdio: 'inherit', cwd: targetDir });
      console.log(`Changed directory to: ${process.cwd()}`);
    } catch (err) {
      console.error(`Failed to change directory: ${err.message}`);
    }
  } else {
    // const shell = spawn(selectedAlias, { stdio: "inherit", shell: true });
    const shell = spawn('zsh', ['-i', '-c', selectedAlias], { stdio: 'inherit' });

    shell.on("exit", (code, signal) => {
      if (signal === 'SIGINT' || code === 130) {
        console.log('\nCancelled!');
      }
    });
  }
}

selectAndRunAlias();
