import express from "express";
import helmet from "helmet";
const minio = require("minio");
import { config } from "dotenv";
import morgan from "morgan";
import Multer from "multer";
import { z } from "zod";
import slugify from "slugify";
config();
import { client, MONGOID } from "./database";
import crypto from "crypto";
import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

// FIXME: remove password before pushing to prod

interface LoopResponse {
  limit: number;
  page: number;
  totalLoops: number;
  loops: Array<{
    _id: string;
    title: string;
    author: string;
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
    const limit = parseInt((req.query.limit as string) || "128");
    if (limit > 128) {
      res.status(400).send({
        success: false,
        message: "Limit must be less than or equal to 64",
      });
      return;
    }
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
      if (err.code == "NoSuchKey") {
        res.status(404).send({ success: false, message: "Loop not found" });
        return;
      }
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
      confirmed: false,
    });

    // Generate URL-safe confirmation token
    const confirmationToken = crypto
      .randomBytes(32)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    await db.collection("confirmationIDs").insertOne({
      token: confirmationToken,
      submissionID: objectID.insertedId,
      date: new Date().getTime(),
      submissionEmail: loopForm.data.submissionEmail,
    });

    // Simple email template
    const emailTemplate = `
      <style>
        body {
          background-color: #171717;
          font-family: sans-serif;
        }
        a {
          color: ##4ade80;
        }
        a:hover {
          text-decoration: underline;
        }
        h1 {
          color: #fff;
        }
        p {
          color: #d1d5db;
        }
        img {
          width: 200px;
        }
      </style>
      <img src="https://floopr.org/img/floopr-static.svg">
      <h1>Thanks for submitting your loop to the Loop Library!</h1>
      <p>If this was you, please click the link below to confirm your submission.</p>
      <a href="https://api.floopr.org/v1/confirm?token=${confirmationToken}">Confirm your submission (link expires in 24 hours)</a>
      <p>If you did not post to Floopr or don't know who we are, you can safely ignore this message.</p>
      <p>Thanks again! - Floopr Team</p>
    `;

    const msg = {
      to: loopForm.data.submissionEmail, // Change to your recipient
      from: "hi@floopr.org", // Change to your verified sender
      subject: "Floopr - New submission under your email",
      html: emailTemplate,
    };
    sgMail
      .send(msg)
      .then(() => {
        console.log(
          "Successfully sent confirmation email to " +
            loopForm.data.submissionEmail
        );
      })
      .catch((error) => {
        console.error(error);
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

app.get("/v1/confirm", async (req, res) => {
  const confirmationToken = req.query.token;
  if (!confirmationToken) {
    res.status(400).send({ success: false, message: "No token provided" });
    return;
  }
  const confirmationID = await db
    .collection("confirmationIDs")
    .findOne({ token: confirmationToken });
  if (!confirmationID) {
    res.status(400).send({ success: false, message: "Invalid token" });
    return;
  }

  // If the token is older than 24 hours, delete it and return an error
  if (confirmationID.date + 86400000 < new Date().getTime()) {
    res.status(400).send({ success: false, message: "Token expired" });
    db.collection("confirmationIDs").deleteOne({ token: confirmationToken });
    return;
  }

  await db
    .collection("submissions")
    .updateOne(
      { _id: confirmationID.submissionID },
      { $set: { confirmed: true } }
    )
    .then(() => {
      db.collection("confirmationIDs").deleteOne({ token: confirmationToken });
    })
    .catch((err) => {
      console.log(err);
      res
        .status(500)
        .send({ success: false, message: "Error confirming submission" });
      return;
    });

  res.send({ success: true, message: "Submission confirmed" });
});

app.get("/v1/submissions", async (req, res) => {
  const submissions = await db
    .collection("submissions")
    .find({ confirmed: true })
    .sort({ date: -1 })
    .toArray();
  res.send(submissions);
});

app.delete("/v1/:submissionID", async (req, res) => {
  const reason = req.query.reason || "";
  const submissionID = req.params.submissionID || "";
  const auth = req.headers.authorization || "";

  if (!auth || auth !== process.env.SUPERSECRETADMIN) {
    res.status(401).send({ success: false, message: "Unauthorized" });
    return;
  }

  if (!submissionID) {
    res
      .status(400)
      .send({ success: false, message: "No submission ID provided" });
    return;
  }

  const submission = await db
    .collection("submissions")
    .findOne({ _id: new MONGOID(submissionID) });
  if (!submission) {
    res.status(400).send({ success: false, message: "Invalid submission ID" });
    return;
  }

  // Let the user know their submission was denied
  const emailTemplate = `
    <style>
      body {
        background-color: #171717;
        font-family: sans-serif;
      }
      h1 {
        color: #fff;
      }
      p {
        color: #d1d5db;
      }
      img {
        width: 200px;
      }
      </style>
      <img src="https://floopr.org/img/floopr-static.svg">
      <h1>We're sorry, your loop was not accepted by Floopr.</h1>
      <p>Here's why:</p>
      <p>"${reason}" - A Floopr Moderator</p>
      <p>If you think this was a mistake, please reply to this email.</p>
      <p>Thanks for posting! - Floopr Team</p>
  `;

  const msg = {
    to: submission.submissionEmail, // Change to your recipient
    from: "hi@floopr.org", // Change to your verified sender
    subject: "Floopr - We're sorry, your loop was not accepted",
    html: emailTemplate,
  };
  sgMail
    .send(msg)
    .then(() => {
      console.log("Successfully bad news to " + submission.submissionEmail);
    })
    .catch((error) => {
      console.error(error);
    });

  submission.files.forEach((file: string) => {
    minioClient.removeObject(
      "submissions",
      submission._id + "." + file,
      function (error: any) {
        if (error) {
          console.log(error);
          res.status(500).send({
            success: false,
            message: "Error deleting file from storage",
          });
          return;
        }
      }
    );
  });

  await db.collection("submissions").deleteOne({ _id: submission._id });

  res.send({ success: true, message: "Submission deleted, sent bad news" });
});

app.post("/v1/approve/:submissionID", async (req, res) => {
  const submissionID = req.params.submissionID || "";
  const auth = req.headers.authorization || "";

  if (!auth || auth !== process.env.SUPERSECRETADMIN) {
    res.status(401).send({ success: false, message: "Unauthorized" });
    return;
  }

  if (!submissionID) {
    res
      .status(400)
      .send({ success: false, message: "No submission ID provided" });
    return;
  }

  const submission = await db
    .collection("submissions")
    .findOne({ _id: new MONGOID(submissionID) });
  if (!submission) {
    res.status(400).send({ success: false, message: "Invalid submission ID" });
    return;
  }

  // Let the user know their submission was approved
  const emailTemplate = `
    <style>
      body {
        background-color: #171717;
        font-family: sans-serif;
      }
      h1 {
        color: #fff;
      }
      p {
        color: #d1d5db;
      }
      img {
        width: 200px;
      }
      </style>
      <img src="https://floopr.org/img/floopr-static.svg">
      <h1>Congratulations! Your loop was accepted by Floopr.</h1>
      <p>You'll be able to see it on the site soon.</p>
      <p>Thanks for posting! - Floopr Team</p>
  `;
  const msg = {
    to: submission.submissionEmail, // Change to your recipient
    from: "hi@floopr.org",
    subject: "Floopr - Your loop was accepted",
    html: emailTemplate,
  };

  sgMail
    .send(msg)
    .then(() => {
      console.log(
        "Successfully sent good news to " + submission.submissionEmail
      );
    })
    .catch((error) => {
      console.error(error);
    });

  // Move the submission to the loops collection
  await db.collection("loops").insertOne({ ...req.body, _id: submission._id });

  await db.collection("submissions").deleteOne({ _id: submission._id });

  submission.files.forEach((file: string) => {
    minioClient.copyObject(
      "loops",
      submission._id + "." + file,
      "/submissions/" + submission._id + "." + file,
      function (e: any) {
        if (e) {
          return console.log(e);
        }
        console.log("Successfully copied the object:");
      }
    );
    minioClient.removeObject(
      "submissions",
      submission._id + "." + file,
      function (error: any) {
        if (error) {
          console.log(error);
          res.status(500).send({
            success: false,
            message: "Error deleting file from storage",
          });
          return;
        }
      }
    );
  });

  res.send({ success: true, message: "Submission approved!" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
