import { Request, Response } from "express";
import { MONGOID, confirmationIDsCollection, submissionsCollection } from "../database";
export const confirmEmail = async (req: Request, res: Response) => {
  const confirmationToken = req.query.token;
  if (!confirmationToken) {
    res.status(400).send({ success: false, message: "No token provided" });
    return;
  }

  // We have two collections: one for submissions and one for confirmation IDs, here are the interfaces for both
  interface Submission {
    _id: string;
    title: string;
    author: string;
    files: string[];
    key: string;
    tempo: number;
    type: string;
    timesig: string;
    instrument: string;
    name: string;
    submissionEmail: string;
    submissionIP: string;
    date: number;
    confirmed: boolean;
  }

  interface ConfirmationID {
    _id: string;
    token: string;
    submissionEmail: string;
    date: number;
  }

  // Since the user got sent a token in contribute.ts, we can use that to find the submission
  const confirmationID = await confirmationIDsCollection.findOne<ConfirmationID>(
    {
      token: confirmationToken,
    }
  );

  if (!confirmationID) {
    res.status(400).send({ success: false, message: "Invalid token" });
    return;
  }

  // We now have validated the token, so we can mark the submission as confirmed. We find the submission by the email address that was used to submit it, since we can assume that stays the same, most of the time
  const submission = await submissionsCollection.findOne<Submission>({
    submissionEmail: confirmationID.submissionEmail,
  });

  if (!submission) {
    res.status(400).send({ success: false, message: "Invalid submission" });
    return;
  }

  // We can now mark the submission as confirmed
  await submissionsCollection.updateOne(
    { _id: new MONGOID(submission._id) },
    { $set: { confirmed: true } }
  );

  // And delete the confirmation ID, since it's no longer needed, and we don't want to keep it around
  await confirmationIDsCollection.deleteOne({
    _id: new MONGOID(confirmationID._id),
  });

  // Because we're hopefully using guard clauses, we can now assume that everything went well, and send a success message
  res.status(200).send({ success: true, message: "Submission confirmed, thanks for your patience" });
};
