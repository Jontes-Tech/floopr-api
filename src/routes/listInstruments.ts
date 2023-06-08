import { Request, Response } from "express";
import { loopsCollection } from "../database";
export const listInstruments = (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=86400");
  // deepcode ignore TooPermissiveCorsHeader: Public API, we don't care about CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Find all distinct instruments in Mongo, then return them as an array
  loopsCollection
    .distinct("instrument")
    .then(function (instruments: any) {
      res.json(instruments);
    })
    .catch(function (err: any) {
      res
        .status(500)
        .send({ success: false, message: "Error retrieving instruments" });
    });
};
