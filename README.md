# BULLMQ Abort Running Task Demo

Demo project for how to abort bullmq workers that run docker jobs.

Tools:
- redis (bullmq, pubsub)
- docker + docker compose
- nodejs (pnpm)

## Instructions

1. Install dependencies

    ```sh
    pnpm install
    ```

1. Pull the alpine image used for the "sleep" dummy process
   
   ```sh
   docker pull alpine:3.14
   ```

1. Start the redis container

   ```
   docker compose up redis
   ```

1. In a new terminal, start the worker container
   
   ```
   pnpm start:worker
   ```

1. In another (split) terminal, start the producer container
   
   ```
   pnpm start:producer
   ```

1. In the producer container, use the `start` command to create a job, and use `stop <job>` to abort it
