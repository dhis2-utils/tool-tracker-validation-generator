#!/usr/bin/env bash
# e2e entry point (contract: dhis2-utils/reference-tool-conventions TESTING.md).
# Use a DISPOSABLE instance only: the suite creates and deletes metadata and users.
#
#   DHIS2_URL=http://dhis2-x:8080 DHIS2_USER=local_admin DHIS2_PASS=district \
#   APP_ZIP=$PWD/build/bundle/tool-x-1.0.0.zip RESULTS_DIR=/tmp/out [LABEL=2.42] e2e/run.sh
#
# Exit codes: 0 all tests passed, 1 a test failed, 2 the suite could not run.
set -u
# run.py runs from e2e/, so resolve relative paths first
[ -n "${APP_ZIP:-}" ] && APP_ZIP=$(realpath -- "$APP_ZIP") && export APP_ZIP
[ -n "${RESULTS_DIR:-}" ] && RESULTS_DIR=$(realpath -- "$RESULTS_DIR") && export RESULTS_DIR
cd "$(dirname "$0")" || exit 2
exec python3 run.py
