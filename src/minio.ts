import * as minio from "minio";
export const minioClient = new minio.Client({
  endPoint: process.env.BUCKET_HOST || "localhost",
  port: parseInt(process.env.BUCKET_PORT as string),
  useSSL: process.env.BUCKET_USESSL == "true" ? true : false,
  accessKey: process.env.AWS_ACCESS_KEY_ID || "",
  secretKey: process.env.AWS_SECRET_ACCESS_KEY || "",
});
export const CopyConditions = minio.CopyConditions;