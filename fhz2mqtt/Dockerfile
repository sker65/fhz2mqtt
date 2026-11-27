ARG BUILD_FROM=ghcr.io/home-assistant/base:latest
FROM ${BUILD_FROM}

# The Supervisor builds with this folder as the context, so the app installs the published npm
# package in the version of config.yaml (passed as BUILD_VERSION). By hand:
#   docker build --build-arg BUILD_VERSION=0.5.0 -t fhz2mqtt-app fhz2mqtt
ARG BUILD_VERSION

# udevadm: serialport lists ports through it (--serialport auto)
# serialport 13 ships prebuilt binaries (N-API, musl included), no toolchain needed
RUN test -n "${BUILD_VERSION}" \
    && apk add --no-cache nodejs eudev \
    && apk add --no-cache --virtual .npm npm \
    && npm install -g --omit=dev --no-audit --no-fund "fhz2mqtt@${BUILD_VERSION}" \
    && npm cache clean --force \
    && apk del .npm

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
