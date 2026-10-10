-- 全新数据库使用本文件。不要在已有数据库上重复执行迁移。
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  sub_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  converter_backend TEXT NOT NULL DEFAULT 'sub.xeton.dev',
  auto_rename INTEGER NOT NULL DEFAULT 0 CHECK (auto_rename IN (0, 1)),
  subscription_type TEXT NOT NULL DEFAULT 'standard' CHECK (subscription_type IN ('standard', 'combined'))
);
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  original_link TEXT NOT NULL,
  node_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscription_members (
  parent_subscription_id INTEGER NOT NULL,
  child_subscription_id INTEGER NOT NULL,
  member_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent_subscription_id, child_subscription_id),
  CHECK (parent_subscription_id <> child_subscription_id),
  FOREIGN KEY (parent_subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (child_subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_path ON subscriptions(path);
CREATE INDEX IF NOT EXISTS idx_nodes_subscription_order ON nodes(subscription_id, node_order);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_subscription_members_parent_order ON subscription_members(parent_subscription_id, member_order);
CREATE INDEX IF NOT EXISTS idx_subscription_members_child ON subscription_members(child_subscription_id);
