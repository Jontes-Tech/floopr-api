import { submissionsCollection } from "../database";
import { Request, Response } from "express";

export const listSubmissions = async (req: Request, res: Response) => {
  const auth = req.headers.authorization || "";

  if (!auth || auth !== process.env.SUPERSECRETADMIN) {
    res.status(401).send({ success: false, message: "Unauthorized" });
    return;
  }
  const loops = await submissionsCollection
    .find({ confirmed: true })
    .sort({ date: -1 })
    .toArray();
  res.send(loops);
};
