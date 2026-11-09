# ADR-007: Short-lived JWT for authentication, database-backed authorization

Date: 2026-11-09

Status: Accepted

## Context

The application needs authentication (who you are) and authorization (what you can do). JWTs are stateless but hard to revoke; database-backed checks are immediate but add a query per request.

## Decision

Use 15-minute access JWTs (identity only, no roles) + 30-day opaque refresh tokens stored hashed in `auth_sessions` with rotation and reuse detection. Membership and role are checked in Postgres on every request, in the same query that checks `users.token_version` for instant logout-everywhere.

## Consequences

- **Positive:** Immediate effect of role removals/demotions and instant logout-everywhere via `token_version`. No Redis dependency.
- **Negative:** Authorization requires a database query on every request. Caching is deferred until measured.
