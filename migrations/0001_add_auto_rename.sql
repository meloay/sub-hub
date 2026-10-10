ALTER TABLE subscriptions
ADD COLUMN auto_rename INTEGER NOT NULL DEFAULT 0
CHECK (auto_rename IN (0, 1));
