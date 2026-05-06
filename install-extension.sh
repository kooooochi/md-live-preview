#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

extension_name="$(node -p "require('./package.json').name")"
extension_version="$(node -p "require('./package.json').version")"
vsix_file="${extension_name}-${extension_version}.vsix"

npm run compile
npm run package

code --install-extension "$vsix_file" --force
