#!/bin/bash
# 安全修改 SSH 端口
# 核心原则：先重启并验证新端口真的在监听，成功之后才动防火墙；任何一步失败都回滚配置，绝不留下“防火墙改了但 sshd 没切过去”的锁死状态。

set -u

# 必须 root
if [ "$EUID" -ne 0 ]; then
  echo "请以 root 用户运行此脚本" >&2
  exit 1
fi

# 读取并校验端口
read -r -p "请输入新的 SSH 端口号 (1-65535，不能是 22): " new_port
if ! [[ "$new_port" =~ ^[0-9]+$ ]] || [ "$new_port" -le 0 ] || [ "$new_port" -gt 65535 ] || [ "$new_port" -eq 22 ]; then
  echo "无效的端口号" >&2
  exit 1
fi

sshd_config="/etc/ssh/sshd_config"
stamp=$(date +%Y%m%d%H%M%S)
backup="${sshd_config}.bak.${stamp}"
cp -a "$sshd_config" "$backup"
echo "[1/6] 已备份配置 -> $backup"

# 识别服务名：Debian/Ubuntu=ssh，RHEL/CentOS/Rocky/openEuler=sshd
svc=""
if systemctl cat ssh.service  >/dev/null 2>&1; then svc=ssh
elif systemctl cat sshd.service >/dev/null 2>&1; then svc=sshd
else
  echo "[错误] 未找到 ssh/sshd 服务单元，请手动处理" >&2
  exit 1
fi
echo "[2/6] SSH 服务名: $svc"

# 改 sshd_config 的 Port（已有显式 Port 行就替换，否则追加）
if grep -qiE '^[[:space:]]*Port[[:space:]]+[0-9]+' "$sshd_config"; then
  sed -i -E "s/^[[:space:]]*Port[[:space:]].*/Port ${new_port}/I" "$sshd_config"
else
  echo "Port ${new_port}" >> "$sshd_config"
fi
echo "[3/6] sshd_config 的 Port -> ${new_port}"

# 语法校验：不过就回滚，绝不 restart
if ! sshd -t 2>/tmp/sshd_t_err; then
  echo "[错误] sshd 配置语法校验失败，已回滚：" >&2
  cat /tmp/sshd_t_err >&2
  cp -a "$backup" "$sshd_config"
  exit 1
fi
echo "[4/6] sshd -t 配置校验通过"

# 重启 sshd（此时尚未动防火墙）
systemctl restart "$svc"

# 验证新端口真的在监听（这是“能不能连”的硬证据，比看服务状态靠谱）
sleep 1
if ! ss -tlnp 2>/dev/null "sport = :${new_port}" | grep -q "${new_port}"; then
  echo "[错误] sshd 未在 ${new_port} 监听，已回滚配置并重启服务" >&2
  if [ -d /etc/ssh/sshd_config.d ]; then
    echo "  可能是 drop-in 覆盖了 Port，检查：" >&2
    grep -rniE '^[[:space:]]*port' /etc/ssh/sshd_config.d/ 2>/dev/null >&2 || true
  fi
  if systemctl is-active ssh.socket sshd.socket 2>/dev/null | grep -q active; then
    echo "  可能启用了 ssh.socket（socket activation），监听端口由 socket 决定：" >&2
    echo "    systemctl cat ssh.socket sshd.socket 2>/dev/null" >&2
  fi
  cp -a "$backup" "$sshd_config"
  systemctl restart "$svc"
  exit 1
fi
echo "[5/6] sshd 已在 ${new_port} 监听"

# 只有 sshd 确认监听新端口后，才放行防火墙。默认保留 22 作双端口过渡，绝不主动删 22。
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${new_port}/tcp"
  echo "[6/6] ufw 已放行 ${new_port}/tcp（保留 22 作为过渡）"
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${new_port}/tcp"
  firewall-cmd --reload
  echo "[6/6] firewalld 已放行 ${new_port}/tcp（保留 22 作为过渡）"
  # SELinux enforcing 时，sshd 监听非标准端口需要打标签
  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
    if ! semanage port -l 2>/dev/null | grep -qE "ssh_port_t.*\b${new_port}\b"; then
      echo "  [提示] SELinux 为 Enforcing，需为新端口打标签，否则 sshd 起不来在该端口：" >&2
      echo "    semanage port -a -t ssh_port_t -p tcp ${new_port}" >&2
    fi
  fi
else
  echo "[6/6] 未检测到 ufw/firewalld，请手动放行 ${new_port}/tcp"
fi

cat <<EOF

===== 完成 =====
新端口: ${new_port}（服务: ${svc}）
【重要】请先另开一个终端验证新端口能连上，再关闭当前会话：
  ssh -p ${new_port} 用户名@本机IP
确认成功后，再手动删除旧端口 22 的防火墙规则：
  ufw delete allow 22/tcp
  firewall-cmd --permanent --remove-port=22/tcp && firewall-cmd --reload
确认无误后，再到 SSHWEB 面板把这台服务器的端口改成 ${new_port}。
EOF
