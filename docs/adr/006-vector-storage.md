# ADR-006: Untyped `vector` column with per-dimension partial indexes

Date: 2026-11-09

Status: Accepted

## Context

The knowledge base needs vector similarity search over document chunks. Different embedding models produce different dimensions (384, 768, 1024, 1536, 3072). The index strategy must support efficient retrieval across dimensions.

## Decision

Use an untyped `vector` column with per-dimension partial HNSW indexes, `halfvec` casts above 2,000 dims, and iterative index scans.

## Consequences

- **Positive:** Partial indexes per dimension keep index scans small and fast. `halfvec` reduces memory for high-dimensional models.
- **Negative:** Index management is more complex (one index per dimension). Queries must specify the dimension to use the correct index.
