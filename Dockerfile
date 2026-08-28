FROM node:22-alpine

# node:sqlite is built into Node 22+ (still experimental)
ENV NODE_OPTIONS=--experimental-sqlite

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Start the bot
CMD ["npm", "start"]
