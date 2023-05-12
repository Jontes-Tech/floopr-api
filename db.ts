// deno-lint-ignore-file camelcase no-explicit-any
import { MongoClient } from "https://deno.land/x/mongo@v0.31.2/mod.ts";

const client = new MongoClient();

try {
  await client.connect(Deno.env.get("DB_HOST") || "mongodb://localhost:27017");
} catch (e) {
  throw new Error("Could not connect to database, error: " + e);
}

export const fetchLoops = async(skip: number, limit: number): Promise<any> => {
  const db = client.database("floopr");
  const collection = db.collection<Loop>("loops");
  return await collection
    .find({}, { noCursorTimeout: false } as any)
    .skip(skip)
    .limit(limit)
    .toArray();
}

interface Loop {
  title: string;
  authors: string[];
  files: string[];
  key: string;
  tempo: string;
  type: string;
  timesig: string;
  slug: string;
  instrument: string;
}
