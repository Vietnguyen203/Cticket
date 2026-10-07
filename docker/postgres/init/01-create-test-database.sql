-- Runs once, on the first start of an empty data volume.
-- A separate database for automated tests, so `npm test` never touches dev data.
CREATE DATABASE etp_test;
