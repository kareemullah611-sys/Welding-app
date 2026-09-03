import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type BucketConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function readBucketConfig(): BucketConfig {
  const endpoint = process.env.RAILWAY_BUCKET_ENDPOINT || process.env.BUCKET_ENDPOINT || process.env.AWS_ENDPOINT_URL || process.env.S3_ENDPOINT || "";
  const bucket = process.env.RAILWAY_BUCKET_NAME || process.env.BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET || "";
  const accessKeyId = process.env.RAILWAY_BUCKET_ACCESS_KEY_ID || process.env.BUCKET_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY || process.env.BUCKET_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "";
  const region = process.env.RAILWAY_BUCKET_REGION || process.env.BUCKET_REGION || process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "auto";
  const urlStyle = String(process.env.AWS_S3_URL_STYLE || process.env.RAILWAY_BUCKET_URL_STYLE || "").toLowerCase();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Railway bucket storage is not configured");
  }

  return {
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: urlStyle === "path" || urlStyle === "path-style",
  };
}

function createBucketClient(config: BucketConfig) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function safeDownloadName(filename: string) {
  return filename.replace(/[\r\n"]/g, "").trim() || "lot-document";
}

export function createLotDocumentStorageKey(lotId: number, originalFileName: string) {
  const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  return `lots/${lotId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${cleanName}`;
}

export function createSarafiCaptureStorageKey(snapshotDate: string, fileName: string) {
  const cleanDate = snapshotDate.replace(/[^0-9-]/g, "");
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  return `fx/sarafi-af/${cleanDate}/${Date.now()}-${Math.random().toString(36).slice(2)}-${cleanName}`;
}

export function createFxEvidenceStorageKey(provider: string, snapshotDate: string, fileName: string) {
  const cleanProvider = provider.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  const cleanDate = snapshotDate.replace(/[^0-9-]/g, "");
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  return `fx/${cleanProvider}/${cleanDate}/${Date.now()}-${Math.random().toString(36).slice(2)}-${cleanName}`;
}

export async function uploadLotDocumentToBucket(params: {
  key: string;
  buffer: Buffer;
  contentType: string;
  originalFileName: string;
}) {
  const config = readBucketConfig();
  const client = createBucketClient(config);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    Body: params.buffer,
    ContentType: params.contentType,
    Metadata: {
      originalFileName: params.originalFileName.slice(0, 500),
    },
  }));
  return {
    storageKey: params.key,
    internalUrl: `railway-bucket://${config.bucket}/${params.key}`,
  };
}

export async function getLotDocumentDownloadUrl(params: {
  key: string;
  originalFileName: string;
  contentType?: string | null;
}) {
  const config = readBucketConfig();
  const client = createBucketClient(config);
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    ResponseContentType: params.contentType || undefined,
    ResponseContentDisposition: `inline; filename="${safeDownloadName(params.originalFileName)}"`,
  }), { expiresIn: 5 * 60 });
}

export async function uploadSarafiCaptureEvidence(params: {
  key: string;
  buffer: Buffer;
  contentType: string;
  fileName: string;
}) {
  const config = readBucketConfig();
  const client = createBucketClient(config);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    Body: params.buffer,
    ContentType: params.contentType,
    Metadata: {
      originalFileName: params.fileName.slice(0, 500),
      evidenceType: "sarafi-af-assisted-capture",
    },
  }));
  return { storageKey: params.key };
}

export async function getSarafiCaptureEvidenceUrl(params: {
  key: string;
  fileName: string;
  contentType: string;
}) {
  const config = readBucketConfig();
  const client = createBucketClient(config);
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    ResponseContentType: params.contentType,
    ResponseContentDisposition: `inline; filename="${safeDownloadName(params.fileName)}"`,
  }), { expiresIn: 5 * 60 });
}

export async function uploadFxCaptureEvidence(params: {
  key: string;
  buffer: Buffer;
  contentType: string;
  fileName: string;
  provider: string;
}) {
  const config = readBucketConfig();
  const client = createBucketClient(config);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    Body: params.buffer,
    ContentType: params.contentType,
    Metadata: {
      originalFileName: params.fileName.slice(0, 500),
      evidenceType: `${params.provider.toLowerCase()}-daily-fx-capture`,
    },
  }));
  return { storageKey: params.key };
}

export async function deleteBucketObject(key: string) {
  const config = readBucketConfig();
  const client = createBucketClient(config);
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
