# common-scripts

A grab bag of little utilities I use regularly. Each tool lives in its own folder so you can clone the repo and only install the bits you need.

## Projects

### alias-selector
- Quickly search and run any alias defined in your shell config
- Runs as an interactive CLI powered by `inquirer`
- See `alias-selector/README.md` for installation, configuration, and usage tips

### purge-dynamodb-table
- CLI that deletes **every** item in a DynamoDB table in parallel
- Provides progress reporting, retry logic, and guard rails to avoid accidents
- See `purge-dynamodb-table/README.md` for installation, configuration, and safety notes

### empty-multiple-s3-buckets
- CLI to empty multiple S3 buckets across different regions in one run
- Reads bucket configuration from `buckets.json` (gitignored for security)
- Auto-detects versioning; optionally deletes delete markers
- Batch deletion with exponential backoff, progress logging, and dry-run support
- See `empty-multiple-s3-buckets/README.md` for installation and usage

### vercel-project-manager
- Interactive CLI to manage Vercel projects
- Pause, resume, or configure multiple projects from a `projects.json` config file
- See `vercel-project-manager/README.md` for installation and usage

## Getting Started
1. Clone the repo: `git clone <repo> && cd common-scripts`
2. Pick a project folder (for example `alias-selector`) and run `npm install`
3. Follow the project-specific README to configure credentials/env vars and run the script

## Contributing
These scripts are personal tooling, but tidy pull requests and improvement ideas are welcome. Please keep things dependency-light and document any new setup steps.
