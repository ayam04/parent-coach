import { MongoClient, Db } from "mongodb";
import type { ChatMessage, Conversation, ConversationState } from "./types";

export type { ChatMessage, Conversation, ConversationState };

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.warn("MONGODB_URI is not set");
}

let clientPromise: Promise<MongoClient> | null = null;

/** Serverless-friendly options: fail fast rather than holding a request open. */
const CLIENT_OPTIONS = {
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
};

/** Guarantees one document per session and makes lookups index-backed. */
let indexesReady: Promise<void> | null = null;

async function ensureIndexes(db: Db): Promise<void> {
  try {
    await db
      .collection("conversations")
      .createIndex({ sessionId: 1 }, { unique: true, name: "sessionId_unique" });
  } catch (error) {
    // A pre-existing duplicate or a permissions gap must not take the app down.
    console.warn("conversation index not created", error);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI environment variable is not set");
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      const client = new MongoClient(uri, CLIENT_OPTIONS);
      global._mongoClientPromise = client.connect();
    }
    return global._mongoClientPromise;
  }
  if (!clientPromise) {
    const client = new MongoClient(uri, CLIENT_OPTIONS);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const c = await getClientPromise();
  const dbName = process.env.MONGODB_DB || "parent_coach";
  const db = c.db(dbName);
  if (!indexesReady) {
    indexesReady = ensureIndexes(db);
  }
  await indexesReady;
  return db;
}
