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
    origin: "https://floopr.org",
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
    let ifmidi = `Save this in /static/audio/${req.body.category}/${req.body.filename}.mid.audio
  cdn.nodesite.eu/${req.body.audio}.${req.body.filetype}<br>
  And this in /static/audio/${req.body.category}/${req.body.filename}.mid<br>
  synth.nodesite.eu/api/cat/${req.body.midi}.mid`;
    let ifaudio = `Save this in /static/audio/${req.body.category}/${req.body.filename}.${req.body.filetype}
  cdn.nodesite.eu/${req.body.audio}.${req.body.filetype}`;

    const transporter = nodemailer.createTransport({
      host: "smtp-relay.sendinblue.com",
      port: 587,
      auth: {
        user: process.env.EMAIL_TO,
        pass: process.env.EMAIL_PASSWD,
      },
    });

    // send email
    await transporter.sendMail({
      from: "floopr-submissions@jontes.page",
      to: "jonatan@jontes.page",
      subject: `Floopr | New submission from ${req.body.creator} at ${
        req.headers["x-forwarded-for"] || req.socket.remoteAddress
      }`,
      html: `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
        body {
          color: #f1f5f9;
          font-size: 125%;
          max-width: 45rem;
          padding: 1rem;
          margin: 0 auto;
          background-color: #0f172a;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        }
        
        a {
          color: #fde68a;
        }
        
        .content {
          margin-bottom: 2rem;
        }
        
        /* NAVIGATION */
        
        .site-nav {
          display: flex;
          border-radius: 10px;
          background-color: #1e293b;
          box-shadow: 0px 10px 27px -3px rgba(0,0,0,0.1);
        }
        
        .site-nav a {
          display: block;
          padding: 1rem;
        }
        
        .site-nav .logo {
          font-weight: bold;
          padding-left: 0;
          height: 24px;
        }
        
        .main-menu {
          display: flex;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        
        @media screen and (max-width: 48rem) {
          .site-nav,
          .main-menu {
            flex-direction: column;
          }
        }
        
        .pagination {
          display: flex;
          list-style: none;
          border-radius: 0.25rem;
          padding: 0;
          justify-content: center;
        }
        
        .page-link {
          position: relative;
          display: block;
          padding: 0.75rem 1rem;
          line-height: 1.25;
          color: #007bff;
          background-color: #1e293b;
          border: 1px solid #dee2e6;
        }
        
        .homepage .page-link,
        .listing .page-link {
          background-color: #fff;
        }
        
        .page-item.disabled .page-link {
          color: #6c757d;
          pointer-events: none;
          cursor: auto;
          background-color: #fff;
          border-color: #dee2e6;
        }
        
        .page-item.active .page-link {
          z-index: 1;
          color: #fff;
          background-color: #fbbf24;
          border-color: #d97706;
        }
        .container {
          background-color: #1e293b;
          margin: 20px;
          padding: 10px;
          border-radius: 10px;
        }
        .info {
          color: grey;
          font-size: 16px;
        }
        
        .basic-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        }
        .card {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          font-size: 3rem;
          color: #fff;
          box-shadow: rgba(3, 8, 20, 0.1) 0px 0.15rem 0.5rem, rgba(2, 8, 20, 0.1) 0px 0.075rem 0.175rem;
          height: 100%;
          width: 100%;
          border-radius: 4px;
          transition: all 500ms;
          overflow: hidden;
        
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
        }
        
        .card:hover {
          box-shadow: rgba(2, 8, 20, 0.1) 0px 0.35em 1.175em, rgba(2, 8, 20, 0.08) 0px 0.175em 0.5em;
          transform: translateY(-3px) scale(1.04);
        }
        .output {
          font-size: 12px;
        }
        .code {
          background-color: black;
          white-space: pre-wrap;
        }
        </style>
    </head>
    <body>
        <h1>New Post By ${req.body.creator} (${req.body.email}) @ ${
        req.headers["x-forwarded-for"] || req.socket.remoteAddress
      }</h1>
        Add the following content to /content/${req.body.category}/${
        req.body.filename
      }.${req.body.filetype}.md
    <br>
        <div class="code">{
"title": "${req.body.title}"
"authors": [${req.body.creator}]
"key": "${req.body.key}"
"tempo": "${req.body.tempo}"
"type": "${req.body.type}"
"timesig": "${req.body.timesig}"
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
