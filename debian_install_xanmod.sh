#!/usr/bin/env bash
#
# Interactive XanMod installer for Debian 11/12/13.
# Flow follows LinuxCapable's XanMod Debian guide through the DKMS tools step:
# https://linuxcapable.com/how-to-install-xanmod-kernel-on-debian-linux/
#
# Note: the current guide states that the official XanMod APT repository supports
# Debian 13 trixie and Debian 12 bookworm, while Debian 11 bullseye is no
# longer supported by that repository. This script warns before any Debian 11
# attempt.

set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
XANMOD_KEY_URL="https://dl.xanmod.org/archive.key"
XANMOD_CHECK_URL="https://dl.xanmod.org/check_x86-64_psabi.sh"
XANMOD_REPO_URL="https://deb.xanmod.org"
XANMOD_KEY_FALLBACK_URL="https://gitlab.com/afrd.gpg"
DOWNLOAD_USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
DOWNLOAD_CONNECT_TIMEOUT=8
DOWNLOAD_MAX_TIME=15
DOWNLOAD_RETRIES=0
KEYRING_DIR="/etc/apt/keyrings"
KEYRING_FILE="${KEYRING_DIR}/xanmod-archive-keyring.gpg"
SOURCE_FILE="/etc/apt/sources.list.d/xanmod-release.sources"
EXPECTED_FINGERPRINT="D38D 7D1D A134 9567 ADED  882D 86F7 D09E E734 E623"
XANMOD_REPO_SUITE=""

RED=""
GREEN=""
YELLOW=""
BLUE=""
BOLD=""
RESET=""

if [ -t 1 ]; then
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  BLUE="$(printf '\033[34m')"
  BOLD="$(printf '\033[1m')"
  RESET="$(printf '\033[0m')"
fi

log() {
  printf '%s[INFO]%s %s\n' "$BLUE" "$RESET" "$*"
}

ok() {
  printf '%s[ OK ]%s %s\n' "$GREEN" "$RESET" "$*"
}

warn() {
  printf '%s[WARN]%s %s\n' "$YELLOW" "$RESET" "$*" >&2
}

die() {
  printf '%s[FAIL]%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}

on_error() {
  local exit_code=$?
  local line_no=${1:-unknown}
  printf '%s[FAIL]%s Command failed near line %s with exit code %s.\n' "$RED" "$RESET" "$line_no" "$exit_code" >&2
  printf '%s[FAIL]%s Review the command output above. No automatic rollback was performed.\n' "$RED" "$RESET" >&2
  exit "$exit_code"
}

trap 'on_error "$LINENO"' ERR

run_cmd() {
  log "Running: $*"
  "$@"
  ok "Finished: $*"
}

prompt_yes_no() {
  local question=$1
  local default_answer=${2:-n}
  local prompt
  local answer

  case "$default_answer" in
    y|Y) prompt="[Y/n]" ;;
    n|N) prompt="[y/N]" ;;
    *) die "Invalid default for prompt_yes_no: ${default_answer}" ;;
  esac

  while true; do
    printf '%s %s ' "$question" "$prompt" > /dev/tty
    IFS= read -r answer < /dev/tty || die "Failed to read input"
    answer=${answer:-$default_answer}
    case "$answer" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) warn "Please answer y or n." ;;
    esac
  done
}

prompt_choice() {
  local question=$1
  shift
  local options=("$@")
  local selected
  local i

  printf '\n%s\n' "$question" > /dev/tty
  for i in "${!options[@]}"; do
    printf '  %s) %s\n' "$((i + 1))" "${options[$i]}" > /dev/tty
  done

  while true; do
    printf 'Select 1-%s: ' "${#options[@]}" > /dev/tty
    IFS= read -r selected < /dev/tty || die "Failed to read input"
    case "$selected" in
      ''|*[!0-9]*) warn "Please enter a number." ;;
      *)
        if [ "$selected" -ge 1 ] && [ "$selected" -le "${#options[@]}" ]; then
          printf '%s\n' "${options[$((selected - 1))]}"
          return 0
        fi
        warn "Selection out of range."
        ;;
    esac
  done
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

download_url() {
  local url=$1
  local output=$2
  shift 2
  local urls=("$url" "$@")
  local candidate

  for candidate in "${urls[@]}"; do
    if command -v curl >/dev/null 2>&1; then
      log "Downloading with curl: ${candidate}"
      if curl -fL --retry "$DOWNLOAD_RETRIES" --retry-delay 1 --retry-max-time "$DOWNLOAD_MAX_TIME" --connect-timeout "$DOWNLOAD_CONNECT_TIMEOUT" --max-time "$DOWNLOAD_MAX_TIME" -A "$DOWNLOAD_USER_AGENT" -o "$output" "$candidate"; then
        ok "Downloaded: ${candidate}"
        return 0
      fi
      warn "curl download failed; trying wget fallback."
    fi

    if command -v wget >/dev/null 2>&1; then
      log "Downloading with wget: ${candidate}"
      if wget --tries="$((DOWNLOAD_RETRIES + 1))" --waitretry=1 --dns-timeout="$DOWNLOAD_CONNECT_TIMEOUT" --connect-timeout="$DOWNLOAD_CONNECT_TIMEOUT" --read-timeout="$DOWNLOAD_MAX_TIME" --timeout="$DOWNLOAD_MAX_TIME" --user-agent="$DOWNLOAD_USER_AGENT" -O "$output" "$candidate"; then
        ok "Downloaded: ${candidate}"
        return 0
      fi
      warn "wget download failed."
    fi
  done

  warn "Failed to download ${url}. The remote server may be blocking this host or network."
  return 1
}

write_builtin_xanmod_gpg_key() {
  local output=$1

  cat > "$output" <<'EOF'
-----BEGIN PGP PUBLIC KEY BLOCK-----
Version: GnuPG v2

mQENBFhxW04BCAC61HuxBVf1XJiQjXu/DSAtVcnuK38geDoDjcqFtHskFy32NgJG
X118EFNym6noF+oibaSftI9yjHthWvMnYZ/+DPwd7YZhbAjBvxMIQCsP6cFVxrgc
VV8g+uh4TCfbpalDBFoncRhQCgkmDN9Vd4kIWRh6BHJuzpKB/h2KxUHZVEKgWlK2
dR1xUtbrc+kp8gLwPbxTgC3tZ4x2uMMMlnbyCMSRa5oJ/AvoW4W1XphKL9ivsFHM
PSQkUBDvgv2RPw+0XBxPy8SYE0r0onx0ZIpjJRTODt3bSV6/0owwlpNogV9bT8HY
kl3+w3mTwax6S1akHZuJtLkZS0uUBz1BHt5bABEBAAG0IVhhbk1vZCBLZXJuZWwg
PGtlcm5lbEB4YW5tb2Qub3JnPokBNwQTAQgAIQUCWHFbTgIbAwULCQgHAgYVCAkK
CwIEFgIDAQIeAQIXgAAKCRCG99Ce5zTmIwTmB/9/S4rmwU6efDgEaBDwBDbOfLBA
P2+kDpabjG4K+V4NSvDqlPN49KrI7C21jHghAa2VuTPbSZVQ9ziUd5DjX9OuXov8
CYVG+rrlG1UadHS8SBpgw0gNylEvo9/U6u0hl8mrbVOlpzu+eE+e4cMTHax2y580
fC2xmnM8wKgyRFEyVc6ilWU+UNTAeUFlg0YfU3cV1Ut4DzVFfamtNYg0p7Q/9MSy
VgFpt5C2U5prk4wi++51OgrtaNhMrUhzYXLINWVF6IrXhQ+mkI/FWXUZ0oyVo55v
+dQzuds/gos90q+tKyE514pYAmwQSftSjf+RmHOMpPQyMZZKSywrz4vlfveDuQEN
BFhxW04BCACs5bXq73MDb2+AsvNL2XkkbnzmE4K3k0gejB9OxrO+puAZn3wWyYIk
b0Op8qVUh+/FIiW/uFfmdFD8BypC3YkCNfg6e74f5TT3qQciccpMGy62teo3jfhT
T8E1OL1i76ALq7eNbByJKiKLBrTUDM6BDIeRZBWXQMase4+aqUAP47Kd/ByPsmCh
/pzb6yPdDPKwkspELssdPXYI7enddjQsCPoBko0j8CTPgKqMTeCuKMXCtD2gtRBN
eoVj4cbjZoZvBh8oJktzbYA8FX8eKdxIXhSP9MoVOPSWhxIQdwzkzUPK+0vUV8jA
NBTnGOkrRJPOHGPJWFWnTUGrzvcwi7czABEBAAGJAR8EGAEIAAkFAlhxW04CGwwA
CgkQhvfQnuc05iMIswgAmzSpCHFGKdkFLdC673FidJcL8adKFTO5Mpyholc5N8vG
ROJbpso+DpssF14NKoBfBWqPRgHxYzHakxHiNf0R2+EEwXH3rblzpx3PXzB0OgNe
T9T0UStrGgc9nZ8nZVURHZZ2z5zakEWS+rB2TiSxz3YArR3wiTHQW49G09uZvfp6
5Mim2w+eUxbQ689eT0DlDI1d2eDP/j5lrv1elsg3kBE2Awzdvi8DdGUpMFrSsYJw
WS85uZrwbeAs/nPO62wNIvAbbRsWnDg3AV3vc02eRvy52tTBY1W/67N02M4AxgPd
ukDDFZMifwa03yTHD/a57O4dFOnzsEVojBnbzQ7W7w==
=HKlF
-----END PGP PUBLIC KEY BLOCK-----
EOF
}

detect_cpu_level_local() {
  local ld_path
  local ld_help
  local flags

  for ld_path in /lib64/ld-linux-x86-64.so.2 /lib/x86_64-linux-gnu/ld-linux-x86-64.so.2; do
    if [ -x "$ld_path" ]; then
      ld_help="$("$ld_path" --help 2>/dev/null || true)"
      if printf '%s\n' "$ld_help" | grep -Eq 'x86-64-v4 .*supported'; then
        CPU_LEVEL="x86-64-v4"
        return 0
      fi
      if printf '%s\n' "$ld_help" | grep -Eq 'x86-64-v3 .*supported'; then
        CPU_LEVEL="x86-64-v3"
        return 0
      fi
      if printf '%s\n' "$ld_help" | grep -Eq 'x86-64-v2 .*supported'; then
        CPU_LEVEL="x86-64-v2"
        return 0
      fi
    fi
  done

  [ -r /proc/cpuinfo ] || return 1
  flags="$(grep -m1 '^flags[[:space:]]*:' /proc/cpuinfo || true)"
  [ -n "$flags" ] || return 1

  if cpu_flags_have_all "$flags" avx512f avx512bw avx512cd avx512dq avx512vl; then
    CPU_LEVEL="x86-64-v4"
  elif cpu_flags_have_all "$flags" avx avx2 bmi1 bmi2 f16c fma movbe xsave && cpu_flags_have_any "$flags" lzcnt abm; then
    CPU_LEVEL="x86-64-v3"
  elif cpu_flags_have_all "$flags" cx16 lahf_lm pni popcnt sse4_1 sse4_2 ssse3; then
    CPU_LEVEL="x86-64-v2"
  else
    CPU_LEVEL="x86-64-v1"
  fi
}

cpu_flags_have_all() {
  local flags=$1
  shift
  local flag
  for flag in "$@"; do
    printf '%s\n' "$flags" | grep -Eq "(^|[[:space:]])${flag}([[:space:]]|$)" || return 1
  done
}

cpu_flags_have_any() {
  local flags=$1
  shift
  local flag
  for flag in "$@"; do
    if printf '%s\n' "$flags" | grep -Eq "(^|[[:space:]])${flag}([[:space:]]|$)"; then
      return 0
    fi
  done
  return 1
}

detect_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
  else
    require_command sudo
    SUDO="sudo"
    log "sudo will be used for privileged commands."
    run_cmd sudo -v
  fi
}

self_encoding_check() {
  local file=$1
  local pattern
  pattern="$(printf '\303|\346|\345|\342\200\246')"
  if LC_ALL=C grep -nE "$pattern" "$file" >/tmp/xanmod_mojibake_check.$$ 2>/dev/null; then
    cat /tmp/xanmod_mojibake_check.$$ >&2 || true
    rm -f /tmp/xanmod_mojibake_check.$$
    die "Mojibake-like bytes found in ${file}; stop before continuing."
  fi
  rm -f /tmp/xanmod_mojibake_check.$$ 2>/dev/null || true
}

read_os_release() {
  [ -r /etc/os-release ] || die "/etc/os-release is missing or unreadable."
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID=${ID:-}
  OS_VERSION_ID=${VERSION_ID:-}
  OS_CODENAME=${VERSION_CODENAME:-}
}

check_system() {
  read_os_release
  local machine
  local deb_arch
  machine="$(uname -m)"
  deb_arch="$(dpkg --print-architecture 2>/dev/null || true)"

  printf '\n%sSystem summary%s\n' "$BOLD" "$RESET"
  printf '  OS:           %s %s (%s)\n' "${PRETTY_NAME:-unknown}" "$OS_VERSION_ID" "$OS_CODENAME"
  printf '  Kernel now:   %s\n' "$(uname -r)"
  printf '  uname -m:     %s\n' "$machine"
  printf '  dpkg arch:    %s\n' "$deb_arch"
  printf '  Repository:   %s\n\n' "$XANMOD_REPO_URL"

  [ "$OS_ID" = "debian" ] || die "This script is only for Debian."
  [ "$machine" = "x86_64" ] || die "XanMod APT packages in this workflow require x86_64."
  [ "$deb_arch" = "amd64" ] || die "XanMod APT packages in this workflow require Debian amd64."

  case "$OS_VERSION_ID:$OS_CODENAME" in
    13:trixie)
      ok "Debian 13 trixie detected. The current guide supports MAIN, LTS, and RT metapackages here."
      ;;
    12:bookworm)
      ok "Debian 12 bookworm detected. The current guide supports LTS metapackages here."
      ;;
    11:bullseye)
      warn "Debian 11 bullseye detected."
      warn "The current LinuxCapable guide says Debian 11 returns a missing Release file and is no longer supported by the XanMod APT repository."
      if ! prompt_yes_no "Force a Debian 11 attempt using the Debian 12 bookworm repository metadata?" n; then
        die "Stopped because Debian 11 is unsupported by the current XanMod repository metadata."
      fi
      XANMOD_REPO_SUITE="bookworm"
      warn "Forcing repository suite to bookworm for Debian 11."
      ;;
    *)
      die "This script is intentionally limited to Debian 13 trixie, Debian 12 bookworm, and Debian 11 bullseye."
      ;;
  esac
}

check_secure_boot() {
  if command -v mokutil >/dev/null 2>&1; then
    log "Checking Secure Boot state with mokutil."
    local sb_state
    sb_state="$(mokutil --sb-state 2>&1 || true)"
    printf '%s\n' "$sb_state"
    if printf '%s\n' "$sb_state" | grep -qi 'SecureBoot enabled'; then
      warn "Secure Boot appears to be enabled. The guide states XanMod is not signed for Secure Boot."
      if ! prompt_yes_no "Continue anyway?" n; then
        die "Stopped because Secure Boot is enabled."
      fi
    fi
  else
    warn "mokutil is not installed, so Secure Boot state cannot be checked."
  fi
}

apt_update_upgrade() {
  run_cmd $SUDO apt update
  if prompt_yes_no "Run apt upgrade before adding XanMod, as recommended by the guide?" y; then
    run_cmd $SUDO apt upgrade
  else
    warn "Skipping apt upgrade by user choice."
  fi
}

install_prerequisites() {
  run_cmd $SUDO apt install -y ca-certificates curl gpg wget
}

add_gpg_key() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  log "Temporary key workspace: ${tmp_dir}"

  run_cmd $SUDO install -m 0755 -d "$KEYRING_DIR"
  if ! download_url "$XANMOD_KEY_URL" "${tmp_dir}/xanmod-archive.key" "$XANMOD_KEY_FALLBACK_URL"; then
    warn "Both remote XanMod GPG key URLs failed: ${XANMOD_KEY_URL} and ${XANMOD_KEY_FALLBACK_URL}"
    if prompt_yes_no "Use the embedded XanMod GPG key instead?" n; then
      write_builtin_xanmod_gpg_key "${tmp_dir}/xanmod-archive.key"
      ok "Wrote embedded XanMod GPG key."
    else
      die "Failed to download XanMod GPG key."
    fi
  fi
  run_cmd gpg --dearmor --yes --output "${tmp_dir}/xanmod-archive-keyring.gpg" "${tmp_dir}/xanmod-archive.key"
  run_cmd $SUDO install -m 0644 "${tmp_dir}/xanmod-archive-keyring.gpg" "$KEYRING_FILE"

  log "Installed key fingerprint:"
  gpg --quiet --show-keys --with-fingerprint "$KEYRING_FILE"
  if gpg --quiet --show-keys --with-fingerprint "$KEYRING_FILE" | grep -Fq "$EXPECTED_FINGERPRINT"; then
    ok "Fingerprint matches expected XanMod key: ${EXPECTED_FINGERPRINT}"
  else
    warn "Expected fingerprint was not found automatically: ${EXPECTED_FINGERPRINT}"
    if ! prompt_yes_no "Continue with this key?" n; then
      die "Stopped because XanMod key fingerprint was not confirmed."
    fi
  fi

  rm -rf "$tmp_dir"
}

add_repository() {
  local tmp_source
  local repo_suite
  repo_suite="${XANMOD_REPO_SUITE:-$OS_CODENAME}"
  tmp_source="$(mktemp)"
  cat > "$tmp_source" <<EOF
Types: deb
URIs: ${XANMOD_REPO_URL}
Suites: ${repo_suite}
Components: main
Architectures: amd64
Signed-By: ${KEYRING_FILE}
EOF
  log "Repository source file to install:"
  cat "$tmp_source"
  if prompt_yes_no "Write ${SOURCE_FILE}?" y; then
    run_cmd $SUDO install -m 0644 "$tmp_source" "$SOURCE_FILE"
  else
    rm -f "$tmp_source"
    die "Repository write cancelled."
  fi
  rm -f "$tmp_source"
  ok "Current ${SOURCE_FILE}:"
  cat "$SOURCE_FILE"
}

refresh_xanmod_metadata() {
  run_cmd $SUDO apt update
}

detect_cpu_level_remote() {
  local tmp_dir
  local output
  local rc
  tmp_dir="$(mktemp -d)"

  if ! download_url "$XANMOD_CHECK_URL" "${tmp_dir}/check_x86-64_psabi.sh"; then
    rm -rf "$tmp_dir"
    return 1
  fi
  run_cmd chmod +x "${tmp_dir}/check_x86-64_psabi.sh"

  log "Running XanMod CPU level detector. A non-zero exit can be normal for this helper."
  trap - ERR
  set +e
  output="$("${tmp_dir}/check_x86-64_psabi.sh" 2>&1)"
  rc=$?
  set -e
  trap 'on_error "$LINENO"' ERR
  printf '%s\n' "$output"
  log "CPU detector exit status: ${rc}"

  CPU_LEVEL="$(printf '%s\n' "$output" | grep -Eo 'x86-64-v[1-4]' | tail -n 1 || true)"
  rm -rf "$tmp_dir"
  [ -n "$CPU_LEVEL" ]
}

detect_cpu_level() {
  log "Trying XanMod remote x86-64 psABI detector first."
  if ! detect_cpu_level_remote; then
    warn "Remote XanMod CPU detector failed or did not return a CPU level."
    if prompt_yes_no "Use local CPU level detection instead?" y; then
      log "Detecting x86-64 psABI level locally."
      detect_cpu_level_local || CPU_LEVEL=""
    else
      CPU_LEVEL=""
    fi
  fi

  if [ -z "$CPU_LEVEL" ]; then
    warn "Could not parse CPU level automatically."
    CPU_LEVEL="$(prompt_choice "Choose CPU level manually:" "x86-64-v1" "x86-64-v2" "x86-64-v3")"
  fi

  case "$CPU_LEVEL" in
    x86-64-v1) CPU_SUFFIX="x64v1" ;;
    x86-64-v2) CPU_SUFFIX="x64v2" ;;
    x86-64-v3|x86-64-v4) CPU_SUFFIX="x64v3" ;;
    *) die "Unsupported CPU level: ${CPU_LEVEL}" ;;
  esac

  ok "Selected CPU level: ${CPU_LEVEL}; package suffix: ${CPU_SUFFIX}"

  if prompt_yes_no "Override the detected package suffix?" n; then
    CPU_SUFFIX="$(prompt_choice "Choose package suffix:" "x64v1" "x64v2" "x64v3")"
    ok "Package suffix overridden to: ${CPU_SUFFIX}"
  fi
}

choose_xanmod_package() {
  local branch

  case "$OS_VERSION_ID" in
    13)
      if [ "$CPU_SUFFIX" = "x64v1" ]; then
        branch="LTS"
        warn "The current guide says x64v1 is available through the LTS branch only."
      else
        branch="$(prompt_choice "Choose XanMod branch:" "MAIN" "LTS" "RT")"
      fi
      ;;
    12)
      branch="LTS"
      log "Debian 12 currently uses the XanMod LTS metapackages in this guide."
      ;;
    11)
      branch="LTS"
      warn "Debian 11 is unsupported by current metadata; only an LTS attempt is offered."
      ;;
    *)
      die "Unexpected Debian version: ${OS_VERSION_ID}"
      ;;
  esac

  case "$branch:$CPU_SUFFIX" in
    MAIN:x64v1|RT:x64v1)
      die "The current guide only lists x64v1 metapackages for the LTS branch."
      ;;
    MAIN:*)
      PACKAGE_NAME="linux-xanmod-${CPU_SUFFIX}"
      ;;
    LTS:x64v1)
      PACKAGE_NAME="linux-xanmod-lts-x64v1"
      ;;
    LTS:*)
      PACKAGE_NAME="linux-xanmod-lts-${CPU_SUFFIX}"
      ;;
    RT:*)
      PACKAGE_NAME="linux-xanmod-rt-${CPU_SUFFIX}"
      ;;
    *)
      die "Unsupported branch/package combination: ${branch}/${CPU_SUFFIX}"
      ;;
  esac

  printf '\n%sBranch/package selection%s\n' "$BOLD" "$RESET"
  printf '  Branch:       %s\n' "$branch"
  printf '  Package:      %s\n' "$PACKAGE_NAME"

  if prompt_yes_no "Check apt-cache policy for ${PACKAGE_NAME}?" y; then
    apt-cache policy "$PACKAGE_NAME" || true
  fi

  if ! apt-cache policy "$PACKAGE_NAME" | awk '/Candidate:/ { exit ($2 == "(none)") ? 1 : 0 }'; then
    die "No install candidate found for ${PACKAGE_NAME}. Check Debian release support and apt update output."
  fi
}

install_xanmod_package() {
  if prompt_yes_no "Install ${PACKAGE_NAME} now?" y; then
    run_cmd $SUDO apt install -y "$PACKAGE_NAME"
  else
    die "Kernel package installation cancelled."
  fi
}

install_dkms_tools() {
  if prompt_yes_no "Install XanMod DKMS build tools (dkms libelf-dev clang lld llvm)?" y; then
    run_cmd $SUDO apt install -y --no-install-recommends dkms libelf-dev clang lld llvm
  else
    warn "Skipped DKMS build tools by user choice."
  fi
}

install_docker() {
  if prompt_yes_no "Install Docker using get.docker.com?" y; then
    run_cmd curl -fsSL https://get.docker.com -o get-docker.sh
    run_cmd $SUDO sh get-docker.sh
  else
    warn "Skipped Docker installation by user choice."
  fi
}

print_finish() {
  printf '\n%sCompleted through the Docker installation step.%s\n' "$GREEN" "$RESET"
  printf 'Installed/selected metapackage: %s\n' "$PACKAGE_NAME"
  printf 'Repository file: %s\n' "$SOURCE_FILE"
  printf 'Keyring file: %s\n' "$KEYRING_FILE"
  printf '\nNext guide step is rebooting into XanMod when you are ready:\n'
  printf '  sudo reboot\n'
}

main() {
  printf '%s%s%s\n' "$BOLD" "$SCRIPT_NAME" "$RESET"
  printf 'Interactive XanMod installer for Debian 11/12/13, stopping after DKMS tools.\n\n'

  self_encoding_check "$0"
  require_command uname
  require_command dpkg
  require_command apt
  require_command apt-cache
  detect_sudo
  check_system
  check_secure_boot

  if ! prompt_yes_no "Continue with XanMod repository setup and kernel installation?" y; then
    die "Cancelled by user."
  fi

  apt_update_upgrade
  install_prerequisites
  add_gpg_key
  add_repository
  refresh_xanmod_metadata
  detect_cpu_level
  choose_xanmod_package
  install_xanmod_package
  install_dkms_tools
  install_docker
  print_finish
}

main "$@"
