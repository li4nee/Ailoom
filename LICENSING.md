# Licensing

ailoom uses three licenses, chosen by where the code runs.

| Path | License | Reason |
|---|---|---|
| `apps/api`, `apps/admin`, root default | **AGPL-3.0-only** | If someone modifies the server and offers it to others over a network, they must publish their changes. Self-hosting for your own business, unmodified or modified, carries no obligation to anyone. |
| `packages/widget`, `packages/shared`, `packages/*-config`, future `packages/sdk-*` | **MIT** | This code runs inside other people's websites and products. Under AGPL, legal teams would block adoption. MIT removes the question. |
| Docs content (`apps/docs/src/content`) | **CC-BY-4.0** | Standard for documentation; allows reuse with attribution. |

In plain words: embedding the widget or using the SDKs in your own product never makes your product AGPL; modifying and hosting the server for others means sharing your server changes.

## Rules

- AGPL code may import MIT packages. MIT packages must never import AGPL code. Lint and a dependency rule enforce this.
- Third-party dependencies must have licenses compatible with the package that uses them. MIT packages accept only permissive licenses (MIT, ISC, BSD, Apache-2.0, 0BSD). The AGPL apps additionally accept LGPL and MPL. CI fails on unknown licenses.
- The license is "AGPL-3.0-**only**", not "or later". This keeps the copyright holder in control of any future license-version change.
- Contributions are accepted under the license of the path they touch, with a DCO sign-off (`git commit -s`). There is no CLA.

## How the repository is marked

The repository follows the [REUSE](https://reuse.software) layout.

- `LICENSE` is the AGPL-3.0 text, so hosting platforms detect the default license.
- `LICENSES/` holds the full text of every license in use: `AGPL-3.0-only.txt`, `MIT.txt`, `CC-BY-4.0.txt`.
- Each MIT package carries its own `LICENSE` file and `"license": "MIT"` in its `package.json`.
- Source files start with an `SPDX-License-Identifier` line matching their package, enforced by lint.
- `REUSE.toml` assigns a license and copyright to files that cannot carry a header (JSON, lockfiles, configuration).
- `pipx run reuse lint` checks all of it and runs in CI.
