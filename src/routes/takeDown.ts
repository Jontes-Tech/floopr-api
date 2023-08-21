import { loopsCollection, MONGOID } from "../database";
import { Request, Response } from "express";
export const deleteLoop = async (req: Request, res: Response) => {
    const id = req.params.filename;
    // For DMCA takedown requests and mistakes.
    console.log("Deleting a loop, MOSTLY UNIMPLEMENTED. ")

    // Remove it from Mongo
    await loopsCollection.deleteOne({ _id: new MONGOID(id) });

    res.send({ success: true });
};
