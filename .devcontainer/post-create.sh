#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Seeds Claude Code's state from the host, so a new container skips onboarding. The install method
# and machine ids describe the host, not this container, so they stay out.
if [ -s "$HOME/.claude.host.json" ] && [ ! -e "$HOME/.claude.json" ]; then
  (
    umask 077
    jq 'del(.installMethod, .machineID, .remoteControlMachineId)' \
      "$HOME/.claude.host.json" >"$HOME/.claude.json"
  )
fi

mkdir -p config
npm install -g npm@12.0.2
npm install
sudo npx --yes playwright install-deps chromium
npx --yes playwright install chromium
