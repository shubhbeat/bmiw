const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const s3Client = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION || 'us-east-005',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY
  }
});

const BUCKET = process.env.B2_BUCKET_NAME || 'webinar-videos';

const uploadVideo = async (fileBuffer, originalFilename, mimeType) => {
  const ext = path.extname(originalFilename);
  const key = `videos/${uuidv4()}${ext}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: fileBuffer,
    ContentType: mimeType || 'video/mp4',
    Metadata: { originalName: originalFilename }
  }));
  console.log(`✅ Video uploaded: ${key}`);
  return { key, originalName: originalFilename };
};

const getVideoUrl = async (key, expiresInSeconds = 3600) => {
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresInSeconds });
};

const deleteVideo = async (key) => {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
};

module.exports = { uploadVideo, getVideoUrl, deleteVideo };
