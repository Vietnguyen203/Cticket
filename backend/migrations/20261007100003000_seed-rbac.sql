-- Up Migration
-- Roles and permissions are reference data the application cannot run
-- without, so they ship as a migration (versioned, applied everywhere),
-- not as optional demo seed data.

INSERT INTO roles (code, name) VALUES
  ('CUSTOMER',  'Customer'),
  ('ORGANIZER', 'Organizer'),
  ('STAFF',     'Staff'),
  ('ADMIN',     'Administrator');

INSERT INTO permissions (code, name) VALUES
  -- customer
  ('event:read',            'Browse published events'),
  ('booking:create',        'Hold seats and create orders'),
  ('order:read:own',        'View own orders'),
  ('order:cancel:own',      'Cancel own eligible orders'),
  ('payment:create',        'Pay for own orders'),
  ('ticket:read:own',       'View own tickets'),
  ('review:create',         'Review attended events'),
  -- organizer
  ('event:create',          'Create events'),
  ('event:update:own',      'Edit own events'),
  ('schedule:manage:own',   'Manage schedules and ticket types of own events'),
  ('seat:block:own',        'Block/unblock seats of own schedules'),
  ('report:read:own',       'View sales of own events'),
  ('staff:assign:own',      'Assign staff to own events'),
  -- staff
  ('checkin:create',        'Check in tickets'),
  ('checkin:read',          'View check-in information'),
  -- admin
  ('event:approve',         'Approve or reject events'),
  ('event:manage:any',      'Manage any event'),
  ('user:manage',           'Manage users and roles'),
  ('organizer:manage',      'Approve and manage organizers'),
  ('venue:manage',          'Manage venues, zones and seats'),
  ('order:manage',          'Manage any order'),
  ('payment:manage',        'Manage payments'),
  ('refund:create',         'Issue refunds'),
  ('promotion:manage',      'Manage promotions'),
  ('report:read:any',       'View platform reports'),
  ('audit:read',            'Read audit logs'),
  ('category:manage',       'Manage categories');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('CUSTOMER',  'event:read'),
  ('CUSTOMER',  'booking:create'),
  ('CUSTOMER',  'order:read:own'),
  ('CUSTOMER',  'order:cancel:own'),
  ('CUSTOMER',  'payment:create'),
  ('CUSTOMER',  'ticket:read:own'),
  ('CUSTOMER',  'review:create'),
  ('ORGANIZER', 'event:read'),
  ('ORGANIZER', 'event:create'),
  ('ORGANIZER', 'event:update:own'),
  ('ORGANIZER', 'schedule:manage:own'),
  ('ORGANIZER', 'seat:block:own'),
  ('ORGANIZER', 'report:read:own'),
  ('ORGANIZER', 'staff:assign:own'),
  ('STAFF',     'event:read'),
  ('STAFF',     'checkin:create'),
  ('STAFF',     'checkin:read')
) AS m (role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

-- ADMIN gets every permission.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'ADMIN';

-- Down Migration

DELETE FROM role_permissions;
DELETE FROM permissions;
DELETE FROM roles;
