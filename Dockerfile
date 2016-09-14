FROM node:6-slim

CMD ["node", "/usr/src/entu-api/master.js"]

ADD ./ /usr/src/entu-api
RUN cd /usr/src/entu-api && npm --silent --production install
