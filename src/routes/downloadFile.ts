import { Request, Response } from "express";
import { minioClient } from "../minio";
import { loopsCollection, MONGOID } from "../database";
export const downloadFile = async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=31536000");
  // deepcode ignore TooPermissiveCorsHeader: Public API, we don't care about CORS
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Check if in database
  console.log(req.params.filename.split(".")[0]);
  const loop = await loopsCollection.findOne({
    _id: new MONGOID(req.params.filename.split(".")[0]),
  });

  if (!loop) {
    res.status(404).send({ success: false, message: "Loop not found" });
    return;
  }

  minioClient
    .getObject(process.env.BUCKET_NAME || "", req.params.filename)
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
      res.status(500).send({ success: false, message: err.message });
    });
};
