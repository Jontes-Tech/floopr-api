import express from "express";
import helmet from "helmet";
const minio = require("minio");
import { config } from "dotenv";
import morgan from "morgan";
import Multer from "multer";
import { z } from "zod";
import slugify from "slugify";
config();
import { client } from "./database";

// FIXME: remove password before pushing to prod

interface LoopResponse {
  limit: number;
  page: number;
  totalLoops: number;
  loops: Array<{
    _id: string;
    title: string;
    authors: string;
    files: string[];
    key: string;
    tempo: string;
    type: string;
    timesig: string;
    name: string;
    instrument: string;
  }>;
}

const validInstruments = [
  "other",
  "bass",
  "drums",
  "fx",
  "guitar",
  "keys",
  "orchestral",
  "vocals",
];

const loopFormSchema = z
  .object({
    title: z.string({ required_error: "Title is required" }).min(1).max(64),
    author: z.string({ required_error: "Author is required" }).min(1).max(64),
    key: z.string({ required_error: "Key is required" }),
    tempo: z.number({
      required_error: "Tempo is required",
      invalid_type_error: "Tempo must be a number",
    }),
    timesig1: z
      .number({
        required_error: "Time signature is required",
        invalid_type_error: "Time signature must be a number",
      })
      .positive()
      .max(64),
    timesig2: z
      .number({
        required_error: "Time signature is required",
        invalid_type_error: "Time signature must be a number",
      })
      .max(64),
    submissionEmail: z
      .string({ required_error: "Email is required" })
      .email({
        message: "Email must be a valid email address",
      })
      .max(64),
    "cf-turnstile-response": z.string({
      required_error: "Captcha is required",
    }),
    instrument: z
      .string({ required_error: "Instrument is required" })
      .refine((instrument) => validInstruments.includes(instrument), {
        message: `Instrument must be one of the following: ${validInstruments.join(
          ", "
        )}`,
      }),
  })
  .strict();

type LoopForm = z.infer<typeof loopFormSchema>;

const minioClient = new minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: parseInt(process.env.MINIO_PORT as string),
  useSSL: process.env.MINIO_USE_SSL == "true" ? true : false,
  accessKey: process.env.MINIO_ACCESS_KEY || "",
  secretKey: process.env.MINIO_SECRET_KEY || "",
});

// file deepcode ignore UseCsurfForExpress: We don't need CSRF protection because the API is stateless
const app = express();

const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(
  morgan(
    ':remote-addr [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]'
  )
);
app.use(express.json({ limit: "4mb" }));

const db = client.db("floopr");
const loopsCollection = db.collection("loops");
app.get("/v1/loops", async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400");
  // deepcode ignore TooPermissiveCorsHeader: Public API, we don't care about CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const pageNumber = parseInt(req.query.pageNumber as string) || 0;
    const limit = parseInt(req.query.limit as string) || 10;
    const result: any = {};
    const instrument = req.query.instrument as string;

    const totalLoops = await loopsCollection.countDocuments();
    const loops = await loopsCollection
      .find({ instrument: instrument })
      .skip(pageNumber * limit)
      .limit(limit)
      .toArray();

    result.limit = limit;
    result.page = pageNumber;
    result.totalLoops = totalLoops;
    result.loops = loops;
    res.json(result);
  } catch (err) {
    res.status(500).send({ success: false, message: "Error retrieving loops" });
  }
});

app.get("/v1/instruments", function (req, res) {
  res.setHeader("Cache-Control", "public, max-age=86400");
  // deepcode ignore TooPermissiveCorsHeader: Public API, we don't care about CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Find all distinct instruments in Mongo, then return them as an array
  loopsCollection
    .distinct("instrument")
    .then(function (instruments: any) {
      res.json(instruments);
    })
    .catch(function (err: any) {
      res
        .status(500)
        .send({ success: false, message: "Error retrieving instruments" });
    });
});

app.get("/v1/loops/:filename", function (req, res) {
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
      res.status(500).send({ success: false, message: err.message });
    });
});

app.post(
  "/v1/upload",
  Multer({ storage: Multer.memoryStorage() }).single("audio"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).send({ success: false, message: "No file uploaded" });
      return;
    }
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    req.body.tempo = parseInt(req.body.tempo);
    req.body.timesig1 = parseInt(req.body.timesig1);
    req.body.timesig2 = parseInt(req.body.timesig2);

    const loopForm = loopFormSchema.safeParse(req.body);
    if (!loopForm.success) {
      res.status(400).send({ success: false, message: loopForm.error });
      return;
    }
    let turnstileBody = new FormData();
    turnstileBody.append("response", loopForm.data["cf-turnstile-response"]);
    turnstileBody.append("secret", process.env.TURNSTILE_SECRET || "");
    turnstileBody.append("remoteip", ip?.toString() || "");
    let turnstileResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: turnstileBody,
      }
    );
    const turnstileJSON = await turnstileResponse.json();
    if (!turnstileJSON.success) {
      res.status(400).send({ success: false, message: "Captcha failed" });
      return;
    }

    let objectID = await db.collection("submissions").insertOne({
      title: loopForm.data.title,
      author: loopForm.data.author,
      files: ["mp3"],
      key: loopForm.data.key,
      tempo: loopForm.data.tempo,
      type: "audio",
      timesig: [loopForm.data.timesig1, loopForm.data.timesig2].join("/"),
      instrument: loopForm.data.instrument,
      name: slugify(loopForm.data.title),
      submissionEmail: loopForm.data.submissionEmail,
      submissionIP: ip,
      date: new Date().getTime(),
    });

    minioClient.putObject(
      "submissions",
      objectID.insertedId.toString() + ".mp3",
      req.file?.buffer,
      function (error: any, etag: any) {
        if (error) {
          res
            .status(500)
            .send({ success: false, message: "Error uploading file" });
          return console.log(error);
        }
        res.send({ success: true, message: "File uploaded successfully" });
      }
    );
  }
);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
