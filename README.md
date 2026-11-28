# AiLoom

[![CI](https://github.com/li4nee/ailoom/actions/workflows/ci.yml/badge.svg)](https://github.com/li4nee/ailoom/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue)](LICENSE)
[![Packages: MIT](https://img.shields.io/badge/packages-MIT-green)](LICENSING.md)
[![Docs: CC-BY-4.0](https://img.shields.io/badge/docs-CC--BY--4.0-lightgrey)](LICENSING.md)
[![Status: public beta](https://img.shields.io/badge/status-public--beta-orange)](#status)

**Self-hosted AI customer support with a shared human inbox.** AiLoom answers from your support knowledge, shows its sources, and hands conversations to your team when a person is needed.

[Get started](https://li4nee.github.io/Ailoom/getting-started/) · [Browse the docs](https://li4nee.github.io/Ailoom/) · [Contribute](CONTRIBUTING.md)

## What AiLoom does

- **Grounded support:** index help pages, files, and text; test retrieval; inspect answer sources and traces.
- **A complete support flow:** embed a branded widget with citations, handoff, feedback, cards, carousels, quick replies, and bounded forms.
- **A team inbox:** route work with agent presence, capacity limits, and response or resolution targets.
- **Operational visibility:** review knowledge gaps, model use, cost, latency, prompt releases, and retrieval evaluations.
- **Self-hosted by design:** run on PostgreSQL with pgvector and connect a supported hosted or local model provider.

## See the product

Explore the widget, knowledge, handoff, and answer-review workflows. Each recording has an on-screen label for its current step.

### 1. Configure the widget and preview it as a customer

![Widget interactions: admin-authored cards, quick replies, and a bounded form, followed by the customer-facing widget](docs/assets/showcase-widget-interactions.gif)

### 2. Add knowledge and test retrieval

![Add a knowledge source, then test which passages match a customer question](docs/assets/showcase-knowledge.gif)

### 3. Hand off to an agent and reply in the same conversation

![Customer requests a person, confirms the handoff, shares optional contact details, and receives an agent reply in the same chat](docs/assets/showcase-handoff.gif)

### 4. Inspect the evidence behind an answer

Open a seeded answer trace to review the retrieved source, relevance, model usage, cost, and latency.

![Answer trace: inspect the source and runtime details behind an assistant response](docs/assets/showcase-answer-trace.gif)

### Admin and agent screens

Screenshots show the controls and inbox details at a glance. Labels are included inside each image.

| Widget fields and quick-reply result                                                                                                                                                  | Routing and agent availability                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [![Admin-configured bounded support form](docs/assets/screenshot-showcase-interaction-form.png)](docs/assets/screenshot-showcase-interaction-form.png)                                | [![Agent presence, least-loaded assignment, and open-conversation capacity](docs/assets/screenshot-showcase-operations.png)](docs/assets/screenshot-showcase-operations.png) |
| [![A customer selects a suggested delivery question and sends it to the assistant](docs/assets/screenshot-showcase-quick-reply.png)](docs/assets/screenshot-showcase-quick-reply.png) | [![Response and resolution targets for human handoffs](docs/assets/screenshot-showcase-sla.png)](docs/assets/screenshot-showcase-sla.png)                                    |
| Customer handoff in the team inbox                                                                                                                                                    | Agent reply in the shared conversation                                                                                                                                       |
| [![The visitor's handoff request appears in the agent inbox](docs/assets/screenshot-showcase-inbox.png)](docs/assets/screenshot-showcase-inbox.png)                                   | [![An agent replies in the shared conversation](docs/assets/screenshot-showcase-agent-reply.png)](docs/assets/screenshot-showcase-agent-reply.png)                           |
| Usage and cost                                                                                                                                                                        | Knowledge gaps                                                                                                                                                               |
| [![Support volume, feedback, tokens, and cost](docs/assets/screenshot-showcase-usage.png)](docs/assets/screenshot-showcase-usage.png)                                                 | [![Repeat unanswered questions to improve source coverage](docs/assets/screenshot-showcase-insights.png)](docs/assets/screenshot-showcase-insights.png)                      |

<details>
<summary>Watch the admin walkthroughs for routing and knowledge gaps</summary>

![Configure availability, automatic assignment, capacity, and service targets](docs/assets/showcase-agent-operations.gif)

![Review usage trends and find unanswered questions that need better coverage](docs/assets/showcase-insights.gif)

</details>

All recordings use synthetic Northwind Outfitters data in a local demo workspace. The answer trace is a seeded conversation with retrieved evidence and a deterministic mock provider. [View the separate sample Q&A clip (mock provider)](docs/assets/showcase-answer.gif). No shared public sandbox is available.

To run the seeded demo after starting the local development stack:

```bash
pnpm --filter @app/api fetch-model
pnpm --filter @app/api db:seed
```

Sign in at `http://localhost:5173` with `dev@example.com` / `devpassword`. The seed is for a local development database only; do not use it in production.

## How it works

![AiLoom deployment architecture: the widget and admin app connect through Caddy to the API, worker, and PostgreSQL; outbound provider requests are guarded](docs/assets/system-overview.svg)

The Docker Compose deployment uses Caddy, a NestJS API, a background worker, and PostgreSQL with pgvector. PostgreSQL also stores background jobs and powers live inbox updates, so a separate Redis or vector database is not required. See the [architecture guide](https://li4nee.github.io/Ailoom/architecture/) for the system and request-flow diagrams.

### Tools and MCP

Admins can configure fixed HTTPS GET lookups or select one reviewed, read-only tool on a remote MCP server. Each tool has bounded inputs, an output-field allowlist, timeouts, and a per-answer call limit. The model cannot choose a destination or perform write actions. AiLoom is an outbound MCP client; it does not expose an MCP server. If a tool is unavailable, the assistant can continue with other evidence or follow the configured fallback behavior.

See [Bot API tools](https://li4nee.github.io/Ailoom/tool-calling/) for configuration, limits, and data handling.

## Run locally

Requirements: Docker Compose, Node.js 24, and pnpm 12.

```bash
git clone https://github.com/li4nee/ailoom.git
cd ailoom
cp .env.example .env
pnpm install --frozen-lockfile
pnpm secrets:generate
```

Paste the generated secrets into `.env`. For local HTTP, set:

```dotenv
PUBLIC_URL=http://localhost:8080
HTTP_PORT=8080
POSTGRES_USER=ailoom
POSTGRES_PASSWORD=replace-with-a-long-url-safe-password
POSTGRES_DB=ailoom
```

Start the stack:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build --wait
```

Open `http://localhost:8080` and create an account. The first signup becomes the instance admin. Create a workspace, add a bot and model credential, index a knowledge source, then test a question in the bot playground. See [self-hosting](https://li4nee.github.io/Ailoom/self-hosting/) before exposing an instance to the internet.

## Develop locally

```bash
pnpm install
cp .env.example .env
pnpm secrets:generate
docker compose -f deploy/docker-compose.dev.yml up -d
pnpm db:migrate
pnpm dev
```

Set `PUBLIC_URL=http://localhost:3000` and `DATABASE_URL=postgres://app:app@localhost:55432/app` in `.env`. Start the worker in another terminal with `pnpm --filter @app/api dev:worker`. Fetch the local embedding model with `pnpm --filter @app/api fetch-model` before integration tests that use it. The dev stack includes Mailpit at `http://localhost:8025`.

| Command          | Purpose                        |
| ---------------- | ------------------------------ |
| `pnpm lint`      | Lint the workspace             |
| `pnpm typecheck` | Type-check the workspace       |
| `pnpm test`      | Run unit and integration tests |
| `pnpm build`     | Build packages and apps        |
| `pnpm e2e`       | Run browser end-to-end tests   |

See [Contributing](CONTRIBUTING.md) for development and review guidelines.

## Documentation

- **Install and operate:** [Getting started](https://li4nee.github.io/Ailoom/getting-started/), [self-hosting](https://li4nee.github.io/Ailoom/self-hosting/), [configuration](https://li4nee.github.io/Ailoom/configuration/), [backups](https://li4nee.github.io/Ailoom/backups/), and [upgrades](https://li4nee.github.io/Ailoom/upgrades/).
- **Build your support workflow:** [Widget](https://li4nee.github.io/Ailoom/widget/), [agent productivity](https://li4nee.github.io/Ailoom/agent-productivity/), [analytics](https://li4nee.github.io/Ailoom/analytics/), and [knowledge freshness](https://li4nee.github.io/Ailoom/knowledge-freshness/).
- **Review AI behavior:** [Evaluation suite](https://li4nee.github.io/Ailoom/eval-suite/), [answer verification](https://li4nee.github.io/Ailoom/answer-verification/), and [tool calling](https://li4nee.github.io/Ailoom/tool-calling/).
- **Understand trust and integrations:** [Data handling](https://li4nee.github.io/Ailoom/data-handling/), [security](https://li4nee.github.io/Ailoom/security/), [providers](https://li4nee.github.io/Ailoom/providers/), and [integrations](https://li4nee.github.io/Ailoom/integrations/).
- **Technical references:** [Architecture](docs/architecture.md), [system specification](docs/spec.md), and [ADRs](docs/adr/).

## Status

AiLoom is in public beta and remains on `0.x`; APIs, configuration, and database schema may change between releases. AiLoom is self-hosted, not a managed service. Operators manage their infrastructure, access controls, backups, and model-provider terms. Read the [upgrade notes](https://li4nee.github.io/Ailoom/upgrades/) before upgrading.

## License

The API and admin app are **AGPL-3.0-only**. The widget and shared packages are **MIT**. Documentation is **CC-BY-4.0**. See [LICENSING.md](LICENSING.md) for details.
