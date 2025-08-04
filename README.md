# BULLMQ | Abort Worker Tasks Demo

Project showcasing how active bullmq worker processes can be aborted midway.

For more context, see:
- https://github.com/Dokploy/dokploy/issues/360#issuecomment-3148772194

## Tools:

- redis (bullmq, pubsub)
- docker + docker compose
- nodejs (pnpm)

## Demo:

[bullmq-abort-demo.webm](https://github.com/user-attachments/assets/f442730d-c71e-4f1e-a2fe-dc7b05a6cd86)


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
