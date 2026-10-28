-- Up Migration
-- Phase 23: the "Tình trạng hệ thống" page and its alert emails.
-- See docs/phase-23-monitoring-design.md.

INSERT INTO permissions (code, name) VALUES ('system:monitor', 'See system health and receive its alerts');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'system:monitor' WHERE r.code = 'ADMIN';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'system:monitor');
DELETE FROM permissions WHERE code = 'system:monitor';
