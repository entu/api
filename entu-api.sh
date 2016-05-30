#!/bin/bash

mkdir -p /data/entu_api/code /data/entu_api/ssl
cd /data/entu_api/code

git clone -q https://github.com/argoroots/entu-api.git ./
git checkout -q master
git pull

printf "\n\n"
version=`date +"%y%m%d.%H%M%S"`
docker build --quiet --pull --tag=entu_api:$version ./ && docker tag entu_api:$version entu_api:latest

printf "\n\n"
docker stop entu_api
docker rm entu_api
docker run -d \
    --net="entu" \
    --name="entu_api" \
    --restart="always" \
    --cpu-shares=256 \
    --memory="1g" \
    --env="NODE_ENV=production" \
    --env="VERSION=$version" \
    --env="PORT=80" \
    --env="MONGODB=" \
    --env="COOKIE_DOMAIN=.entu.ee" \
    --env="JWT_SECRET=" \
    --env="GOOGLE_ID=" \
    --env="GOOGLE_SECRET=" \
    --env="FACEBOOK_ID=" \
    --env="FACEBOOK_SECRET=" \
    --env="TWITTER_KEY=" \
    --env="TWITTER_SECRET=" \
    --env="LIVE_ID=" \
    --env="LIVE_SECRET=" \
    --env="TAAT_ENTRYPOINT=https://sarvik.taat.edu.ee/saml2/idp/SSOService.php" \
    --env="TAAT_ISSUER=https://api.entu.ee/taat" \
    --env="TAAT_CERT=/usr/src/entu-api/ssl/taat.pem" \
    --env="TAAT_PRIVATECERT=/usr/src/entu-api/ssl/server.pem" \
    --env="NEW_RELIC_APP_NAME=entu-api" \
    --env="NEW_RELIC_LICENSE_KEY=" \
    --env="NEW_RELIC_LOG=stdout" \
    --env="NEW_RELIC_LOG_LEVEL=error" \
    --env="NEW_RELIC_NO_CONFIG_FILE=true" \
    --env="SENTRY_DSN=" \
    --volume="/data/entu_api/ssl/:/usr/src/entu-api/ssl/:ro" \
    entu_api:latest

printf "\n\n"
docker exec nginx /etc/init.d/nginx reload
