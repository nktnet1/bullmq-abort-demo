import { Queue, QueueEvents, Job } from "bullmq";
import Redis from "ioredis";
import readline from "readline";
import * as dotenv from "dotenv";

dotenv.config();

const redisHost = process.env.REDIS_HOST || "localhost";
const redis = new Redis({ host: redisHost });

const queue = new Queue("dockerQueue", {
  connection: { host: redisHost },
});
const queueEvents = new QueueEvents("dockerQueue", {
  connection: { host: redisHost },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function addJob() {
  const job: Job = await queue.add("sleepTask", {}, { removeOnComplete: true });
  console.log(`Added job ${job.id}`);
}

async function listJobs() {
  const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"]);
  for (const job of jobs) {
    const state = await job.getState();
    console.log(`${job.id}: ${job.name} [${state}]`);
  }
}

async function stopJob(jobId: string) {
  const channel = `cancel:${jobId}`;
  console.log(`Publishing cancel to ${channel}`);
  await redis.publish(channel, "abort");
}

async function main() {
  console.log(`
Welcome to Docker Job CLI!

Commands:
  add           - Add a new job to the queue
  list          - List all jobs and their status
  stop <jobid>  - Cancel a running job by ID
  exit          - Exit the CLI
`);

  while (true) {
    const input = (await prompt("Enter command: ")).trim();

    if (input === "add") {
      await addJob();
    } else if (input === "list") {
      await listJobs();
    } else if (input.startsWith("stop ")) {
      const jobId = input.slice(5).trim();
      if (jobId) {
        await stopJob(jobId);
      } else {
        console.log("Please provide a job ID. Usage: stop <jobid>");
      }
    } else if (input === "exit") {
      await redis.quit();
      await queue.close();
      await queueEvents.close();
      rl.close();
      return;
    } else {
      console.log("Unknown command. Use: add, list, stop <jobid>, exit.");
    }
  }
}

main();