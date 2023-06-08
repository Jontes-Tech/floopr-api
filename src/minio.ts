import * as minio from "minio";
export const minioClient = new minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: parseInt(process.env.MINIO_PORT as string),
  useSSL: process.env.MINIO_USE_SSL == "true" ? true : false,
  accessKey: process.env.MINIO_ACCESS_KEY || "",
  secretKey: process.env.MINIO_SECRET_KEY || "",
});
export const CopyConditions = minio.CopyConditions;