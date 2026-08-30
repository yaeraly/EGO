-- ============================================================================
-- Append-only logs (Module 0.5)
--
-- audit_log is append-only: a recorded event must not be editable away. The
-- guarantee is a database privilege, not an application convention — a service
-- with a bug, or raw SQL from a console, hits the same wall.
--
-- security_log is protected identically. It records authentication and PIN
-- outcomes, so the same argument applies: an attacker who can erase their own
-- LOGIN_FAIL trail defeats the point of keeping one.
--
-- The application connects as a member of egomot_app, which holds SELECT and
-- INSERT on both logs and no UPDATE or DELETE. Deployment grants the role:
--
--     GRANT egomot_app TO <application_user>;
--
-- The application user must NOT be a superuser — superusers bypass every
-- privilege check, which would make this migration decorative.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'egomot_app') THEN
    -- NOLOGIN: this role carries privileges, it is not logged into. A login
    -- user is created per deployment and granted membership.
    CREATE ROLE egomot_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO egomot_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO egomot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO egomot_app;

-- Withdraw the two verbs that would let history be rewritten.
REVOKE UPDATE, DELETE ON audit_log    FROM egomot_app;
REVOKE UPDATE, DELETE ON security_log FROM egomot_app;

-- PUBLIC is granted nothing on the logs implicitly, but say so explicitly so a
-- future role inherits nothing by accident.
REVOKE UPDATE, DELETE ON audit_log    FROM PUBLIC;
REVOKE UPDATE, DELETE ON security_log FROM PUBLIC;

-- Tables added by later migrations are writable by default; the logs above
-- keep their narrower grants because they already exist.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO egomot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO egomot_app;
