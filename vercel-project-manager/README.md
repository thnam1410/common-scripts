# vercel-project-manager

CLI tool to pause and resume Vercel projects using the Vercel REST API.

## Installation

```bash
cd vercel-project-manager
npm install
```

## Setup

### 1. Get your Vercel API Token

Create an API token at https://vercel.com/account/tokens

### 2. Set the environment variable

```bash
export VERCEL_TOKEN="your_token_here"
```

You can add this to your `~/.zshrc` or `~/.bashrc` to make it persistent.

### 3. Configure your projects

Edit the `projects.json` file to include your Vercel projects:

```json
[
  {
    "name": "My Awesome Project",
    "projectId": "prj_xxxxxxxxxxxxxxxxxx",
    "teamId": "team_xxxxxxxxxxxxxxxxxx"
  },
  {
    "name": "Personal Blog",
    "projectId": "prj_yyyyyyyyyyyyyyyy"
  }
]
```

**Finding your Project ID and Team ID:**

- **Project ID**: Go to your project settings on Vercel Dashboard → General → Project ID
- **Team ID** (optional): Only required for team projects. Go to your team settings → General → Team ID

If a project is in your personal account, you can omit the `teamId` field.

## Usage

```bash
npm start
```

The CLI will guide you through:

1. Choosing an action (Pause or Resume)
2. Selecting a project from your configured list
3. Confirming the action

## Features

- ✓ Interactive CLI with prompts
- ✓ Pause Vercel projects to save costs
- ✓ Resume projects when needed
- ✓ Support for both personal and team projects
- ✓ Confirmation prompt before taking action
- ✓ Clear error messages and feedback

## API Endpoints Used

- **Pause**: `POST /v1/projects/{projectId}/pause`
- **Resume**: `POST /v1/projects/{projectId}/unpause`

Reference: https://vercel.com/kb/guide/pause-your-project

## Notes

- Pausing a project will make it inaccessible until resumed
- Pausing can help manage costs for projects that aren't in active use
- The Vercel token requires appropriate permissions to manage projects

## Environment Requirements

- Node.js 18+
- Valid Vercel API token with project management permissions
