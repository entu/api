FROM node:4.0-slim

ADD ./ /usr/src/entu-auth
RUN cd /usr/src/entu-auth && npm --silent --production install

CMD ["/usr/src/entu-auth/master.js"]
