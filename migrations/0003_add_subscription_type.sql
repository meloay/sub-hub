ALTER TABLE subscriptions
  ADD COLUMN subscription_type TEXT NOT NULL DEFAULT 'standard'
  CHECK (subscription_type IN ('standard', 'combined'));

UPDATE subscriptions
SET subscription_type = 'combined'
WHERE id IN (
  SELECT DISTINCT parent_subscription_id
  FROM subscription_members
);
