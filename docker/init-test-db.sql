-- Runs once when the Postgres volume is first created.
CREATE DATABASE listings_test;
\connect listings_test
CREATE EXTENSION IF NOT EXISTS postgis;
