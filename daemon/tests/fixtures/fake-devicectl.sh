#!/bin/sh
# A paired-device file transfer fixture. Never talks to CoreDevice or the real phone.
set -eu
[ "$1 $2 $3 $4" = "devicectl device copy from" ] || exit 90
shift 4
device=
destination=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --device) device=$2; shift 2 ;;
        --domain-type) [ "$2" = appDataContainer ] || exit 91; shift 2 ;;
        --domain-identifier) [ "$2" = com.alex35mil.piton.ios ] || exit 92; shift 2 ;;
        --source) [ "$2" = Library/Logs/Piton ] || exit 93; shift 2 ;;
        --destination) destination=$2; shift 2 ;;
        --timeout) shift 2 ;;
        --quiet) shift ;;
        *) exit 94 ;;
    esac
done
[ -n "$destination" ] || exit 95
[ "$device" != fail ] || exit 7
mkdir -p "$destination"
printf 'fake phone event\n' > "$destination/current.log"
