import { Request, Response } from "express";
import { minioClient } from "../minio";
export const downloadFile = async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=31536000");
  // deepcode ignore TooPermissiveCorsHeader: Public API, we don't care about CORS
  res.setHeader("Access-Control-Allow-Origin", "*");

  minioClient
    .getObject("loops", req.params.filename)
    .then(function (fileStream: any) {
      res.setHeader(
        "Content-Type",
        req.params.filename.split(".").pop() == "mp3"
          ? "audio/mpeg"
          : "audio/mid"
      );
      fileStream.pipe(res);
    })
    .catch(function (err: any) {
      console.log(err);
      if (err.code == "NoSuchKey") {
        res.status(404).send({ success: false, message: "Loop not found" });
        return;
      }
      res.status(500).send({ success: false, message: err.message });
    });
};
