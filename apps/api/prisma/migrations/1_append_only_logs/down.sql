-- ============================================================================
-- DOWN: 1_append_only_logs
--
-- Gives back the UPDATE and DELETE the forward migration withheld, and strips
-- egomot_app's privileges in THIS database.
--
-- Running this makes audit_log and security_log editable again, which is the
-- whole guarantee Module 0.5 rests on. It belongs to a rollback of the
-- migration, never to routine maintenance.
--
-- The role itself is not dropped here. A role is a cluster object shared by
-- every database, so DROP ROLE fails while any other database still holds
-- grants for it — and dropping it from one database's rollback would break
-- the others. What this migration did *to this database* is the grants, and
-- that is what this script reverses. To retire the role entirely, roll this
-- migration back in every database that has it, then run once as a superuser:
--
--     REVOKE egomot_app FROM <application_user>;
--     DROP ROLE egomot_app;
-- ============================================================================

-- Restore the two verbs first, so the logs are consistently writable even if
-- the sweep below is interrupted.
GRANT UPDATE, DELETE ON audit_log    TO egomot_app;
GRANT UPDATE, DELETE ON security_log TO egomot_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM egomot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM egomot_app;

-- Clears every privilege the role holds in this database in one step, so no
-- object is left quietly granted.
DROP OWNED BY egomot_app;

DELETE FROM _prisma_migrations WHERE migration_name = '1_append_only_logs';
