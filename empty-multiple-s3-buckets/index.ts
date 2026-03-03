import {
  S3Client,
  GetBucketVersioningCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  ObjectIdentifier,
} from "@aws-sdk/client-s3";
import prompts from "prompts";
import fs from "fs";
import path from "path";

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_FILE = path.join(__dirname, ".last-choices.json");
const BUCKETS_FILE = path.join(__dirname, "buckets.json");
const DELETE_BATCH_SIZE = 1000; // S3 DeleteObjects limit
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 100;
const PROGRESS_INTERVAL_MS = 2000;

// ─── Types ────────────────────────────────────────────────────────────────────

type BucketConfig = {
  name: string;
  region: string;
};

type CachedChoices = {
  awsProfile?: string;
  dryRun?: boolean;
};

type EmptyStats = {
  deleted: number;
  startTime: number;
};

// ─── Cache helpers ────────────────────────────────────────────────────────────

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

// ─── Bucket config ────────────────────────────────────────────────────────────

function loadBuckets(): BucketConfig[] {
  if (!fs.existsSync(BUCKETS_FILE)) {
    console.error("❌ buckets.json not found.");
    console.error(
      "   Create a buckets.json file in this directory with the following format:"
    );
    console.error(
      '   [{ "name": "my-bucket", "region": "us-east-1" }, ...]'
    );
    process.exit(1);
  }

  let buckets: BucketConfig[];
  try {
    const data = fs.readFileSync(BUCKETS_FILE, "utf-8");
    buckets = JSON.parse(data);
  } catch {
    console.error("❌ Failed to parse buckets.json. Ensure it is valid JSON.");
    process.exit(1);
  }

  if (!Array.isArray(buckets) || buckets.length === 0) {
    console.log("ℹ️  No buckets configured in buckets.json. Nothing to do.");
    process.exit(0);
  }

  const invalid = buckets.filter((b) => !b.name || !b.region);
  if (invalid.length > 0) {
    console.error(
      '❌ Some bucket entries are missing "name" or "region" fields:'
    );
    invalid.forEach((b) => console.error(`   ${JSON.stringify(b)}`));
    process.exit(1);
  }

  return buckets;
}

// ─── Versioning ───────────────────────────────────────────────────────────────

async function isVersioningEnabled(
  client: S3Client,
  bucket: string
): Promise<boolean> {
  const response = await client.send(
    new GetBucketVersioningCommand({ Bucket: bucket })
  );
  const status = response.Status;
  return status === "Enabled" || status === "Suspended";
}

// ─── Listing helpers ──────────────────────────────────────────────────────────

async function listAllObjects(
  client: S3Client,
  bucket: string
): Promise<ObjectIdentifier[]> {
  const objects: ObjectIdentifier[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents ?? []) {
      if (obj.Key) objects.push({ Key: obj.Key });
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

async function listAllVersionsAndMarkers(
  client: S3Client,
  bucket: string,
  includeDeleteMarkers: boolean
): Promise<ObjectIdentifier[]> {
  const objects: ObjectIdentifier[] = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  do {
    const response = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );

    for (const v of response.Versions ?? []) {
      if (v.Key && v.VersionId) objects.push({ Key: v.Key, VersionId: v.VersionId });
    }

    if (includeDeleteMarkers) {
      for (const m of response.DeleteMarkers ?? []) {
        if (m.Key && m.VersionId)
          objects.push({ Key: m.Key, VersionId: m.VersionId });
      }
    }

    keyMarker = response.NextKeyMarker;
    versionIdMarker = response.NextVersionIdMarker;
  } while (keyMarker);

  return objects;
}

// ─── Batch delete ─────────────────────────────────────────────────────────────

async function deleteObjects(
  client: S3Client,
  bucket: string,
  allObjects: ObjectIdentifier[],
  stats: EmptyStats
): Promise<void> {
  for (let i = 0; i < allObjects.length; i += DELETE_BATCH_SIZE) {
    const batch = allObjects.slice(i, i + DELETE_BATCH_SIZE);
    let retries = 0;
    let pending = batch;

    while (pending.length > 0 && retries < MAX_RETRIES) {
      try {
        const response = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: pending, Quiet: true },
          })
        );

        const errors = response.Errors ?? [];
        if (errors.length > 0) {
          // Retry only the objects that errored
          pending = errors
            .filter((e) => e.Key)
            .map((e) => ({ Key: e.Key!, VersionId: e.VersionId ?? undefined }));
          retries++;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, retries) * BACKOFF_BASE_MS)
          );
        } else {
          stats.deleted += batch.length - errors.length;
          pending = [];
        }
      } catch (error: any) {
        if (
          error.name === "SlowDown" ||
          error.name === "ServiceUnavailable" ||
          error.name === "RequestThrottled"
        ) {
          retries++;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, retries) * BACKOFF_BASE_MS)
          );
        } else {
          throw error;
        }
      }
    }

    if (pending.length > 0) {
      console.warn(
        `⚠️  ${pending.length} object(s) could not be deleted after ${MAX_RETRIES} retries.`
      );
    }
  }
}

// ─── Per-bucket logic ─────────────────────────────────────────────────────────

async function emptyBucket(
  bucket: BucketConfig,
  awsProfile: string,
  dryRun: boolean
): Promise<number> {
  const client = new S3Client({
    profile: awsProfile,
    region: bucket.region,
  });

  // Check versioning
  console.log(`\n🔍 Checking versioning status for "${bucket.name}"...`);
  const versioned = await isVersioningEnabled(client, bucket.name);

  let deleteMarkers = false;

  if (versioned) {
    console.log(`   🗂️  Bucket is versioned.`);
    const answer = await prompts(
      {
        type: "toggle",
        name: "deleteMarkers",
        message: `Also delete delete markers in "${bucket.name}"?`,
        initial: true,
        active: "yes",
        inactive: "no",
      },
      {
        onCancel: () => {
          console.log("\n❌ Operation cancelled.");
          process.exit(0);
        },
      }
    );
    deleteMarkers = answer.deleteMarkers;
  }

  // Collect objects to delete
  console.log(`📋 Listing objects in "${bucket.name}"...`);
  const objects = versioned
    ? await listAllVersionsAndMarkers(client, bucket.name, deleteMarkers)
    : await listAllObjects(client, bucket.name);

  if (objects.length === 0) {
    console.log(`   ✅ Bucket "${bucket.name}" is already empty.`);
    return 0;
  }

  console.log(`   Found ${objects.length} object(s) to delete.`);

  if (dryRun) {
    console.log(
      `   📝 Dry run — skipping deletion of ${objects.length} object(s).`
    );
    return 0;
  }

  const stats: EmptyStats = {
    deleted: 0,
    startTime: Date.now(),
  };

  console.log(`🚀 Deleting ${objects.length} object(s) from "${bucket.name}"...`);

  const progressInterval = setInterval(() => {
    if (stats.deleted === 0) return;
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    const rate =
      stats.deleted > 0
        ? ((stats.deleted / (Date.now() - stats.startTime)) * 1000).toFixed(0)
        : "0";
    console.log(
      `📊 Deleted: ${stats.deleted}/${objects.length} | Rate: ${rate} objects/sec | Time: ${elapsed}s`
    );
  }, PROGRESS_INTERVAL_MS);

  try {
    await deleteObjects(client, bucket.name, objects, stats);
  } finally {
    clearInterval(progressInterval);
  }

  const totalTime = ((Date.now() - stats.startTime) / 1000).toFixed(2);
  console.log(
    `✅ "${bucket.name}" emptied — ${stats.deleted} object(s) deleted in ${totalTime}s`
  );

  return stats.deleted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🪣  Empty Multiple S3 Buckets\n");

  const buckets = loadBuckets();
  const lastChoices = loadLastChoices();

  // Prompt for global settings
  const responses = await prompts(
    [
      {
        type: "text",
        name: "awsProfile",
        message: "Enter AWS Profile:",
        initial: lastChoices.awsProfile ?? "default",
        validate: (value: string) =>
          value.length > 0 ? true : "AWS Profile is required",
      },
      {
        type: "toggle",
        name: "dryRun",
        message: "Dry run (list only, no deletes)?",
        initial: lastChoices.dryRun ?? false,
        active: "yes",
        inactive: "no",
      },
    ],
    {
      onCancel: () => {
        console.log("\n❌ Operation cancelled.");
        process.exit(0);
      },
    }
  );

  // Show bucket list and confirm
  console.log("\n📋 Buckets to process:");
  buckets.forEach((b, i) =>
    console.log(`   ${i + 1}. ${b.name}  (${b.region})`)
  );
  console.log();

  if (!responses.dryRun) {
    const { confirm } = await prompts(
      {
        type: "confirm",
        name: "confirm",
        message: `⚠️  This will permanently delete ALL objects in the ${buckets.length} bucket(s) above using profile "${responses.awsProfile}". Continue?`,
        initial: false,
      },
      {
        onCancel: () => {
          console.log("\n❌ Operation cancelled.");
          process.exit(0);
        },
      }
    );

    if (!confirm) {
      console.log("\n❌ Aborted. No data was deleted.");
      return;
    }
  }

  saveLastChoices({
    awsProfile: responses.awsProfile,
    dryRun: responses.dryRun,
  });

  // Process each bucket sequentially
  const overallStart = Date.now();
  let totalDeleted = 0;
  const results: { name: string; deleted: number; error?: string }[] = [];

  for (const bucket of buckets) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`🪣  Processing bucket: ${bucket.name}  [${bucket.region}]`);
    try {
      const deleted = await emptyBucket(bucket, responses.awsProfile, responses.dryRun);
      totalDeleted += deleted;
      results.push({ name: bucket.name, deleted });
    } catch (error: any) {
      console.error(`❌ Failed to empty "${bucket.name}": ${error.message}`);
      if (error.name === "NoSuchBucket") {
        console.error("   Bucket does not exist or you do not have access.");
      }
      results.push({ name: bucket.name, deleted: 0, error: error.message });
    }
  }

  // Final summary
  const totalTime = ((Date.now() - overallStart) / 1000).toFixed(2);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 Summary`);
  console.log(`${"─".repeat(60)}`);
  results.forEach((r) => {
    if (r.error) {
      console.log(`   ❌ ${r.name}: FAILED — ${r.error}`);
    } else {
      console.log(
        `   ✅ ${r.name}: ${r.deleted} object(s) ${responses.dryRun ? "(dry run)" : "deleted"}`
      );
    }
  });
  console.log(`${"─".repeat(60)}`);
  console.log(`   Total objects deleted : ${totalDeleted}`);
  console.log(`   Total time            : ${totalTime}s`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((error) => {
  console.error("\n❌ Unexpected error:", error.message);
  process.exit(1);
});
