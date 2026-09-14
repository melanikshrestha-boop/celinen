#!/bin/sh
# CI-only adapter: exact packaged executable, isolated native AMD64 Docker runtime.
set -eu
exec docker exec --user "$(id -u):$(id -g)" lenslab-v2-parity /opt/lenslab/v2-native "$@"
