# Do the npm install or yarn install in the full image
FROM mhart/alpine-node:9
WORKDIR /app
COPY package*.json yarn.lock ./
RUN yarn install --production

# Only copy over the node pieces we need from the above image
FROM alpine:3.6
RUN apk update
RUN apk add libtirpc
RUN apk add openssl
COPY --from=0 /usr/bin/node /usr/bin/
COPY --from=0 /usr/lib/libgcc* /usr/lib/libstdc* /usr/lib/
WORKDIR /app
COPY --from=0 /app .
COPY . .
CMD ["node", "SimulatedDevice.js"]