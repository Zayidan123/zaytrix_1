#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "tsx server.ts" > /dev/null 2>&1; then
    echo "[watchdog] $(date) Server down, restarting..."
    bun run dev >> /home/z/my-project/dev.log 2>&1 &
    echo $! > /home/z/my-project/.zscripts/dev.pid
    sleep 15
  fi
  sleep 10
done
