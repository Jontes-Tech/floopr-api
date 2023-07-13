import { loopsCollection } from "../database";
import { Request, Response } from "express";
export const listLoops = async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=86400");
  // deepcode ignore TooPermissiveCorsHeader: Public API, we don't care about CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const pageNumber = parseInt(req.query.pageNumber as string) || 0;
    const limit = parseInt((req.query.limit as string) || "128");
    if (limit > 128) {
      res.status(400).send({
        success: false,
        message: "Limit must be less than or equal to 64",
      });
      return;
    }
    const result: any = {};
    const instrument = req.query.instrument as string;

    const totalLoops = await loopsCollection.countDocuments({
      instrument: instrument,
    });
    const loops = await loopsCollection
      .find({ instrument: instrument })
      .skip(pageNumber * limit)
      .sort({ title: 1 })
      .limit(limit)
      .toArray();

    result.limit = limit;
    result.page = pageNumber;
    result.totalLoops = totalLoops;
    result.loops = loops;
    res.json(result);
  } catch (err) {
    res.status(500).send({ success: false, message: "Error retrieving loops" });
  }
};
