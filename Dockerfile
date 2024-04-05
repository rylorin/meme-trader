FROM node:20

WORKDIR /root
COPY package.json .
COPY yarn.lock .
RUN yarn install
COPY tsconfig.json .
COPY src/ ./src
RUN yarn build
COPY config/ ./config

ENTRYPOINT [ "yarn", "start" ]
