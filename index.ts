import express from "express";
import { createLogger } from "@lvksh/logger";
import chalk from "chalk";
import * as dotenv from "dotenv";
import cors from "cors";
const hcaptcha = require("express-hcaptcha");
dotenv.config();
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import { spawn } from "child_process";
import https from "https";
const SECRET = process.env.HCAPTCHA_SECRET_KEY;
const log = createLogger(
  {
    ok: {
      label: chalk.greenBright`[OK]`,
      newLine: "| ",
      newLineEnd: "\\-",
    },
    debug: chalk.magentaBright`[DEBUG]`,
    info: {
      label: chalk.cyan`[INFO]`,
      newLine: chalk.cyan`⮡`,
      newLineEnd: chalk.cyan`⮡`,
    },
    start: chalk.gray`[START]`,
  },
  { padding: "PREPEND" },
  console.log
);

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "http://test.floopr.org:3001",
  })
);

app.get("/", (req: any, res: any) => {
  res.redirect("https://floopr.org");
});

app.get(
  "/v1/publicstats",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,
    standardHeaders: true,
  }),
  async (req: any, res: any) => {
    const downloads = await fetch(
      "https://stats.jontes.page/api/v1/stats/aggregate?metrics=events&site_id=floopr.org&filters=event%3Aname%3D%3DFile%20Download",
      {
        headers: {
          Authorization: "Bearer " + process.env.PLAUSIBLE_KEY,
        },
      }
    );
    res.send({
      downloads: (await downloads.json()).results.events.value,
    });
  }
);

app.post(
  "/v1/contribute",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
  }),
  hcaptcha.middleware.validate(SECRET),
  async (req: any, res: any) => {
    let ifmidi = `Save this in /public/loops/${req.body.category}/${req.body.filename}.${req.body.filetype}
  cdn.nodesite.eu/${req.body.midi}.mid<br>
  And this in /public/loops/${req.body.category}/${req.body.filename}.mid<br>
  v2cdn.nodesite.eu/${req.body.audio}.wav`;
    let ifaudio = `Save this in /public/loops/${req.body.category}/${req.body.filename}.${req.body.filetype}
  cdn.nodesite.eu/${req.body.audio}.${req.body.filetype}`;

    const transporter = nodemailer.createTransport({
      host: "smtp-relay.sendinblue.com",
      port: 587,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWD,
      },
    });

    // send email
    await transporter.sendMail({
      from: "floopr-submissions@jontes.page",
      to: process.env.EMAIL_TO,
      subject: `Floopr | New submission from ${req.body.creator} at ${
        req.headers["x-forwarded-for"] || req.socket.remoteAddress
      }`,
      html: `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="X-UA-Compatible" content="IE=edge">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body>
          <h1>New Post By ${req.body.creator} (${req.body.email}) @ ${
        req.headers["x-forwarded-for"] || req.socket.remoteAddress
      }</h1>
          Add the following content to /src/pages/loops/${req.body.category}/${
        req.body.filename
      }.json
      <br>
          <div style="background-color:#d1d5db; white-space:pre; padding: 2vw">{
  "title": "${req.body.title}",
  "authors": [${req.body.creator}],
  "key": "${req.body.key}",
  "tempo": "${req.body.tempo}",
  "type": "${req.body.type}",
  "timesig": "${req.body.timesig}",
  "instrument": "${req.body.instrument}",
  "filename": "${req.body.filename}",
  }
  </div><br>
          ${req.body.type === "midi" ? ifmidi : ifaudio}</body>
      </html>`,
    });

    res.send("Submitted Successfully :jonte-thumbsup:");
    log.info(
      `Req from ${
        req.headers["x-forwarded-for"] || req.socket.remoteAddress
      } containing ${req.body.title}`
    );
  }
);

app.post(
  "/v1/synth",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
  }),
  (req, res) => {
    const timidity = spawn("timidity", ["-", "-Ow", "-o", "-"]);
    const cdn_req = https.request(
      "https://v2cdn.nodesite.eu/",
      { method: "PUT" },
      (cdn_res) => cdn_res.pipe(res)
    );
    cdn_req.setHeader("Content-Type", "audio/wave");
    req.pipe(timidity.stdin);
    timidity.stdout.pipe(cdn_req);
  }
);

app.listen(process.env.PORT, () => {
  log.start("Starting the Floopr API @ port " + process.env.PORT);
});
