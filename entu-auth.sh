#!/bin/bash

mkdir -p /data/entu_auth/code /data/entu_auth/ssl
cd /data/entu_auth/code

git clone -q https://github.com/argoroots/entu-auth.git ./
git checkout -q master
git pull

printf "\n\n"
version=`date +"%y%m%d.%H%M%S"`
docker build --quiet --pull --tag=entu_auth:$version ./ && docker tag entu_auth:$version entu_auth:latest

printf "\n\n"
docker stop entu_auth
docker rm entu_auth
docker run -d \
    --net="entu" \
    --name="entu_auth" \
    --restart="always" \
    --cpu-shares=256 \
    --memory="1g" \
    --env="NODE_ENV=production" \
    --env="VERSION=$version" \
    --env="PORT=80" \
    --env="COOKIE_DOMAIN=.entu.ee" \
    --env="GOOGLE_ID=" \
    --env="GOOGLE_SECRET=" \
    --env="FACEBOOK_ID=" \
    --env="FACEBOOK_SECRET=" \
    --env="TWITTER_KEY=" \
    --env="TWITTER_SECRET=" \
    --env="LIVE_ID=" \
    --env="LIVE_SECRET=" \
    --env="TAAT_ENTRYPOINT=https://sarvik.taat.edu.ee/saml2/idp/SSOService.php" \
    --env="TAAT_ISSUER=https://auth.entu.ee/taat" \
    --env="TAAT_CERT=/usr/src/entu-auth/ssl/taat.pem" \
    --env="TAAT_PRIVATECERT=/usr/src/entu-auth/ssl/server.pem" \
    --env="NEW_RELIC_APP_NAME=entu-auth" \
    --env="NEW_RELIC_LICENSE_KEY=" \
    --env="NEW_RELIC_LOG=stdout" \
    --env="NEW_RELIC_LOG_LEVEL=error" \
    --env="NEW_RELIC_NO_CONFIG_FILE=true" \
    --env="SENTRY_DSN=" \
    --volume="/data/entu_auth/ssl/:/usr/src/entu-auth/ssl/:ro" \
    entu_auth:latest

printf "\n\n"
docker exec nginx /etc/init.d/nginx reload
