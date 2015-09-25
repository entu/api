#!/bin/bash

mkdir -p /data/entu-auth/code /data/entu-auth/ssl
cd /data/entu-auth/code

git clone -q https://github.com/argoroots/entu-auth.git ./
git checkout -q master
git pull
printf "\n\n"

version=`date +"%y%m%d.%H%M%S"`
docker build -q -t entu-auth:$version ./ && docker tag -f entu-auth:$version entu-auth:latest
printf "\n\n"

docker stop entu-auth
docker rm entu-auth
docker run -d \
    --name="entu-auth" \
    --restart="always" \
    --memory="512m" \
    --env="PORT=80" \
    --env="COOKIE_SECRET=" \
    --env="GOOGLE_ID=" \
    --env="GOOGLE_SECRET=" \
    --env="FACEBOOK_ID=" \
    --env="FACEBOOK_SECRET=" \
    --env="TWITTER_KEY=" \
    --env="TWITTER_SECRET=" \
    --env="LIVE_ID=" \
    --env="LIVE_SECRET=" \
    --env="TAAT_ENTRYPOINT=" \
    --env="TAAT_ISSUER=" \
    --env="TAAT_CERT=/usr/src/entu-auth/ssl/taat.pem" \
    --env="TAAT_PRIVATECERT=/usr/src/entu-auth/ssl/server.pem" \
    --env="NEW_RELIC_APP_NAME=entu-auth" \
    --env="NEW_RELIC_LICENSE_KEY=" \
    --env="NEW_RELIC_LOG=stdout" \
    --env="NEW_RELIC_LOG_LEVEL=error" \
    --env="NEW_RELIC_NO_CONFIG_FILE=true" \
    --env="SENTRY_DSN=" \
    --volume="/data/entu-auth/ssl:/usr/src/entu-auth/ssl" \
    entu-auth:latest

docker inspect -f "{{ .NetworkSettings.IPAddress }}" entu-auth
printf "\n\n"

/data/nginx.sh
