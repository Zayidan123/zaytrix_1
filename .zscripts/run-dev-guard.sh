#!/bin/bash
cd /home/z/my-project
while true; do
  echo "[guard] Starting dev server at $(date)"
  bun run dev >> /home/z/my-project/dev.log 2>&1
  EXIT_CODE=$?
  echo "[guard] Dev server exited with code $EXIT_CODE at $(date). Restarting in 3s..."
  sleep 3
done
