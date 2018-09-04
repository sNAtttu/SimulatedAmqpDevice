# Do the npm install or yarn install in the full image
FROM mhart/alpine-node:9
WORKDIR /app
COPY package*.json yarn.lock ./
RUN yarn install --production
COPY . .
CMD ["node", "SimulatedDevice.js"]