# ADR-009: Split licensing

Date: 2026-11-09

Status: Accepted

## Context

The project contains code that runs in different contexts: server-side (API, admin) and client-side (widget, shared types, SDKs) that runs inside other people's websites.

## Decision

Server and admin: **AGPL-3.0-only**. Widget, shared types, SDKs, and configs: **MIT**.

## Consequences

- **Positive:** AGPL ensures that modifications to the server offered over a network must be published. MIT removes legal friction for embedding the widget and SDKs in customer websites.
- **Negative:** AGPL code may import MIT packages, but MIT packages must never import AGPL code (enforced by lint + dependency-cruiser rule).
