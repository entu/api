FROM node:8-slim

ADD ./ /usr/src/entu-api
RUN cd /usr/src/entu-api && npm --silent install

CMD ["node", "/usr/src/entu-api/src/import/import.js"]
