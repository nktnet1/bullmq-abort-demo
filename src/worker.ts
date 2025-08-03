import { Worker, Job } from "bullmq";
import Docker, { Container } from "dockerode";
import Redis from "ioredis";
import * as dotenv from "dotenv";

dotenv.config();

const redisHost = process.env.REDIS_HOST || "localhost";
const docker = new Docker();
const sub = new Redis({ host: redisHost });

async function pullImage(image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    docker.pull(image, {}, (err, stream) => {
      if (err) {
        return reject(err);
      }
      if (!stream) {
        throw new Error("Missing stream");
      }
      docker.modem.followProgress(stream, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function startJobContainer(jobId: string): Promise<Container> {
  console.log("Starting container for:", jobId);
  const image = "alpine:3.14";

  try {
    await docker.getImage(image).inspect();
  } catch {
    await pullImage(image);
  }

  const container = await docker.createContainer({
    Image: image,
    Cmd: [
      "sh",
      "-c",
      `
        start=$(date +%s);
        count=1;
        while [ $(( $(date +%s) - start )) -lt 30 ]; do
          echo "[JobID=${jobId}] $count/30";
          count=$((count + 1));
          sleep 1;
        done
      `.trim().replace(/\s+/g, ' ')
    ],
    Tty: false,
  });

  await container.start();
  return container;
}

function createCancelWatcher(jobId: string): Promise<never> {
  const channel = `cancel:${jobId}`;
  return new Promise((_, reject) => {
    const handler = (msgChannel: string) => {
      if (msgChannel === channel) {
        sub.removeListener("message", handler);
        reject(new Error(`Job ${jobId} cancelled via Redis PubSub`));
      }
    };
    sub.subscribe(channel).catch(reject);
    sub.on("message", handler);
  });
}

async function cleanup(jobId: string, container?: Container) {
  const channel = `cancel:${jobId}`;
  try {
    await sub.unsubscribe(channel);
  } catch {}
  if (container) {
    try {
      await container.kill();
    } catch {}
  }
}

async function handleJob(job: Job): Promise<{ status: string }> {
  if (!job.id) {
    throw new Error("ERROR: missing job.id");
  }
  const container = await startJobContainer(job.id);
  const cancelWatcher = createCancelWatcher(job.id);

  const logStream = await container.attach({ stream: true, stdout: true, stderr: true });
  logStream.on("data", (chunk) => {
    process.stdout.write(chunk.toString());
  });

  try {
    await Promise.race([container.wait(), cancelWatcher]);
    return { status: "completed" };
  } catch (err) {
    throw err;
  } finally {
    await cleanup(job.id, container);
  }
}

const worker = new Worker("dockerQueue", handleJob, {
  connection: { host: redisHost },
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});