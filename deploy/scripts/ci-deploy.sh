#!/usr/bin/env bash
# The only command the GitHub Actions key may run on the server (Phase 16).
# Its line in ~deploy/.ssh/authorized_keys forces it:
#   command="bash /srv/etp/app/deploy/scripts/ci-deploy.sh",restrict ssh-ed25519 AAAA... github-actions
# so a leaked CI key can deploy a commit of the repository, nothing else.
# The workflow sends "deploy <full commit sha>" (SSH_ORIGINAL_COMMAND).
set -euo pipefail

main() {
  local request="${SSH_ORIGINAL_COMMAND:-}"
  if [[ ! "$request" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    echo "Refused: expected \"deploy <40-character commit sha>\"." >&2
    exit 2
  fi
  exec bash "$(dirname "${BASH_SOURCE[0]}")/deploy.sh" "${BASH_REMATCH[1]}"
}

main "$@"
exit
