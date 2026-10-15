#!/usr/bin/env bash
# First-time set-up of a fresh Ubuntu 24.04 VPS (Phase 16). Run ONCE, as root:
#
#   scp deploy/scripts/bootstrap-server.sh root@<ip>:/root/
#   ssh root@<ip> bash /root/bootstrap-server.sh
#
# Needs your SSH public key in /root/.ssh/authorized_keys already (the
# provider's panel puts it there when you create the server with a key).
#
# What it does:
#   - system up to date, security updates installed automatically (unattended-upgrades)
#   - Docker Engine + Compose from Docker's repository, logs rotated (10 MB × 3)
#   - user `deploy` (your key, docker group, sudo without password: the docker
#     group can do anything as root anyway), /srv/etp for the app
#   - SSH: keys only, no root login; fail2ban bans password guessers
#   - firewall: only 22, 80, 443 in
#   - 2 GB of swap (building the images on a 2 GB server needs it)
#
# Before closing this root session, check in ANOTHER terminal that
# `ssh deploy@<ip>` works: root login is off afterwards.
set -euo pipefail

log() { printf '\n==> %s\n' "$*"; }
die() {
  echo "ERROR: $*" >&2
  exit 1
}

main() {
  [[ $EUID -eq 0 ]] || die "run as root"
  # shellcheck source=/dev/null
  source /etc/os-release
  [[ "$ID" == ubuntu ]] || die "written for Ubuntu (24.04); this is $PRETTY_NAME"
  [[ -s /root/.ssh/authorized_keys ]] || die "no SSH key in /root/.ssh/authorized_keys: add yours first, or you would lock yourself out"
  export DEBIAN_FRONTEND=noninteractive

  log "system packages"
  apt-get update -q
  apt-get upgrade -yq
  apt-get install -yq ca-certificates curl git ufw fail2ban unattended-upgrades
  echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' >/etc/apt/apt.conf.d/20auto-upgrades

  log "Docker"
  if ! command -v docker >/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' >/etc/docker/daemon.json
  systemctl restart docker

  log "user deploy"
  id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
  usermod -aG docker deploy
  echo 'deploy ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-deploy
  chmod 440 /etc/sudoers.d/90-deploy
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  [[ -s /home/deploy/.ssh/authorized_keys ]] ||
    install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  install -d -o deploy -g deploy /srv/etp

  log "SSH: keys only, no root login"
  cat >/etc/ssh/sshd_config.d/10-etp.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  sshd -t
  systemctl reload ssh
  systemctl enable --now fail2ban

  log "firewall: 22, 80, 443"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw --force enable

  log "swap"
  if ! swapon --show | grep -q .; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi

  log "done. In ANOTHER terminal: ssh deploy@<this server's ip> — then follow docs/deployment.md, section 4."
}

main "$@"
