const AppError = require('../../src/utils/AppError');
const { mapDatabaseError, PG_ERROR } = require('../../src/database/errors');

const pgError = (code, constraint) => Object.assign(new Error('pg'), { code, constraint, severity: 'ERROR' });

describe('mapDatabaseError', () => {
  test.each([
    [PG_ERROR.UNIQUE_VIOLATION, 'DUPLICATE_RESOURCE', 409],
    [PG_ERROR.FOREIGN_KEY_VIOLATION, 'REFERENCED_RESOURCE_NOT_FOUND', 422],
    [PG_ERROR.CHECK_VIOLATION, 'CONSTRAINT_VIOLATION', 422],
    [PG_ERROR.LOCK_NOT_AVAILABLE, 'RESOURCE_LOCKED', 409],
    [PG_ERROR.DEADLOCK_DETECTED, 'CONCURRENCY_CONFLICT', 409],
  ])('SQLSTATE %s → %s (%i)', (sqlState, expectedCode, expectedStatus) => {
    const original = pgError(sqlState, 'some_constraint');
    const mapped = mapDatabaseError(original);

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe(expectedCode);
    expect(mapped.status).toBe(expectedStatus);
    expect(mapped.cause).toBe(original); // kept for logs, never sent to clients
  });

  test('returns null for unknown SQLSTATEs and non-database errors', () => {
    expect(mapDatabaseError(pgError('42P01'))).toBeNull(); // undefined_table → a bug, becomes 500
    expect(mapDatabaseError(new Error('plain'))).toBeNull();
    expect(mapDatabaseError(undefined)).toBeNull();
  });
});
