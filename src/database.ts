import { MongoClient, ObjectId } from "mongodb";

export const client = new MongoClient(process.env.MONGO as string);
export const MONGOID = ObjectId;

async function connectToDatabase() {
  try {
    await client.connect();
    console.log("Connected to MongoDB Successfully");
  } catch (err) {
    console.error("Could not connect to MongoDB", err);
  }
}

connectToDatabase();
