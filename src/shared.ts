import dotenv from "dotenv";

dotenv.config();

export const QUEUE_NAME = "dockerQueue";
export const REDIS_HOST = process.env.REDIS_HOST || "localhost";

export const getChannelIdKey = (jobId: string) => {
  return `cancel:${jobId}`
}
