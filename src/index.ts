import express from "express";
import helmet from "helmet";
import { config } from "dotenv";
import morgan from "morgan";
import Multer from "multer";

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

app.get("/v1/loops", listLoops);

app.get("/v1/instruments", listInstruments);

app.get("/v1/loops/:filename", downloadFile);

app.post(
  "/v1/upload",
  Multer({ storage: Multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }).single("audio"),
  contribute
);

app.get("/v1/confirm", confirmEmail);

app.get("/v1/submissions", listSubmissions);

app.delete("/v1/:submissionID", denySubmission);

app.post("/v1/approve/:submissionID", approveSubmission);

app.get("/", (req, res) => {
  res.redirect("https://floopr.org")
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
