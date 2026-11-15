# ailoom

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue)](LICENSE)
[![Packages: MIT](https://img.shields.io/badge/packages-MIT-green)](LICENSING.md)
[![Docs: CC-BY-4.0](https://img.shields.io/badge/docs-CC--BY--4.0-lightgrey)](LICENSING.md)
[![Status: pre-1.0](https://img.shields.io/badge/status-pre--1.0-orange)](#status)

The easiest self-hosted AI support platform for developers to deploy, extend, and trust.

An AI agent answers customers first, grounded in your own knowledge. It knows when to escalate, and humans can step in, correct it, and improve it over time. Everything runs from one `docker compose up`, with your own model keys or fully local models.

## Status

**Pre-1.0 and not production-ready yet.** The project is under active development. APIs, configuration, and database schema can change between `0.x` releases, and breaking changes are listed under "Upgrade notes" in the [changelog](CHANGELOG.md). A quick start and demo come with the first release.

## Documentation

- [Product and technical specification](docs/spec.md)
- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Governance](GOVERNANCE.md)
- [Getting help](SUPPORT.md)
- [Licensing](LICENSING.md)
- [Docs site (self-hosting, configuration, providers, FAQ, licensing)](https://li4nee.github.io/ailoom/)

## Demo

A recorded demo of the widget and admin comes with the first release. Screenshots and the demo GIF live in `docs/assets/` and are added to the docs site at release time.

## License

ailoom is split by where the code runs:

- The server and admin app (`apps/api`, `apps/admin`) are **AGPL-3.0-only**.
- The widget and shared packages (`packages/*`) are **MIT**.
- Documentation content is **CC-BY-4.0**.

Embedding the widget in your own product never makes your product AGPL. See [LICENSING.md](LICENSING.md) for details.
