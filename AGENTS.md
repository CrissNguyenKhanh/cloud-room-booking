# Repository working agreement

This repository contains backend code only. Keep the three services independently buildable and deployable.

- Never commit `.env` files or real credentials.
- Do not add cross-schema foreign keys or import runtime code from another service.
- Every schema change must be a versioned SQL migration owned by its service.
- Preserve `/api/v1` and `/internal/v1` contracts, the shared error envelope, and `X-Request-Id` propagation.
- Booking correctness relies on PostgreSQL transactions and constraints; do not replace those controls with an in-memory check.
- Run the affected service tests and syntax checks before committing.
- Do not add a frontend, broker, gateway, fixed container IP, or continuously running outbox worker in this phase.
