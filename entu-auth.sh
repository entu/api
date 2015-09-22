#!/bin/bash

mkdir -p /data/entu-auth/code
cd /data/entu-auth/code

git clone https://github.com/argoroots/entu-auth.git ./
git checkout master
git pull

version=`date +"%y%m%d.%H%M%S"`

docker build -q -t entu-auth:$version ./ && docker tag -f entu-auth:$version entu-auth:latest
docker stop entu-auth
docker rm entu-auth
docker run -d \
    --name="entu-auth" \
    --restart="always" \
    --memory="512m" \
    --env="PORT=80" \
    --env="GOOGLE_ID=" \
    --env="GOOGLE_SECRET=" \
    --env="FACEBOOK_ID=" \
    --env="FACEBOOK_SECRET=" \
    --env="TAAT_ENTRYPOINT=" \
    --env="TAAT_ISSUER=" \
    --env="TAAT_CERT=/usr/src/entu-auth/ssl/taat.pem" \
    --env="TAAT_PRIVATECERT=/usr/src/entu-auth/ssl/server.pem" \
    --env="NEW_RELIC_APP_NAME=entu-auth" \
    --env="NEW_RELIC_LICENSE_KEY=" \
    --env="NEW_RELIC_LOG=stdout" \
    --env="NEW_RELIC_LOG_LEVEL=error" \
    --env="NEW_RELIC_NO_CONFIG_FILE=true" \
    --env="BUGSNAG_KEY=" \
    entu-auth:latest

/data/nginx.sh
