-- Portal accounts from controlled imports no longer require first login password rotation.
-- Existing credentials are retained; all portal accounts remain subject to secure login.
UPDATE portal_accounts SET must_change_password=0 WHERE must_change_password!=0;
-- Existing schema permits ALTER DEFAULT only by table rebuild; explicit 0 on all new writes
-- and resets avoids the old default while preserving all rows, IDs, foreign keys, sessions.
