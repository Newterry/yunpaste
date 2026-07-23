#!/bin/sh
set -eu

umask 077

check_writable_directory() {
  directory="$1"
  label="$2"
  if [ ! -d "$directory" ]; then
    echo "${label} 不存在：${directory}" >&2
    exit 70
  fi
  if [ ! -r "$directory" ] || [ ! -w "$directory" ] || [ ! -x "$directory" ]; then
    echo "${label} 必须允许容器用户 10001:10001 读写：${directory}" >&2
    echo "若使用宿主机绑定目录，请先执行 chown -R 10001:10001。" >&2
    exit 70
  fi
}

check_readable_file() {
  path="$1"
  label="$2"
  if [ -n "$path" ] && { [ ! -f "$path" ] || [ ! -r "$path" ]; }; then
    echo "${label} 指向的密钥文件不存在或容器用户不可读：${path}" >&2
    exit 70
  fi
}

check_writable_directory "${CONFIG_DIR:-/config}" "配置目录"
check_writable_directory "${FILES_DIR:-/files}" "文件目录"
check_readable_file "${ADMIN_PASSWORD_FILE:-}" "ADMIN_PASSWORD_FILE"
check_readable_file "${JWT_SECRET_FILE:-}" "JWT_SECRET_FILE"
check_readable_file "${DATABASE_KEY_FILE:-}" "DATABASE_KEY_FILE"
check_readable_file "${STORAGE_SECRET_FILE:-}" "STORAGE_SECRET_FILE"

exec "$@"
