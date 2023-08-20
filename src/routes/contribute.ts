import { Request, Response } from "express";
import { submissionsCollection, confirmationIDsCollection } from "../database";
import { minioClient } from "../minio";
import { loopFormSchema } from "../schemas";
import slugify from "slugify";
import crypto from "crypto";
import sgMail from "@sendgrid/mail";
import { rateLimiter } from "../index";

// file deepcode ignore NoRateLimitingForExpensiveWebOperation: We're rateliming in src/index.ts
export const contribute = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).send({ success: false, message: "No file uploaded" });
    return;
  }
  console.log(req.file.mimetype);
  if (
    req.file.mimetype !== "audio/mpeg" &&
    req.file.mimetype !== "audio/wav" &&
    req.file.mimetype !== "audio/ogg" &&
    req.file.mimetype !== "audio/midi" &&
    req.file.mimetype !== "audio/x-midi" &&
    req.file.mimetype !== "audio/mid"
  ) {
    res.status(400).send({ success: false, message: "Invalid file type" });
    return;
  }
  let midi = false;
  if (
    req.file.mimetype === "audio/midi" ||
    req.file.mimetype === "audio/x-midi" ||
    req.file.mimetype === "audio/mid"
  ) {
    midi = true;
  }
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  req.body.tempo = parseInt(req.body.tempo);
  req.body.timesig1 = parseInt(req.body.timesig1);
  req.body.timesig2 = parseInt(req.body.timesig2);

  const loopForm = loopFormSchema.safeParse(req.body);
  if (!loopForm.success) {
    res.status(400).send({ success: false, message: loopForm.error });
    rateLimiter.penalty(4);
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

  if (
    process.env.NODE_ENV === "production" &&
    (!turnstileJSON.success || turnstileJSON.score < 0.5)
  ) {
    res.status(400).send({ success: false, message: "Captcha failed" });
    rateLimiter.penalty(4);
    return;
  }

  let objectID = await submissionsCollection.insertOne({
    title: loopForm.data.title,
    author: loopForm.data.author,
    files: midi ? ["mp3", "mid"] : ["mp3"],
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

  await confirmationIDsCollection.insertOne({
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
  if (process.env.NODE_ENV === "production") {
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
  } else {
    console.log("To confirm, use token: " + confirmationToken);
  }

  // Your existing code for fetching and processing the audio
  const audioProcessedResponse = await fetch(process.env.PROCESSINGURL || "", {
    method: "POST",
    body: req.file?.buffer,
    headers: {
      "Content-Type": "audio/midi",
    },
  });
  const audioProcessedBuffer = await audioProcessedResponse.arrayBuffer();

  // Uploading the processed audio to Minio
  minioClient.putObject(
    process.env.BUCKET_NAME || "",
    objectID.insertedId.toString() + ".mp3",
    Buffer.from(audioProcessedBuffer), // Convert ArrayBuffer to Buffer
    function (error: any) {
      if (error) {
        res
          .status(500)
          .send({ success: false, message: "Error uploading MIDI file" });
        return console.log(error);
      }
      if (midi) {
        minioClient.putObject(
          process.env.BUCKET_NAME || "",
          objectID.insertedId.toString() + ".mid",
          Buffer.from(audioProcessedBuffer), // Use the same buffer since it's the audio wave file
          function (audioUploadError: any) {
            if (audioUploadError) {
              res.status(500).send({
                success: false,
                message: "Error uploading audio wave file",
              });
              return console.log(audioUploadError);
            }

            // Both MIDI and audio wave files are uploaded successfully
            res
              .status(200)
              .send({ success: true, message: "Files uploaded successfully" });
          }
        );
      } else {
        res
          .status(200)
          .send({ success: true, message: "Files uploaded successfully" });
      }
    }
  );
};
