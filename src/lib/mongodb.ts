import { MongoClient, Db } from "mongodb";
import type { ChatMessage, Conversation, ConversationState } from "./types";

export type { ChatMessage, Conversation, ConversationState };

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.warn("MONGODB_URI is not set");
}

let clientPromise: Promise<MongoClient> | null = null;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI environment variable is not set");
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      const client = new MongoClient(uri);
      global._mongoClientPromise = client.connect();
    }
    return global._mongoClientPromise;
  }
  if (!clientPromise) {
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const c = await getClientPromise();
  const dbName = process.env.MONGODB_DB || "parent_coach";
  return c.db(dbName);
}
