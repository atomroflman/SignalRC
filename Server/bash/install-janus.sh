#!/bin/bash
set -e

if [ -x /opt/janus/bin/janus ]; then
    echo "Janus Gateway already installed at /opt/janus, skipping."
    exit 0
fi

JANUS_BUILD_DIR=$(mktemp -d)
cd "$JANUS_BUILD_DIR"

git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway

# 3. Custom options
./autogen.sh

./configure \
  --prefix=/opt/janus \
  --enable-websockets \
  --enable-plugin-streaming \
  --enable-plugin-audiobridge \
  --enable-rest \
  --disable-data-channels \
  --disable-mqtt \
  --disable-rabbitmq \
  --disable-docs \
  --disable-lua \
  --disable-plugin-nosip \
  --disable-plugin-sip \
  --disable-plugin-textroom \
  --disable-plugin-videocall \
  --disable-plugin-voicemail \
  --disable-plugin-echotest \
  --disable-plugin-nanomsg \
  --disable-mqtt-event-handler \
  --disable-rabbitmq-event-handler \
  --disable-plugin-videoroom 

# 4. Build und Installation
make -j$(nproc)
make install
make configs

rm -rf "$JANUS_BUILD_DIR"

echo "Janus Gateway built successfully!"
echo "Start Janus with: /opt/janus/bin/janus"