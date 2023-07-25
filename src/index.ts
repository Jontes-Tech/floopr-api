import express from "express";
import helmet from "helmet";
import { config } from "dotenv";
import morgan from "morgan";
import Multer from "multer";
import cors from 'cors'

config();
import sgMail from "@sendgrid/mail";

import { listLoops } from "./routes/listLoops";
import { listInstruments } from "./routes/listInstruments";
import { downloadFile } from "./routes/downloadFile";
import { contribute } from "./routes/contribute";
import { confirmEmail } from "./routes/confirmEmail";
import { listSubmissions } from "./routes/listSubmissions";
import { denySubmission } from "./routes/denySubmission";
import { approveSubmission } from "./routes/approveSubmission";
import { z } from "zod";
import { contactCollection } from "./database";
import ratelimit from "express-rate-limit";
import { minioClient } from "./minio";
import { ObjectId } from "mongodb";

sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

// Keeping this here for now, but it should be moved to a separate file
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

// file deepcode ignore UseCsurfForExpress: We don't need CSRF protection because the API is stateless
const app = express();

app.use(cors())

// Ratelimit all routes to 100 requests per 15 minutes, unless otherwise specified
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

const standardRateLimit = ratelimit({
  windowMs: 15 * 60 * 1000,
  max: 64,
});

app.use(express.json({ limit: "4mb" }));

app.get("/v1/loops", standardRateLimit, listLoops);

app.get("/v1/instruments", standardRateLimit, listInstruments);

app.get("/v1/loops/:filename", standardRateLimit, downloadFile);

// Limit write routes to 5 requests per 15 minutes
app.post(
  "/v1/upload",
  ratelimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
  }),
  Multer({
    storage: Multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
  }).single("audio"),
  contribute
);

const contactFormSchema = z
  .object({
    email: z.string().email().max(64),
    subject: z.string().max(64),
    message: z.string().max(1024),
    captcha: z.string().max(1024),
    ip: z.string().max(64),
  })
  .strict();

app.post(
  "/v1/contact",
  ratelimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
  }),
  async (req, res) => {
    // Put message, name and email into one variable
    const message = {
      email: req.body.email || "",
      subject: req.body.subject || "",
      message: req.body.message || "",
      captcha: req.body["cf-turnstile-response"] || "",
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    };

    // Use Zod to validate the message
    const validMessage = await contactFormSchema.safeParseAsync(message);

    if (!validMessage.success) {
      return res.status(400).send("Invalid message");
    }
    let turnstileBody = new FormData();
    turnstileBody.append("response", validMessage.data.captcha);
    turnstileBody.append("secret", process.env.TURNSTILE_SECRET || "");
    turnstileBody.append("remoteip", validMessage.data.ip?.toString() || "");
    let turnstileResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: turnstileBody,
      }
    );
    const turnstileJSON = await turnstileResponse.json();

    if (
      process.env.NODE_ENV === "production" &&
      (!turnstileJSON.success || turnstileJSON.score < 0.5)
    ) {
      res.status(400).send({ success: false, message: "Captcha failed" });
      return;
    }
    // Now we finally know that the message is valid, so we can send it, by adding it to mongoDB
    await contactCollection.insertOne({
      email: validMessage.data.email,
      subject: validMessage.data.subject,
      message: validMessage.data.message,
      ip: validMessage.data.ip,
    });

    // Send an email to Jonte, he may forward it to the rest of the team
    await sgMail.send({
      to: "jonatan@jontes.page",
      from: "hi@floopr.org",
      subject: `New message from ${validMessage.data.email}`,
      text: `Subject: ${validMessage.data.subject}\n\nMessage: ${validMessage.data.message}`,
    });

    res.send({ success: true, message: "Message sent" });
  }
);

app.get("/v1/confirm", standardRateLimit, confirmEmail);

app.get("/v1/submissions", standardRateLimit, listSubmissions);

app.delete("/v1/:submissionID", standardRateLimit, denySubmission);

app.get(
  "/v1/submissions/:submissionID",
  standardRateLimit,
  async (req, res) => {
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
    minioClient
      .getObject("submissions", req.params.submissionID)
      .then(function (fileStream: any) {
        res.setHeader(
          "Content-Type",
          req.params.submissionID.split(".").pop() == "mp3"
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
  }
);
app.post("/v1/approve", standardRateLimit, approveSubmission);

app.options("*", standardRateLimit, (req, res) => {
  // deepcode ignore TooPermissiveCorsHeader: <please specify a reason of ignoring this>
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
});

app.get("/v1/health", standardRateLimit, (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // deepcode ignore TooPermissiveCorsHeader: We don't need CORS protection because the API is stateless
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send({ success: true, message: "Healthy" });
});

app.get("/v1/contacts", standardRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";

  if (!auth || auth !== process.env.SUPERSECRETADMIN) {
    res.status(401).send({ success: false, message: "Unauthorized" });
    return;
  }

  const contacts = await contactCollection.find().toArray();

  res.send({ success: true, contacts: contacts });
})  

app.delete("/v1/contacts/:contactID", standardRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  if (!auth || auth !== process.env.SUPERSECRETADMIN) {
    res.status(401).send({ success: false, message: "Unauthorized" });
    return;
  }

  const contactID = req.params.contactID || "";

  if (!contactID) {
    res
      .status(400)
      .send({ success: false, message: "No contact ID provided" });
    return;
  }

  contactCollection.deleteOne({ _id: new ObjectId(contactID) });

  res.send({ success: true, message: "Contact deleted" });
});

app.get("/", standardRateLimit, (req, res) => {
  res.redirect("https://floopr.org");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
