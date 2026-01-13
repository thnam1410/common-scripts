import {
  DynamoDBClient,
  ScanCommand,
  BatchWriteItemCommand,
  DescribeTableCommand,
  WriteRequest,
} from "@aws-sdk/client-dynamodb";
import prompts from "prompts";
import fs from "fs";
import path from "path";

// Configuration constants
const CACHE_FILE = path.join(__dirname, ".last-choices.json");

type CachedChoices = {
  awsProfile?: string;
  region?: string;
  tableName?: string;
  parallelSegments?: number;
  dryRun?: boolean;
};

function loadLastChoices(): CachedChoices {
  try {
    const data = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveLastChoices(choices: CachedChoices) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(choices, null, 2), "utf-8");
}
const SCAN_LIMIT = 100;
const MAX_RETRIES = 5;
const BATCH_SIZE = 25; // DynamoDB BatchWriteItem limit
const BACKOFF_BASE_MS = 100;
const PROGRESS_INTERVAL_MS = 2000;

interface TableKey {
  attributeName: string;
  keyType: "HASH" | "RANGE";
}

interface PurgeStats {
  scanned: number;
  deleted: number;
  startTime: number;
}

interface PurgeOptions {
  tableName: string;
  parallelSegments: number;
  dryRun: boolean;
}

async function getTableKeys(
  client: DynamoDBClient,
  tableName: string
): Promise<TableKey[]> {
  const command = new DescribeTableCommand({ TableName: tableName });
  const response = await client.send(command);

  if (!response.Table?.KeySchema) {
    throw new Error("Unable to retrieve table key schema");
  }

  return response.Table.KeySchema.map((key) => ({
    attributeName: key.AttributeName!,
    keyType: key.KeyType as "HASH" | "RANGE",
  }));
}

async function scanSegment(
  client: DynamoDBClient,
  tableName: string,
  segment: number,
  totalSegments: number,
  keys: TableKey[],
  stats: PurgeStats
): Promise<void> {
  let lastEvaluatedKey: Record<string, any> | undefined;
  const keyAttributes = keys.map((k) => k.attributeName);

  do {
    const scanCommand = new ScanCommand({
      TableName: tableName,
      Segment: segment,
      TotalSegments: totalSegments,
      ProjectionExpression: keyAttributes.join(", "),
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: SCAN_LIMIT,
    });

    const scanResponse = await client.send(scanCommand);
    stats.scanned += scanResponse.Items?.length || 0;

    if (scanResponse.Items && scanResponse.Items.length > 0) {
      // Delete in batches of 25 (DynamoDB limit)
      for (let i = 0; i < scanResponse.Items.length; i += BATCH_SIZE) {
        const batch = scanResponse.Items.slice(i, i + BATCH_SIZE);

        const deleteRequests = batch.map((item) => ({
          DeleteRequest: {
            Key: Object.fromEntries(
              keyAttributes.map((attr) => [attr, item[attr]])
            ),
          },
        }));

        let retries = 0;
        let unprocessedItems: Record<string, WriteRequest[]> = {
          [tableName]: deleteRequests,
        };

        while (
          Object.keys(unprocessedItems).length > 0 &&
          retries < MAX_RETRIES
        ) {
          try {
            const batchCommand = new BatchWriteItemCommand({
              RequestItems: unprocessedItems,
            });

            const batchResponse = await client.send(batchCommand);
            stats.deleted +=
              deleteRequests.length -
              (batchResponse.UnprocessedItems?.[tableName]?.length || 0);

            if (
              batchResponse.UnprocessedItems &&
              Object.keys(batchResponse.UnprocessedItems).length > 0
            ) {
              unprocessedItems = batchResponse.UnprocessedItems;
              retries++;
              // Exponential backoff
              await new Promise((resolve) =>
                setTimeout(resolve, Math.pow(2, retries) * BACKOFF_BASE_MS)
              );
            } else {
              unprocessedItems = {};
            }
          } catch (error: any) {
            if (error.name === "ProvisionedThroughputExceededException") {
              retries++;
              await new Promise((resolve) =>
                setTimeout(resolve, Math.pow(2, retries) * BACKOFF_BASE_MS)
              );
            } else {
              throw error;
            }
          }
        }
      }
    }

    lastEvaluatedKey = scanResponse.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}

async function purgeTable(
  client: DynamoDBClient,
  options: PurgeOptions
): Promise<void> {
  const { tableName, parallelSegments, dryRun } = options;
  console.log(`\n🔍 Analyzing table structure...`);
  const keys = await getTableKeys(client, tableName);
  console.log(
    `📋 Primary keys: ${keys
      .map((k) => `${k.attributeName} (${k.keyType})`)
      .join(", ")}`
  );

  if (dryRun) {
    console.log(
      "\n📝 Dry run enabled — no data will be deleted. Use this output to confirm settings."
    );
    return;
  }

  const stats: PurgeStats = {
    scanned: 0,
    deleted: 0,
    startTime: Date.now(),
  };

  console.log(
    `\n🚀 Starting purge with ${parallelSegments} parallel segments...\n`
  );

  // Progress reporting interval
  const progressInterval = setInterval(() => {
    if (stats.scanned === 0) {
      // Don't log progress until we've actually scanned something
      return;
    }
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    const elapsedMs = Date.now() - stats.startTime;
    const rate = elapsedMs > 0 ? (stats.deleted / elapsedMs) * 1000 : 0;
    console.log(
      `📊 Scanned: ${stats.scanned} | Deleted: ${
        stats.deleted
      } | Rate: ${rate.toFixed(0)} items/sec | Time: ${elapsed}s`
    );
  }, PROGRESS_INTERVAL_MS);

  try {
    // Run parallel scans
    const promises = [];
    for (let segment = 0; segment < parallelSegments; segment++) {
      promises.push(
        scanSegment(client, tableName, segment, parallelSegments, keys, stats)
      );
    }

    await Promise.all(promises);
  } finally {
    clearInterval(progressInterval);
  }

  const totalTime = ((Date.now() - stats.startTime) / 1000).toFixed(2);
  const avgRate = (
    (stats.deleted / (Date.now() - stats.startTime)) *
    1000
  ).toFixed(0);

  console.log(`\n✅ Purge completed!`);
  console.log(`   Total items deleted: ${stats.deleted}`);
  console.log(`   Total time: ${totalTime}s`);
  console.log(`   Average rate: ${avgRate} items/sec\n`);
}

async function main() {
  console.log("🗑️  DynamoDB Table Purge Tool\n");

  const lastChoices = loadLastChoices();

  const responses = await prompts(
    [
      {
        type: "text",
        name: "awsProfile",
        message: "Enter AWS Profile:",
        initial: lastChoices.awsProfile || "default",
        validate: (value: string) =>
          value.length > 0 ? true : "AWS Profile is required",
      },
      {
        type: "text",
        name: "region",
        message: "Enter AWS Region:",
        initial: lastChoices.region || "ap-southeast-2",
        validate: (value: string) =>
          value.length > 0 ? true : "AWS Region is required",
      },
      {
        type: "text",
        name: "tableName",
        message: "Enter DynamoDB Table Name:",
        initial: lastChoices.tableName,
        validate: (value: string) =>
          value.length > 0 ? true : "Table name is required",
      },
      {
        type: "number",
        name: "parallelSegments",
        message: "Number of parallel segments (1-10):",
        initial:
          typeof lastChoices.parallelSegments === "number"
            ? lastChoices.parallelSegments
            : parseInt(process.env.PARALLEL_SEGMENTS || "5"),
        min: 1,
        max: 10,
      },
      {
        type: "toggle",
        name: "dryRun",
        message: "Dry run (inspect only, no deletes)?",
        initial:
          typeof lastChoices.dryRun === "boolean" ? lastChoices.dryRun : false,
        active: "yes",
        inactive: "no",
      },
      {
        name: "confirm",
        message: (prev: any, values: any) =>
          `⚠️  Are you sure you want to purge ALL data from table "${values.tableName}" using profile "${values.awsProfile}"?`,
        initial: false,
        type: (prev, values): any => (values.dryRun ? null : "confirm"),
      },
    ],
    {
      onCancel: () => {
        console.log("\n❌ Operation cancelled.");
        process.exit(0);
      },
    }
  );

  if (!responses.dryRun && !responses.confirm) {
    console.log("\n❌ Purge cancelled. No data was deleted.");
    return;
  }

  try {
    // Initialize DynamoDB client with selected profile
    const client = new DynamoDBClient({
      profile: responses.awsProfile,
      region: responses.region,
    });

    await purgeTable(client, {
      tableName: responses.tableName,
      parallelSegments: responses.parallelSegments,
      dryRun: responses.dryRun,
    });

    // Save all choices for next run
    saveLastChoices({
      awsProfile: responses.awsProfile,
      region: responses.region,
      tableName: responses.tableName,
      parallelSegments: responses.parallelSegments,
      dryRun: responses.dryRun,
    });
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.name === "ResourceNotFoundException") {
      console.error(
        "   Table not found. Please check the table name and try again."
      );
    }
    process.exit(1);
  }
}

main();
