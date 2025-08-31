import Redis from "ioredis";
import { Job, Queue } from "bullmq";
import readline from "readline";
import { getChannelIdKey, QUEUE_NAME, REDIS_HOST } from './shared';

const redis = new Redis({ host: REDIS_HOST });

const queue = new Queue(QUEUE_NAME, {
  connection: { host: REDIS_HOST },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = (question: string): Promise<string> => {
  return new Promise((resolve) => rl.question(question, resolve));
};

const addJob = async () => {
  const job = await queue.add("sleepTask", {});
  console.log(`Added job ${job.id}`);
};

const listJobs = async () => {
  const jobs = await queue.getJobs();
  for (const job of jobs) {
    const state = await job.getState();
    console.log(`${job.id}: ${job.name} [${state}]`);
  }
};

const stopJob = async (jobId: string) => {
  const job: Job = await queue.getJob(jobId);
  const jobState = await job.getState();
  if (jobState === 'completed' || jobState === 'failed') {
    console.error(`Error: Job with id ${jobId} has state '${jobState}'.`)
    return;
  }
  console.log(`Publishing cancel for job ${jobId} (current state: ${jobState})`);
  await redis.publish(getChannelIdKey(jobId), "abort");
};

const main = async () => {
  console.log(`
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
      console.log('Exiting...');
      await redis.quit();
      await queue.close();
      rl.close();
      return;
    } else {
      console.log("Unknown command. Use: add, list, stop <jobid>, exit.");
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then(() => process.exit(0));
}
