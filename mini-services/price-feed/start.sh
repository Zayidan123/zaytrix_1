#!/bin/bash
cd "$(dirname "$0")"
exec bun --hot index.ts >> /home/z/my-project/price-feed.log 2>&1