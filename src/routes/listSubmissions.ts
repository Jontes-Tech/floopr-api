import { submissionsCollection } from "../database";
import { Request, Response } from "express";

export const listSubmissions = async (req: Request, res: Response) => {
  const loops = await submissionsCollection
    .find({ confirmed: true })
    .sort({ date: -1 })
    .toArray();
  res.send(loops);
};
