import { Request, Response } from "express";
import { minioClient, CopyConditions } from "../minio";
import { submissionsCollection, MONGOID, loopsCollection } from "../database";
import sgMail from "@sendgrid/mail";
import slugify from "slugify";
import { spawn } from "child_process";
export const approveSubmission = async (req: Request, res: Response) => {
  const submissionID = req.body._id || "";
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

  interface Approval {
    _id: string;
    author: string;
    files: string[];
    instrument: string;
    key: string;
    tempo: string;
    timesig: string;
    title: string;
    submissionEmail: string;
  }

  const submission = await submissionsCollection.findOne<Approval>({
    _id: new MONGOID(submissionID),
  });

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
  await loopsCollection.insertOne({
    _id: submissionID,
    title: req.body.title,
    author: submission.author,
    files: req.body.files,
    key: req.body.key,
    tempo: req.body.tempo,
    // deepcode ignore HTTPSourceWithUncheckedType: We trust the user, because they're an admin. Is that bad practice?
    type: req.body.files.includes("mid") ? "midi" : "audio",
    timesig: req.body.timesig,
    name: slugify(req.body.title),
    instrument: req.body.instrument,
    added: new Date().getTime(),
  });

  await submissionsCollection.deleteOne({ _id: new MONGOID(submissionID) });
  console.log(
    `Moving ${submissionID} to loops collection, because it was approved.`
  );
  // deepcode ignore HTTPSourceWithUncheckedType: We trust the user, because they're an admin. Is that bad practice?
  req.body.files.forEach((file: string) => {
    // COPY /submissions/id.file /loops/id.file
    // Create a CopyConditions instance
    const copyConditions = new CopyConditions();
    minioClient.copyObject(
      "loops",
      submissionID + "." + file,
      "/submissions/" + submissionID + "." + file,
      copyConditions,
      function (e) {
        if (e) {
          return console.log(e);
        }
        console.log("Successfully copied the object");

        // DELETE /submissions/id.file
        minioClient.removeObject(
          "submissions",
          submissionID + "." + file,
          function (e) {
            if (e) {
              return console.log(e);
            }
            console.log("Successfully deleted the object");
          }
        );
      }
    );
  });

  res.send({ success: true, message: "Submission approved!" });
};
