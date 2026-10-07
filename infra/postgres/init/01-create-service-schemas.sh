#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=identity_user="$IDENTITY_DB_USER" --set=identity_password="$IDENTITY_DB_PASSWORD" \
  --set=booking_user="$BOOKING_DB_USER" --set=booking_password="$BOOKING_DB_PASSWORD" \
  --set=notification_user="$NOTIFICATION_DB_USER" --set=notification_password="$NOTIFICATION_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'identity_user', :'identity_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'identity_user') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'booking_user', :'booking_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'booking_user') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'notification_user', :'notification_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'notification_user') \gexec

SELECT format('CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION %I', :'identity_user') \gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS booking AUTHORIZATION %I', :'booking_user') \gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS notification AUTHORIZATION %I', :'notification_user') \gexec

SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'identity_user') \gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'booking_user') \gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'notification_user') \gexec
SQL