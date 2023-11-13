################################################################################
# Node.js server
################################################################################
npm i 
pm2 start main.js --name api
pm2 save

################################################################################
# Nginx server block
################################################################################
rm -f /etc/nginx/sites-enabled/api.signalregistry.net
nginx -s reload
cat > /etc/nginx/sites-enabled/api.signalregistry.net <<- EOM
server {

  listen 80;
  listen [::]:80;

  server_name api.signalregistry.net;

  # https://docs.digitalocean.com/glossary/allow-origin/
  add_header Access-Control-Allow-Origin "\$http_origin";
  # https://docs.digitalocean.com/glossary/allow-cred/
  add_header Access-Control-Allow-Credentials 'true';

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host \$host;
    proxy_set_header Remote_Uri \$request_uri;
    proxy_cache_bypass \$http_upgrade;
  }
}
EOM
nginx -t
nginx -s reload

sudo certbot --nginx -d api.signalregistry.net
nginx -s reload
