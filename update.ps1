ssh root@142.93.172.57 "cd ~/SignalRegistry/api && git checkout node.js && git pull"
ssh root@142.93.172.57 "cd ~/SignalRegistry/api && bash bootstrap.sh"
ssh root@142.93.172.57 "cd ~/SignalRegistry/api && npm i && pm2 restart api"