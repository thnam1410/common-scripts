import * as fs from "fs";
import * as path from "path";
import prompts from "prompts";

interface VercelProject {
  name: string;
  projectId: string;
  teamId?: string;
}

const PROJECTS_FILE = path.join(__dirname, "projects.json");
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

// Read projects from JSON file
function getProjects(): VercelProject[] {
  if (!fs.existsSync(PROJECTS_FILE)) {
    console.error(
      `Projects file not found at ${PROJECTS_FILE}. Please create a projects.json file.`
    );
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(PROJECTS_FILE, "utf-8");
    const projects = JSON.parse(content);

    if (!Array.isArray(projects)) {
      console.error("projects.json must contain an array of projects");
      process.exit(1);
    }

    return projects;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Unable to read ${PROJECTS_FILE}: ${errorMessage}`);
    process.exit(1);
  }
}

// Pause a Vercel project
async function pauseProject(
  projectId: string,
  teamId?: string
): Promise<void> {
  const url = teamId
    ? `https://api.vercel.com/v1/projects/${projectId}/pause?teamId=${teamId}`
    : `https://api.vercel.com/v1/projects/${projectId}/pause`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VERCEL_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to pause project: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    console.log("✓ Project paused successfully");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Error pausing project: ${errorMessage}`);
    process.exit(1);
  }
}

// Resume (unpause) a Vercel project
async function resumeProject(
  projectId: string,
  teamId?: string
): Promise<void> {
  const url = teamId
    ? `https://api.vercel.com/v1/projects/${projectId}/unpause?teamId=${teamId}`
    : `https://api.vercel.com/v1/projects/${projectId}/unpause`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VERCEL_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to resume project: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    console.log("✓ Project resumed successfully");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Error resuming project: ${errorMessage}`);
    process.exit(1);
  }
}

// Main CLI function
async function main(): Promise<void> {
  // Check for Vercel token
  if (!VERCEL_TOKEN) {
    console.error(
      "Error: VERCEL_TOKEN environment variable is not set.\n" +
        "Please create a token at https://vercel.com/account/tokens\n" +
        'and set it with: export VERCEL_TOKEN="your_token_here"'
    );
    process.exit(1);
  }

  const projects = getProjects();

  if (projects.length === 0) {
    console.log("No projects found in projects.json");
    return;
  }

  // Prompt for action
  const actionResponse = await prompts({
    type: "select",
    name: "action",
    message: "What would you like to do?",
    choices: [
      { title: "Pause a project", value: "pause" },
      { title: "Resume a project", value: "resume" },
    ],
  });

  if (!actionResponse.action) {
    console.log("Cancelled");
    return;
  }

  // Prompt for project selection
  const projectResponse = await prompts({
    type: "select",
    name: "project",
    message: "Select a project:",
    choices: projects.map((p) => ({
      title: `${p.name}${p.teamId ? " (Team)" : " (Personal)"}`,
      value: p,
    })),
  });

  if (!projectResponse.project) {
    console.log("Cancelled");
    return;
  }

  const selectedProject: VercelProject = projectResponse.project;

  // Confirmation
  const confirmationMessage =
    actionResponse.action === "pause"
      ? `Are you sure you want to PAUSE "${selectedProject.name}"?`
      : `Are you sure you want to RESUME "${selectedProject.name}"?`;

  const confirmResponse = await prompts({
    type: "confirm",
    name: "confirmed",
    message: confirmationMessage,
    initial: false,
  });

  if (!confirmResponse.confirmed) {
    console.log("Cancelled");
    return;
  }

  // Execute action
  console.log(
    `${actionResponse.action === "pause" ? "Pausing" : "Resuming"} project: ${selectedProject.name}...`
  );

  if (actionResponse.action === "pause") {
    await pauseProject(selectedProject.projectId, selectedProject.teamId);
  } else {
    await resumeProject(selectedProject.projectId, selectedProject.teamId);
  }
}

// Handle errors and run
main().catch((error) => {
  if (error.name !== "ExitPromptError") {
    console.error("Unexpected error:", error);
    process.exit(1);
  }
});
