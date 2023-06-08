import { MongoClient, ObjectId } from "mongodb";

const client = new MongoClient(process.env.MONGO as string);
export const db = client.db("floopr");
export const loopsCollection = db.collection("loops");
export const submissionsCollection = db.collection("submissions");
export const confirmationIDsCollection = db.collection("confirmationIDs");
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
