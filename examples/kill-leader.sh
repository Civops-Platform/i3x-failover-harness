#!/usr/bin/env sh
# Example kill command for a pair of i3X Nexus nodes, each in its own Docker
# container. It asks a node's /info which node holds the write lease (the
# governor), SIGKILLs that node's container and remembers which one it was so
# restart-killed.sh can bring it back. Adapt the lookup for other servers: the
# harness only needs a command that takes one node down.
#
#   NODES="node-a=http://127.0.0.1:8411/v1 node-b=http://127.0.0.1:8412/v1"
#   CONTAINER_PREFIX=i3x-     (container name = prefix + node id)
set -eu
STATE=${STATE_FILE:-/tmp/i3x-failover-killed}
gov=""
for n in $NODES; do
  url=${n#*=}
  gov=$(curl -sf --max-time 2 "$url/info" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).result["x-nexus"].redundancy.governor??"")}catch{}})') || true
  [ -n "$gov" ] && break
done
[ -n "$gov" ] || { echo "no node reports a governor" >&2; exit 1; }
echo "$gov" > "$STATE"
docker kill --signal KILL "${CONTAINER_PREFIX:-}$gov" >/dev/null
echo "cycle ${I3X_CYCLE:-?}: killed $gov"
