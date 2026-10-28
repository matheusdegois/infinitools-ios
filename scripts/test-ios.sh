#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v xcodebuild >/dev/null; then
  echo "Este comando requer macOS com Xcode selecionado por xcode-select." >&2
  exit 1
fi
mkdir -p output
swift test --parallel
DEVICE_ID="${INFINITOOLS_SIMULATOR_ID:-$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(v["udid"] for k,vs in d["devices"].items() if "iOS" in k for v in vs if "iPhone" in v["name"]))')}"
xcodebuild -project Infinitools.xcodeproj -scheme Infinitools \
  -destination "platform=iOS Simulator,id=$DEVICE_ID" \
  -derivedDataPath output/DerivedData -resultBundlePath "output/Tests-$(date +%Y%m%d-%H%M%S).xcresult" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
xcodebuild -project Infinitools.xcodeproj -scheme Infinitools \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath output/Release CODE_SIGNING_ALLOWED=NO build
