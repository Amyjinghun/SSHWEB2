-- SSHWeb 数据库初始化脚本

CREATE DATABASE IF NOT EXISTS `sshweb` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `sshweb`;

-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'admin',
  `status` TINYINT NOT NULL DEFAULT 1,
  `token_version` INT NOT NULL DEFAULT 0,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 服务器分组表
CREATE TABLE IF NOT EXISTS `server_groups` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 服务器表
CREATE TABLE IF NOT EXISTS `servers` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `host` VARCHAR(255) NOT NULL,
  `port` INT NOT NULL DEFAULT 22,
  `username` VARCHAR(100) NOT NULL,
  `auth_type` ENUM('password','private_key','password_private_key') NOT NULL DEFAULT 'password',
  `password_encrypted` TEXT NULL,
  `private_key_encrypted` TEXT NULL,
  `private_key_passphrase_encrypted` TEXT NULL,
  `group_id` BIGINT NULL,
  `tags` JSON NULL,
  `status` ENUM('unknown','online','offline') NOT NULL DEFAULT 'unknown',
  `os_info` VARCHAR(255) NULL,
  `cpu_usage` DECIMAL(5,2) NULL,
  `memory_usage` DECIMAL(5,2) NULL,
  `disk_usage` DECIMAL(5,2) NULL,
  `last_connected_at` DATETIME NULL,
  `expires_at` DATE NULL COMMENT '服务器到期日期',
  `remark` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_group_id` (`group_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_expires_at` (`expires_at`),
  CONSTRAINT `fk_servers_group` FOREIGN KEY (`group_id`) REFERENCES `server_groups`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 命令模板表
CREATE TABLE IF NOT EXISTS `command_templates` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `category` VARCHAR(100) NULL,
  `command` TEXT NOT NULL,
  `description` TEXT NULL,
  `is_dangerous` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_command_template_name_category` (`name`, `category`)
) ENGINE=InnoDB;

-- 批量任务表
CREATE TABLE IF NOT EXISTS `batch_tasks` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `name` VARCHAR(150) NULL,
  `command` TEXT NOT NULL,
  `server_ids` JSON NOT NULL,
  `status` ENUM('pending','running','success','failed','partial_success','cancelled') NOT NULL DEFAULT 'pending',
  `total_count` INT NOT NULL DEFAULT 0,
  `success_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `started_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- 命令执行日志表
CREATE TABLE IF NOT EXISTS `command_logs` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `task_id` BIGINT NULL,
  `user_id` BIGINT NOT NULL,
  `server_id` BIGINT NOT NULL,
  `command` TEXT NOT NULL,
  `execute_type` ENUM('single','batch') NOT NULL DEFAULT 'single',
  `status` ENUM('running','success','failed','timeout','cancelled') NOT NULL DEFAULT 'running',
  `exit_code` INT NULL,
  `stdout` MEDIUMTEXT NULL,
  `stderr` MEDIUMTEXT NULL,
  `error_message` TEXT NULL,
  `duration_ms` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` DATETIME NULL,
  INDEX `idx_task_id` (`task_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_server_id` (`server_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- 服务器状态记录表
CREATE TABLE IF NOT EXISTS `server_metrics` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `server_id` BIGINT NOT NULL,
  `cpu_usage` DECIMAL(5,2) NULL,
  `memory_total` BIGINT NULL,
  `memory_used` BIGINT NULL,
  `memory_usage` DECIMAL(5,2) NULL,
  `disk_total` BIGINT NULL,
  `disk_used` BIGINT NULL,
  `disk_usage` DECIMAL(5,2) NULL,
  `load_avg` VARCHAR(100) NULL,
  `uptime` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_server_time` (`server_id`, `created_at`)
) ENGINE=InnoDB;

-- 文件操作日志表
CREATE TABLE IF NOT EXISTS `file_logs` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `server_id` BIGINT NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `path` TEXT NOT NULL,
  `status` ENUM('success','failed') NOT NULL,
  `message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_server_id` (`server_id`)
) ENGINE=InnoDB;

-- 计划任务表
CREATE TABLE IF NOT EXISTS `scheduled_tasks` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `target_type` ENUM('server','server_list','group') NOT NULL DEFAULT 'server',
  `server_id` BIGINT NULL,
  `server_ids` JSON NULL,
  `group_id` BIGINT NULL,
  `command` TEXT NOT NULL,
  `cron_expr` VARCHAR(100) NOT NULL,
  `enabled` TINYINT NOT NULL DEFAULT 1,
  `last_run_at` DATETIME NULL,
  `next_run_at` DATETIME NULL,
  `remark` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_server_id` (`server_id`),
  INDEX `idx_group_id` (`group_id`),
  INDEX `idx_enabled` (`enabled`)
) ENGINE=InnoDB;

-- 数据库备份配置表
CREATE TABLE IF NOT EXISTS `db_backup_configs` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `server_id` BIGINT NULL,
  `db_type` ENUM('mysql','mariadb') NOT NULL DEFAULT 'mysql',
  `db_host` VARCHAR(255) NOT NULL DEFAULT 'localhost',
  `db_port` INT NOT NULL DEFAULT 3306,
  `db_username` VARCHAR(100) NOT NULL,
  `db_password_encrypted` TEXT NULL,
  `db_name` VARCHAR(100) NOT NULL,
  `backup_dir` VARCHAR(500) NOT NULL,
  `retention_count` INT NOT NULL DEFAULT 7,
  `enabled` TINYINT NOT NULL DEFAULT 1,
  `remark` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_server_id` (`server_id`)
) ENGINE=InnoDB;

-- 备份文件表
CREATE TABLE IF NOT EXISTS `backup_files` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `config_id` BIGINT NULL,
  `server_id` BIGINT NULL,
  `backup_type` ENUM('database','config') NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `file_size` BIGINT NULL,
  `status` ENUM('success','failed') NOT NULL DEFAULT 'success',
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_config_id` (`config_id`),
  INDEX `idx_server_id` (`server_id`),
  INDEX `idx_backup_type` (`backup_type`)
) ENGINE=InnoDB;

-- 配置备份任务表
CREATE TABLE IF NOT EXISTS `config_backup_tasks` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `server_id` BIGINT NOT NULL,
  `paths` JSON NOT NULL,
  `backup_dir` VARCHAR(500) NOT NULL,
  `cron_expr` VARCHAR(100) NULL,
  `retention_count` INT NOT NULL DEFAULT 10,
  `enabled` TINYINT NOT NULL DEFAULT 1,
  `remark` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_server_id` (`server_id`)
) ENGINE=InnoDB;

-- 证书监控表
CREATE TABLE IF NOT EXISTS `certificates` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `domain` VARCHAR(255) NOT NULL,
  `port` INT NOT NULL DEFAULT 443,
  `issuer` VARCHAR(255) NULL,
  `valid_from` DATETIME NULL,
  `valid_to` DATETIME NULL,
  `days_left` INT NULL,
  `status` ENUM('unknown','valid','expiring','expired','error') NOT NULL DEFAULT 'unknown',
  `last_checked_at` DATETIME NULL,
  `remark` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_domain` (`domain`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- 告警规则表
CREATE TABLE IF NOT EXISTS `alert_rules` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `condition_json` JSON NOT NULL,
  `level` ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
  `notify_channels` JSON NULL,
  `enabled` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_type` (`type`),
  INDEX `idx_enabled` (`enabled`)
) ENGINE=InnoDB;

-- 告警记录表
CREATE TABLE IF NOT EXISTS `alert_logs` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `server_id` BIGINT NULL,
  `rule_id` BIGINT NULL,
  `level` ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
  `title` VARCHAR(255) NOT NULL,
  `content` TEXT NULL,
  `status` ENUM('active','recovered','ignored') NOT NULL DEFAULT 'active',
  `notify_result` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `recovered_at` DATETIME NULL,
  INDEX `idx_server_id` (`server_id`),
  INDEX `idx_rule_id` (`rule_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- 审计日志表
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `user_id` BIGINT NULL,
  `username` VARCHAR(64) NULL,
  `action` VARCHAR(100) NOT NULL,
  `target_type` VARCHAR(50) NULL,
  `target_id` BIGINT NULL,
  `server_id` BIGINT NULL,
  `ip` VARCHAR(64) NULL,
  `user_agent` TEXT NULL,
  `detail_json` JSON NULL,
  `status` ENUM('success','failed') NOT NULL DEFAULT 'success',
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_action` (`action`),
  INDEX `idx_server_id` (`server_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB;

-- 系统设置表
CREATE TABLE IF NOT EXISTS `settings` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` TEXT NULL,
  `description` TEXT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
