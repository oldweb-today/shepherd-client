FROM node:10

WORKDIR /build

ADD . /build

RUN yarn install


VOLUME /output

CMD ["yarn", "build-docker"]


