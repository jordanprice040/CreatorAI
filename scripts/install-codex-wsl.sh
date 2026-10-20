#!/usr/bin/env bash
# Installs the pinned Linux Codex CLI for the Creator Agent Codex builder (ADR-0042).
# Run inside the WSL Ubuntu distribution as your normal user (not root):
#   bash scripts/install-codex-wsl.sh
# It downloads one official npm package, checks both published hashes, and keeps only the
# two static binaries the jail mounts. It changes nothing else: no PATH, no ~/.codex,
# no login. Remove it by deleting the printed folder.
set -euo pipefail

VERSION=0.163.0
URL="https://registry.npmjs.org/@openai/codex/-/codex-${VERSION}-linux-x64.tgz"
SHA256=30efc97738b975940d78b59a9bea115fa34040b732807d54ec35ae6b7528de94
SHA512_B64="uwRaOsrYogLQhcxAM/GoeWrw0QIWEMRo7c9gM8sKAviVkZQHlu9kRLJ5PkufbV+ABGjyZgIwiFdJ0LCJ0N6e8w=="
DEST="${HOME}/.local/share/creator-agent/codex/${VERSION}"

if [ "$(id -u)" = 0 ]; then echo "Run as your normal WSL user, not root." >&2; exit 1; fi
for tool in curl sha256sum sha512sum python3 tar bwrap; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$work/codex.tgz" "$URL"
echo "${SHA256}  $work/codex.tgz" | sha256sum --check --status || { echo "sha256 mismatch" >&2; exit 1; }
got512="$(sha512sum "$work/codex.tgz" | python3 -I -c 'import base64, sys; print(base64.b64encode(bytes.fromhex(sys.stdin.read().split()[0])).decode())')"
[ "$got512" = "$SHA512_B64" ] || { echo "sha512 (npm integrity) mismatch" >&2; exit 1; }
mkdir -p "$work/x"
tar -xzf "$work/codex.tgz" -C "$work/x" \
  package/vendor/x86_64-unknown-linux-musl/bin/codex \
  package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host
mkdir -p "$DEST"
install -m 0555 "$work/x/package/vendor/x86_64-unknown-linux-musl/bin/codex" "$DEST/codex"
install -m 0555 "$work/x/package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host" "$DEST/codex-code-mode-host"
"$DEST/codex" --version
sha256sum "$DEST/codex" "$DEST/codex-code-mode-host"
echo "Installed to $DEST"
echo "Studio setting: CREATOR_CODEX_DIR=$DEST"
