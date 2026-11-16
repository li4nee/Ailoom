---
title: Licensing
description: Which license applies to which part of AiLoom, and why
---

# Licensing

AiLoom is split by where the code runs. Different licenses apply to different parts so the server stays protected while the code that runs on your customers' sites stays permissive.

## The three licenses

| Part of the project        | License       | Where it lives                       |
| -------------------------- | ------------- | ------------------------------------ |
| Server and admin app       | AGPL-3.0-only | `apps/api`, `apps/admin`             |
| Widget and shared packages | MIT           | `packages/widget`, `packages/shared` |
| Documentation content      | CC-BY-4.0     | `apps/docs` content                  |

## Why this split?

**AGPL-3.0-only for the server and admin.** If you modify AiLoom's server or admin and offer the modified version to others over a network (for example, as a hosted service), the AGPL requires you to publish your changes. Self-hosting AiLoom for your own business — unmodified or modified — carries no obligation to publish anything.

**MIT for the widget and shared packages.** The widget runs inside your customers' websites and products. Under AGPL, legal teams often block embedding AGPL code into their own products. MIT removes that question: anyone can embed the widget or import the shared types without licensing concern.

**CC-BY-4.0 for documentation.** Standard for documentation; allows reuse with attribution.

## Embedding the widget in your product

Embedding the widget on your site never makes your product AGPL. The widget is MIT, and it talks to your self-hosted AiLoom instance over your own domain.

## "AGPL-3.0-only", not "or later"

The server and admin are licensed AGPL-3.0-**only** (not "or later"). This keeps the project in control of any future license-version change.

## Third-party notices

Dependencies' licenses are listed in `THIRD_PARTY_NOTICES.md`, generated at release. The built-in ONNX embedding model (`bge-small-en-v1.5`) is MIT and listed there.

## Related

- [LICENSE](https://github.com/li4nee/ailoom/blob/main/LICENSE) — AGPL-3.0 full text
- [LICENSING.md](/licensing) — plain-language guide to which license applies where
- [REUSE.toml](https://github.com/li4nee/ailoom/blob/main/REUSE.toml) — license annotations for files that can't carry SPDX headers
