ssh root@164.92.135.26 "cd ~/SignalRegistry/api && git pull"
ssh root@164.92.135.26 "cd ~/SignalRegistry/api && bash bootstrap.sh"
ssh root@164.92.135.26 "cd ~/SignalRegistry/api && npm i && pm2 restart api"