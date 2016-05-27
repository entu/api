FROM node:6-slim

ADD ./ /usr/src/entu-api
RUN cd /usr/src/entu-api && npm --silent --production install

CMD ["node", "/usr/src/entu-api/master.js"]
