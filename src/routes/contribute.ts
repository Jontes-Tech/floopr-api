import { Request, Response } from "express";
import { submissionsCollection, confirmationIDsCollection } from "../database";
import { minioClient } from "../minio";
import { loopFormSchema } from "../schemas";
import slugify from "slugify";
import crypto from "crypto";
import sgMail from "@sendgrid/mail";
import { spawn } from "child_process";

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
  if (req.file.mimetype === "audio/midi" || req.file.mimetype === "audio/x-midi" || req.file.mimetype === "audio/mid") {
    midi = true;
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

  if (
    process.env.NODE_ENV === "production" &&
    (!turnstileJSON.success || turnstileJSON.score < 0.5)
  ) {
    res.status(400).send({ success: false, message: "Captcha failed" });
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

  const objectName = objectID.insertedId.toString() + ".mp3";

  if (req.file.mimetype === "audio/midi" || req.file.mimetype === "audio/x-midi") {
    // If the file is a MIDI file, convert it to a WAV file using timidity
    const timidity = spawn("timidity", ["-Ow", "-o", "-", "-"]);

    timidity.stdin.write(req.file?.buffer);
    timidity.stdin.end();

    // Use ffmpeg to convert the WAV file to an MP3 file
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      "-",
      "-codec:a",
      "libmp3lame",
      "-qscale:a",
      "4",
      "-map_metadata",
      "-1",
      "-metadata",
      "library=Floopr, the free loop library",
      "-fflags",
      "+bitexact",
      "-flags:v",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-f",
      "mp3",
      "-",
    ]);

    timidity.stdout.pipe(ffmpeg.stdin);

    ffmpeg.on("error", () => {
      res
        .status(500)
        .send({ success: false, message: "Error converting file" });
    });

    // Now we upload the raw Midi file to Minio
    minioClient.putObject(
      "submissions",
      objectID.insertedId.toString() + ".mid",
      req.file?.buffer,
      function (error: any) {
        if (error) {
          res
            .status(500)
            .send({ success: false, message: "Error uploading file" });
          return console.log(error);
        }
      }
    );

    // Upload the MP3 file to Minio
    minioClient.putObject(
      "submissions",
      objectName,
      ffmpeg.stdout,
      function (error: any) {
        if (error) {
          res
            .status(500)
            .send({ success: false, message: "Error uploading file" });
          return console.log(error);
        }
        res.send({ success: true, message: "File uploaded successfully" });
      }
    );
  } else {
    // If the file is not a MIDI file, use ffmpeg to convert it to an MP3 file
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      "-",
      "-codec:a",
      "libmp3lame",
      "-qscale:a",
      "4",
      "-map_metadata",
      "-1",
      "-metadata",
      "library=Floopr, the free loop library",
      "-fflags",
      "+bitexact",
      "-flags:v",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-f",
      "mp3",
      "-",
    ]);

    ffmpeg.stdin.write(req.file?.buffer);
    ffmpeg.stdin.end();

    ffmpeg.on("error", () => {
      res
        .status(500)
        .send({ success: false, message: "Error converting file" });
    });

    // Upload the MP3 file to Minio
    minioClient.putObject(
      "submissions",
      objectName,
      ffmpeg.stdout,
      function (error: any) {
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
};
