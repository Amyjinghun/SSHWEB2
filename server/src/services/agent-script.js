// SSHWeb 监控 Agent：单文件 POSIX sh 脚本 + curl/wget，零依赖常驻采集。
// 面板通过 SSH 把 agent.sh + agent.conf 写到目标机 /etc/sshweb-agent/ 并拉起 systemd/nohup。
// 脚本内所有字符串值都经 sanitize 去掉 URL 元字符，因此可安全用 application/x-www-form-urlencoded 上报。

const AGENT_VERSION = '1.0';

function buildAgentScript() {
  return `#!/bin/sh
# SSHWeb 监控 Agent v${AGENT_VERSION} — 采集 /proc 指标并推送到面板
# 由面板生成并部署，请勿手工修改；重新安装会覆盖本文件
CONF=/etc/sshweb-agent/agent.conf
STATE=/etc/sshweb-agent/.state

[ -f "$CONF" ] || { echo "sshweb-agent: missing $CONF"; exit 1; }
. "$CONF"
PANEL_URL=\${PANEL_URL:-}
TOKEN=\${TOKEN:-}
INTERVAL=\${INTERVAL:-5}
[ -n "$PANEL_URL" ] && [ -n "$TOKEN" ] || { echo "sshweb-agent: bad config"; exit 1; }

FAILS=0
STATIC_TS=0
VERSION='${AGENT_VERSION}'

# 字符串值去掉 URL 元字符与换行（OS_INFO/UPTIME 等纯展示字段，空格换下划线）
san() {
  printf '%s' "$1" | tr '&=%+\\r\\n' '_____' | cut -c 1-180
}

http_post() {
  # $1 = url, $2 = urlencoded body；输出响应体
  if command -v curl >/dev/null 2>&1; then
    curl -s --max-time 5 -H "X-Agent-Token: $TOKEN" -H 'content-type: application/x-www-form-urlencoded' -d "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 5 -O - --header "X-Agent-Token: $TOKEN" --header 'content-type: application/x-www-form-urlencoded' --post-data="$2" "$1"
  else
    echo '{"code":127,"message":"curl/wget not found"}'
    return 127
  fi
}

cpu_sample() {
  awk '/^cpu / { idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print total, idle; exit }' /proc/stat
}

net_sample() {
  awk -F'[: ]+' 'NR > 2 { iface=$2; if (iface == "lo") next; rx += $3; tx += $11 } END { print rx+0, tx+0 }' /proc/net/dev 2>/dev/null || printf '0 0'
}

load_state() { cat "$STATE" 2>/dev/null; }
save_state() { printf '%s %s %s %s %s\\n' "$1" "$2" "$3" "$4" "$5" > "$STATE" 2>/dev/null; }

LAST=$(load_state)   # "cpu_total cpu_idle rx tx ts"

while :; do
  NOW=$(date +%s)
  S=$(cpu_sample); T2=\${S%% *}; I2=\${S##* }
  N=$(net_sample); RX2=\${N%% *}; TX2=\${N##* }

  CPU=0; RXR=0; TXR=0
  case "$LAST" in
    *' '*)
      set -- $LAST
      T1=$1; I1=$2; RX1=$3; TX1=$4; T1TS=$5
      dt=$((NOW - T1TS))
      if [ "$dt" -gt 0 ] && [ "$dt" -lt 600 ]; then
        CPU=$(awk -v t1="$T1" -v t2="$T2" -v i1="$I1" -v i2="$I2" 'BEGIN { dt=t2-t1; di=i2-i1; if (dt<=0) printf "0.00"; else printf "%.2f", (1-di/dt)*100 }')
        RXR=$(awk -v r1="$RX1" -v r2="$RX2" -v d="$dt" 'BEGIN { if (r2>=r1) printf "%d", (r2-r1)/d; else printf "0" }')
        TXR=$(awk -v r1="$TX1" -v r2="$TX2" -v d="$dt" 'BEGIN { if (r2>=r1) printf "%d", (r2-r1)/d; else printf "0" }')
      fi
      ;;
  esac

  MEM=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{if(t<=0)t=1;u=t-a;printf "%d %d %.2f", t/1024, u/1024, u/t*100}' /proc/meminfo)
  set -- $MEM; MEM_T=$1; MEM_U=$2; MEM_P=$3

  DISK=$(df -Pm / 2>/dev/null | awk 'NR==2{gsub("%","",$5);printf "%d %d %.2f",$2,$3,$5}')
  set -- $DISK; DISK_T=$1; DISK_U=$2; DISK_P=$3
  [ -z "$DISK_T" ] && { DISK_T=0; DISK_U=0; DISK_P=0; }

  LOAD=$(awk '{printf "%s %s %s", $1, $2, $3}' /proc/loadavg 2>/dev/null)
  UPTIME=$(uptime -p 2>/dev/null || uptime 2>/dev/null || echo '-')
  OSINFO=$(awk -F= '/^PRETTY_NAME=/{gsub(/^"|"$/,"",$2);print $2;exit}' /etc/os-release 2>/dev/null)
  [ -z "$OSINFO" ] && OSINFO=$(uname -srm 2>/dev/null)
  SOCK=$(awk '/^TCP:/{t=$3}/^UDP:/{u=$3}END{printf "%d %d", t+0, u+0}' /proc/net/sockstat 2>/dev/null)
  set -- $SOCK; TCP_C=$1; UDP_C=$2
  [ -z "$TCP_C" ] && { TCP_C=0; UDP_C=0; }

  PAYLOAD="VERSION=$VERSION&CPU_USAGE=$CPU&MEM_TOTAL_MB=$MEM_T&MEM_USED_MB=$MEM_U&MEM_USAGE=$MEM_P&DISK_TOTAL_MB=$DISK_T&DISK_USED_MB=$DISK_U&DISK_USAGE=$DISK_P&NET_RX_BYTES=$RX2&NET_TX_BYTES=$TX2&NET_RX_RATE=$RXR&NET_TX_RATE=$TXR&LOAD_AVG=$(san "$LOAD")&UPTIME=$(san "$UPTIME")&OS_INFO=$(san "$OSINFO")&TCP_CONN=$TCP_C&UDP_CONN=$UDP_C"

  # 每 60s 附带一次静态信息（内核/架构/CPU），供面板 system_info 展示
  if [ $((NOW - STATIC_TS)) -ge 60 ]; then
    STATIC_TS=$NOW
    K=$(uname -r 2>/dev/null); A=$(uname -m 2>/dev/null)
    C=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 0)
    M=$(awk -F': ' '/^model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null | head -c 100)
    PAYLOAD="$PAYLOAD&STATIC=1&KERNEL=$(san "$K")&ARCH=$(san "$A")&CPU_CORES=$C&CPU_MODEL=$(san "$M")"
  fi

  RESP=$(http_post "$PANEL_URL/api/agent/report" "$PAYLOAD")
  if [ $? -eq 0 ] && printf '%s' "$RESP" | grep -q '"code":0'; then
    FAILS=0
    # 面板可动态下发采集间隔，持久化到配置文件，改设置无需重装
    NEW_IV=$(printf '%s' "$RESP" | sed -n 's/.*"interval":\\([0-9]\\{1,3\\}\\).*/\\1/p' | head -1)
    case "$NEW_IV" in
      ''|*[!0-9]*) ;;
      *) if [ "$NEW_IV" -ge 2 ] && [ "$NEW_IV" -le 60 ] && [ "$NEW_IV" != "$INTERVAL" ]; then
           INTERVAL=$NEW_IV
           sed -i "s/^INTERVAL=.*/INTERVAL=$INTERVAL/" "$CONF" 2>/dev/null
         fi ;;
    esac
  else
    FAILS=$((FAILS + 1))
  fi

  save_state "$T2" "$I2" "$RX2" "$TX2" "$NOW"

  # 上报失败指数退避：interval × 2^fails，封顶 60s
  BACKOFF=$INTERVAL
  i=0
  while [ "$i" -lt "$FAILS" ] && [ "$BACKOFF" -lt 60 ]; do BACKOFF=$((BACKOFF * 2)); i=$((i + 1)); done
  [ "$BACKOFF" -gt 60 ] && BACKOFF=60
  sleep "$BACKOFF"
done
`;
}

const UNIT_NAME = 'sshweb-agent';
const INSTALL_DIR = '/etc/sshweb-agent';

// 远端一键安装脚本：写 agent + 配置 + systemd unit（无 systemd 回落 nohup），返回 OK 便于断言
function buildInstaller(agentScript, { panelUrl, token, interval }) {
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  return `set -e
mkdir -p ${INSTALL_DIR}
cat > ${INSTALL_DIR}/agent.sh <<'__SSHWEB_AGENT_PAYLOAD__'
${agentScript}
__SSHWEB_AGENT_PAYLOAD__
chmod 700 ${INSTALL_DIR}/agent.sh
cat > ${INSTALL_DIR}/agent.conf <<__SSHWEB_AGENT_CONF__
PANEL_URL=${q(panelUrl)}
TOKEN=${q(token)}
INTERVAL=${q(interval)}
__SSHWEB_AGENT_CONF__
chmod 600 ${INSTALL_DIR}/agent.conf
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  [ -f ${INSTALL_DIR}/agent.pid ] && kill "$(cat ${INSTALL_DIR}/agent.pid)" 2>/dev/null || true
  cat > /etc/systemd/system/${UNIT_NAME}.service <<__SSHWEB_AGENT_UNIT__
[Unit]
Description=SSHWeb Monitor Agent
After=network-online.target
WantedBy=multi-user.target

[Service]
Type=simple
ExecStart=/bin/sh ${INSTALL_DIR}/agent.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
__SSHWEB_AGENT_UNIT__
  systemctl daemon-reload
  systemctl enable --now ${UNIT_NAME}.service
  echo "AGENT_OK mode=systemd"
else
  [ -f ${INSTALL_DIR}/agent.pid ] && kill "$(cat ${INSTALL_DIR}/agent.pid)" 2>/dev/null || true
  nohup /bin/sh ${INSTALL_DIR}/agent.sh >/dev/null 2>&1 &
  echo $! > ${INSTALL_DIR}/agent.pid
  echo "AGENT_OK mode=nohup"
fi
`;
}

function buildUninstaller() {
  return `
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop ${UNIT_NAME}.service 2>/dev/null || true
  systemctl disable ${UNIT_NAME}.service 2>/dev/null || true
  rm -f /etc/systemd/system/${UNIT_NAME}.service
  systemctl daemon-reload 2>/dev/null || true
fi
[ -f ${INSTALL_DIR}/agent.pid ] && kill "$(cat ${INSTALL_DIR}/agent.pid)" 2>/dev/null || true
rm -rf ${INSTALL_DIR}
echo "AGENT_REMOVED"
`;
}

// 手动安装命令（用户复制到自己终端执行；通过面板生成的临时安装 URL）
function buildManualCommand(installPath) {
  return `curl -fsSL '${installPath}' | sh`;
}

module.exports = { AGENT_VERSION, buildAgentScript, buildInstaller, buildUninstaller, UNIT_NAME, INSTALL_DIR };
