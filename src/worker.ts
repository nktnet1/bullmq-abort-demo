import { Worker, Job } from "bullmq";
import Docker, { Container } from "dockerode";
import Redis from "ioredis";
import { getChannelIdKey, QUEUE_NAME, REDIS_HOST } from './shared';

const docker = new Docker();
const sub = new Redis({ host: REDIS_HOST });

const pullImage = (image: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    docker.pull(image, {}, (err, stream) => {
      if (err) {
        return reject(err);
      }
      if (!stream) {
        throw new Error("Missing stream");
      }
      docker.modem.followProgress(
        stream,
        (err) => {
          if (err) reject(err);
          else resolve();
        },
        (event) => {
          console.log(`\t[image=${image}] Pull event:`, event);
        }
      );
    });
  });
};

const startJobContainer = async (jobId: string): Promise<Container> => {
  console.log("Starting container for:", jobId);
  const image = "alpine:3.14";

  try {
    await docker.getImage(image).inspect();
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(`Failed to inspect image ${image}: ${error.message}.`)
      console.log(`Attempting to pull ${image}...`)
      await pullImage(image);
    } else {
      throw error;
    }
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
};

const createCancelWatcher = (jobId: string): Promise<never> => {
  const channel = getChannelIdKey(jobId);
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
};

const finishOrKillJob = async  (jobId: string, container?: Container) => {
  const channel = getChannelIdKey(jobId);
  if (container) {
    try {
      await container.kill();
    } catch (error) {
      console.error(`Error: failed to kill container with id ${container.id}`, error)
    }
  }

  try {
    await sub.unsubscribe(channel);
  } catch (err) {
    console.warn(`Failed to unsubscribe (jobId=${jobId}, containerId?=${container?.id})`, err);
  }
};

const handleJob = async (job: Job) => {
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
  } catch (err) {
    throw err;
  } finally {
    await finishOrKillJob(job.id, container);
  }
};

const worker = new Worker(QUEUE_NAME, handleJob, {
  connection: { host: REDIS_HOST },
  concurrency: 50,
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});
