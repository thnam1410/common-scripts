# Empty Multiple S3 Buckets

A CLI tool to empty multiple S3 buckets across different AWS regions in one run.

## Configuration

Create a `buckets.json` file in this directory (it is gitignored):

```json
[
  { "name": "my-bucket-us", "region": "us-east-1" },
  { "name": "my-bucket-ap", "region": "ap-southeast-2" }
]
```

| Field    | Description                         |
| -------- | ----------------------------------- |
| `name`   | The S3 bucket name                  |
| `region` | AWS region where the bucket resides |

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

The script will:

1. Prompt for an **AWS profile** (cached between runs)
2. Prompt for **dry run** mode (list only, no deletes)
3. Display all buckets to be processed and ask for confirmation
4. Process each bucket **sequentially**:
   - Detect whether versioning is enabled
   - If versioned: prompt whether to also delete **delete markers**
   - List all objects/versions and delete them in batches of 1000
   - Show live progress during deletion
5. Print a final summary table

## Features

- **Multi-region support** — each bucket uses its own S3 client scoped to the correct region
- **Versioning awareness** — auto-detects versioned buckets; prompts before touching delete markers
- **Dry run mode** — lists what would be deleted without making any changes
- **Exponential backoff** — retries throttled/failed deletions automatically
- **Last-choices cache** — pre-fills prompts with your previous answers (`.last-choices.json`)
- **`buckets.json` is gitignored** — avoids leaking real bucket names into source control

## Notes

- The AWS profile must be configured in `~/.aws/credentials` or `~/.aws/config`
- Emptying a bucket does **not** delete the bucket itself
- For versioned buckets, deleting all versions and delete markers is required before S3 allows the bucket to be deleted
