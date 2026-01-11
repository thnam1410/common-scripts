# purge-dynamodb-table

Utility CLI for emptying a DynamoDB table as fast (and safely) as possible.

## Installation
```bash
cd purge-dynamodb-table
npm install
```

## Usage
```bash
npm start
```

The CLI will prompt you for:
- AWS profile (must exist in your AWS config/credentials files)
- AWS region
- Table name
- Number of parallel scan segments (1-10)
- Confirmation prompt that requires you to type the table name to proceed

## Safety Features
- Double confirmation: you must type the table name to continue.
- Dry run option to review key schema and estimated item count without deleting anything.
- Progress logger reports scan/delete counts and throughput every 2 seconds.
- Retries with exponential backoff for throttled `BatchWriteItem` calls.

## Environment Requirements
- Node.js 18+
- AWS credentials configured locally (shared config or env vars)
- Network access to your DynamoDB endpoint

## Notes
- If your table uses on-demand capacity, throttling may happen during purge. The script automatically retries a few times before failing.
- For very large tables you might prefer deleting and recreating the table; this script is aimed at non-production or dev data sets.
