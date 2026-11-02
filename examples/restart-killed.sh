#!/usr/bin/env sh
# Example restart command, the partner of kill-leader.sh: starts the container it
# killed. The harness then waits until every endpoint answers /info again.
set -eu
STATE=${STATE_FILE:-/tmp/i3x-failover-killed}
docker start "${CONTAINER_PREFIX:-}$(cat "$STATE")" >/dev/null
