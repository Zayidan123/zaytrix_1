#!/bin/bash
cd /home/z/my-project
if ! pgrep -f "tsx server.ts" > /dev/null 2>&1; then
  cd /home/z/my-project
  nohup setsid bash -c 'cd /home/z/my-project && exec bun run dev' </dev/null >>/home/z/my-project/dev.log 2>&1 &
  disown $! 2>/dev/null
  echo "$(date) - server restarted" >> /home/z/my-project/.zscripts/keepalive.log
fi
