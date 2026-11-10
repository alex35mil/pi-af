#!/bin/sh
# Fake `tailscale` CLI for tests (set as `[tailnet] cli`). `status --json` reports this "Mac" as node `self-node` of
# user 1 on 127.0.0.1, so the daemon listens on loopback; `whois --json <addr>` prints the file named by
# $PITON_FAKE_WHOIS, so a test decides who's connecting. While the file named by $PITON_FAKE_STOPPED exists, Tailscale
# reports itself stopped (as before it's up at login).
case "$1" in
status)
    if [ -n "$PITON_FAKE_STOPPED" ] && [ -e "$PITON_FAKE_STOPPED" ]; then
        echo '{"BackendState":"Stopped","Self":{"ID":"self-node","UserID":1}}'
    else
        echo '{"BackendState":"Running","Self":{"ID":"self-node","UserID":1,"TailscaleIPs":["127.0.0.1"]}}'
    fi
    ;;
whois)
    cat "$PITON_FAKE_WHOIS"
    ;;
*)
    echo "fake tailscale: unsupported command $1" >&2
    exit 1
    ;;
esac
