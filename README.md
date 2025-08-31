# BULLMQ | Abort Worker Tasks Demo

Project showcasing how active bullmq worker processes can be aborted midway using
[Redis pub/sub](https://redis.io/docs/latest/develop/pubsub/).

This is a proof of concept. The pub/sub implementation can also be exchanged for
alternatives such as [Redis streams](https://redis.io/docs/latest/develop/data-types/streams)
or simple short polling.

## Tools

- redis + bullmq
- docker + docker compose
- nodejs + pnpm

## Video Demo

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

## Context

Dokploy issue 360:
- https://github.com/Dokploy/dokploy/issues/360#issuecomment-3148772194

Bullmq issue 632:
- https://github.com/taskforcesh/bullmq/issues/632
