import { Worker, Job } from "bullmq";
import Docker, { Container } from "dockerode";
import Redis from "ioredis";
import { getChannelIdKey, QUEUE_NAME, REDIS_HOST } from "./shared";

const docker = new Docker();
const sub = new Redis({ host: REDIS_HOST });

type ContainerJobStatus =
  | "CONTAINER_FINISH"
  | "CONTAINER_FINISH_ERROR"
  | "CONTAINER_CANCELLED"
  | "CONTAINER_CANCELLED_ERROR";

interface ContainerJobResult {
  status: ContainerJobStatus;
  data: unknown | null;
  error: unknown | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      console.log(`Failed to inspect image ${image}: ${error.message}.`);
      console.log(`Attempting to pull ${image}...`);
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
      `
        .trim()
        .replace(/\s+/g, " "),
    ],
    Tty: false,
  });

  await container.start();
  return container;
};

const createCancelWatcher = (jobId: string, container: Container): Promise<string> => {
  const channel = getChannelIdKey(jobId);
  return new Promise((resolve, reject) => {
    const handler = async (msgChannel: string) => {
      if (msgChannel === channel) {
        await killContainer(container);
        sub.removeListener("message", handler);
        resolve(`Job ${jobId} cancelled via Redis PubSub`);
      }
    };
    sub.subscribe(channel).catch(reject);
    sub.on("message", handler);
  });
};

const killContainer = async (container: Container) => {
  try {
    await container.kill();
  } catch (error) {
    console.error(
      `Error: failed to kill container with id ${container.id}`,
      error
    );
  }
};

const handleJobPromise = async (
  promise: Promise<unknown>,
  successStatus: ContainerJobStatus,
  errorStatus: ContainerJobStatus
): Promise<ContainerJobResult> => {
  try {
    return {
      status: successStatus,
      data: await promise,
      error: null,
    };
  } catch (error: unknown) {
    return {
      status: errorStatus,
      data: null,
      error,
    }
  }
};

const handleJob = async (job: Job) => {
  if (!job.id) {
    throw new Error("ERROR: missing job.id");
  }
  const container = await startJobContainer(job.id);

  const logStream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });
  logStream.on("data", (chunk) => {
    process.stdout.write(chunk.toString());
  });

  const cancelWatcher = handleJobPromise(
    createCancelWatcher(job.id, container),
    "CONTAINER_CANCELLED",
    "CONTAINER_CANCELLED_ERROR"
  );
  const containerWait = handleJobPromise(
    // Async sleep so that aborting/cancelling the container via pubsub will
    // cause the cancelWatcher promise to resolve first before containerWait.
    container.wait().then(() => sleep(0)),
    "CONTAINER_FINISH",
    "CONTAINER_FINISH_ERROR"
  );

  const result = await Promise.race([cancelWatcher, containerWait]);
  console.log({ result });

  switch (result.status) {
    case "CONTAINER_CANCELLED":
      console.log(`[JobID=${job.id}] cancelled.`);
      break;

    case "CONTAINER_CANCELLED_ERROR":
      console.warn(`[JobID=${job.id}] cancelled with errors:`, result.error);
      break;

    case "CONTAINER_FINISH":
      console.log(`[JobID=${job.id}] finished.`);
      break;

    default:
      console.warn(`[JobID=${job.id}] finished with errors:`, result.error);
      break;
  }

  const channel = getChannelIdKey(job.id);
  try {
    await sub.unsubscribe(channel);
  } catch (err) {
    console.warn(`Failed to unsubscribe (jobId=${job.id})`, err);
  }
};

const worker = new Worker(QUEUE_NAME, handleJob, {
  connection: { host: REDIS_HOST },
  concurrency: 50,
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});
