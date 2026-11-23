# Build from the project root:
#   docker build -f server/Dockerfile -t crown-oak-server .
FROM node:20-alpine

WORKDIR /app
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev
COPY server/index.js ./server/index.js
COPY js/engine.js ./js/engine.js

ENV PORT=8787
EXPOSE 8787

CMD ["npm", "--prefix", "server", "start"]
