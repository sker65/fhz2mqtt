#!/usr/bin/with-contenv bashio
# shellcheck shell=bash

set -euo pipefail

MQTT_URL="$(bashio::config 'mqtt_url')"
MQTT_USERNAME="$(bashio::config 'mqtt_username')"
MQTT_PASSWORD="$(bashio::config 'mqtt_password')"

if ! bashio::var.has_value "${MQTT_URL}"; then
    if ! bashio::services.available 'mqtt'; then
        bashio::exit.nok "Configure mqtt_url or install the Mosquitto broker app"
    fi
    MQTT_URL="mqtt://$(bashio::services mqtt 'host'):$(bashio::services mqtt 'port')"
    MQTT_USERNAME="$(bashio::services mqtt 'username')"
    MQTT_PASSWORD="$(bashio::services mqtt 'password')"
fi

args=(
    --serialport "$(bashio::config 'serialport')"
    --mqtt-url "${MQTT_URL}"
    --name "$(bashio::config 'instance_name')"
    --verbosity "$(bashio::config 'log_level')"
    --ha-prefix "$(bashio::config 'ha_prefix')"
    --fht-retries "$(bashio::config 'fht_retries')"
    --fht-retry-after "$(bashio::config 'fht_retry_after')"
)

if bashio::var.has_value "${MQTT_USERNAME}"; then
    args+=(--mqtt-username "${MQTT_USERNAME}")
fi
if bashio::var.has_value "${MQTT_PASSWORD}"; then
    args+=(--mqtt-password "${MQTT_PASSWORD}")
fi
if bashio::config.has_value 'fht_code'; then
    args+=(--fht-code "$(bashio::config 'fht_code')")
fi
if bashio::config.has_value 'only'; then
    args+=(--only "$(bashio::config 'only')")
fi
if ! bashio::config.true 'fht_buffer_check'; then
    args+=(--no-fht-buffer-check)
fi

bashio::log.info "Starting fhz2mqtt $(fhz2mqtt --version 2>/dev/null || true)"
exec fhz2mqtt "${args[@]}"
