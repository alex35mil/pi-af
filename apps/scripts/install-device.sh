#!/usr/bin/env bash
# Builds Piton for iOS (Release) and installs and launches it on one device. Host only.
# Usage: scripts/install-device.sh <device> <variable>
#   device:   the device's name or identifier (xcrun devicectl list devices)
#   variable: the mise.local.toml variable it comes from, for the error when it's unset
# Run from apps/.
set -euo pipefail

device=$1
variable=$2

[ "${PITON_RUNTIME:-}" != sandbox ] || { echo "error: device installs are host-only" >&2; exit 1; }
[ -n "$device" ] || { echo "error: set $variable in mise.local.toml (xcrun devicectl list devices)" >&2; exit 1; }

# The device itself as the destination (not generic/platform=iOS): only then does Xcode register it with the team and
# put it in the provisioning profile.
xcodebuild -project Piton.xcodeproj -scheme 'Piton iOS' -configuration Release -destination "id=$device" \
  -derivedDataPath .build/xcode -allowProvisioningUpdates -allowProvisioningDeviceRegistration -quiet build
xcrun devicectl device install app --device "$device" ".build/xcode/Build/Products/Release-iphoneos/Piton.app"
xcrun devicectl device process launch --device "$device" com.alex35mil.piton.ios
