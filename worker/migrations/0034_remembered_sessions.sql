-- Keep login active on personal mobile devices through bounded, sliding sessions.
-- Existing 30-day remembered sessions may be upgraded after a verified renewal.
-- Never extend short-lived nonremembered sessions.
ALTER TABLE sessions ADD COLUMN remember_device INTEGER NOT NULL DEFAULT 0 CHECK(remember_device IN (0,1));
ALTER TABLE portal_sessions ADD COLUMN remember_device INTEGER NOT NULL DEFAULT 0 CHECK(remember_device IN (0,1));
