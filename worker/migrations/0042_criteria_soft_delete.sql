-- School criteria delete/archive without destroying FK-linked student score histories.
-- Keep original IDs and historical scores immutable; archived criteria are hidden
-- from management, Excel exports, and new scoring selections.
ALTER TABLE affairs_behavior_rules ADD COLUMN deleted_at TEXT;
ALTER TABLE affairs_adjustment_rules ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_affairs_behavior_rules_visible ON affairs_behavior_rules(deleted_at,category,active);
CREATE INDEX IF NOT EXISTS idx_affairs_adjustment_rules_visible ON affairs_adjustment_rules(deleted_at,active);
