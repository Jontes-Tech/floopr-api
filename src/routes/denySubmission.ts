import { Request, Response } from "express";
import { submissionsCollection, MONGOID } from "../database";
import sgMail from "@sendgrid/mail";
import { minioClient } from "../minio";
export const denySubmission = async (req: Request, res: Response) => {
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

  const submission = submissionsCollection.findOne({
    _id: new MONGOID(submissionID),
  }) as any;
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

  await submissionsCollection.deleteOne({ _id: submission._id });

  res.send({ success: true, message: "Submission deleted, sent bad news" });
};
