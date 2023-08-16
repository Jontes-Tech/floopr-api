// Central middleware for admin routes

import { Request, Response, NextFunction } from "express";
import { rateLimiter } from "../index";

export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (
    req.headers.Authorization === process.env.SUPER_SECRET_TOKEN
  ) {
    console.log(
      "Successful admin auth, potentially problematic, but not necessarily"
    );
    next();
  } else {
    res.status(401).send("Unauthorized");
    rateLimiter.penalty(32);
  }
};
