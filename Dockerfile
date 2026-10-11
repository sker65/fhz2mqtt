FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# serialport 13 ships prebuilt binaries (N-API), no toolchain needed
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js config.js ./
COPY lib/ ./lib/

ENV NODE_ENV=production \
    FHZ2MQTT_MQTT_URL=mqtt://localhost \
    FHZ2MQTT_NAME=fhz \
    FHZ2MQTT_SERIALPORT=/dev/ttyUSB0 \
    FHZ2MQTT_VERBOSITY=info

# run with: --device /dev/ttyUSB0 --group-add $(stat -c %g /dev/ttyUSB0)
USER node

ENTRYPOINT ["node", "index.js"]
