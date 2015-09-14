#!/bin/bash

mkdir -p /data/entu-auth/code
cd /data/entu-auth/code

git clone https://github.com/argoroots/entu-auth.git ./
git checkout master
git pull

version=`date +"%y%m%d.%H%M%S"`

docker build -q -t entu-auth:$version ./ && docker tag -f entu-auth:$version entu-auth:latest
docker kill entu-auth
docker rm entu-auth
docker run -d \
    --name="entu-auth" \
    --restart="always" \
    --memory="512m" \
    --env="PORT=80" \
    --env="NEW_RELIC_APP_NAME=entu-auth" \
    --env="NEW_RELIC_LICENSE_KEY=" \
    --env="NEW_RELIC_LOG=stdout" \
    --env="NEW_RELIC_LOG_LEVEL=error" \
    --env="NEW_RELIC_NO_CONFIG_FILE=true" \
    entu-auth:latest

/data/nginx.sh
