CREATE TABLE IF NOT EXISTS subscription_members (
  parent_subscription_id INTEGER NOT NULL,
  child_subscription_id INTEGER NOT NULL,
  member_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent_subscription_id, child_subscription_id),
  CHECK (parent_subscription_id <> child_subscription_id),
  FOREIGN KEY (parent_subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (child_subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscription_members_parent_order
  ON subscription_members(parent_subscription_id, member_order);

CREATE INDEX IF NOT EXISTS idx_subscription_members_child
  ON subscription_members(child_subscription_id);
