FROM node:6-slim

ADD ./ /usr/src/entu-api
RUN cd /usr/src/entu-api && npm --silent install

CMD ["node", "/usr/src/entu-api/import/import.js"]
