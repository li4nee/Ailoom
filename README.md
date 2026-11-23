# AiLoom

[![CI](https://github.com/li4nee/ailoom/actions/workflows/ci.yml/badge.svg)](https://github.com/li4nee/ailoom/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue)](LICENSE)
[![Packages: MIT](https://img.shields.io/badge/packages-MIT-green)](LICENSING.md)
[![Docs: CC-BY-4.0](https://img.shields.io/badge/docs-CC--BY--4.0-lightgrey)](LICENSING.md)
[![Status: public beta](https://img.shields.io/badge/status-public--beta-orange)](#project-status)

**Self-hosted AI customer support, with people in the loop.**

AiLoom gives customers a chat widget that answers from your knowledge, hands off when it
needs a person, and gives your team one place to resolve conversations. Every answer can be
reviewed against its retrieved sources, model usage, cost, and latency. Run the whole stack
on your own infrastructure and choose your model provider.

[Get started](https://li4nee.github.io/ailoom/getting-started/) ·
[Read the docs](https://li4nee.github.io/ailoom/) ·
[Contribute](CONTRIBUTING.md)

## Who AiLoom is for

AiLoom is a fit for teams that want to own their support stack and knowledge data:

- A small SaaS support team answering product and troubleshooting questions from its docs.
- An online shop answering repeat questions about shipping, returns, and product policies.
- An internal IT or operations team routing questions from approved runbooks to a person when needed.

It works best for questions with stable answers in documents. Account-specific actions such as
changing an order or resetting a user's access still belong in your existing systems or with an
agent. You host AiLoom, choose the model provider, and configure the credentials, allowed widget
origins, email delivery, and backups for your deployment.

## Try the demo

There is no shared public sandbox at the moment. The GIFs below are short recordings of a local,
synthetic Northwind Outfitters workspace. To click through the product yourself, run the local
development setup below, fetch the local embedding model, and seed the demo workspace:

```bash
pnpm --filter @app/api fetch-model
pnpm --filter @app/api db:seed
```

Then sign in at the local admin app with `dev@example.com` / `devpassword`. The seed includes
sample knowledge, conversations, answer traces, and handoff examples; the chat provider is a
deterministic mock, and document embeddings run locally. These credentials and seeded data are
for a local development database only. Do not use the demo seed on a production instance.

For a first RAG exercise, add the included [sample return policy](docs/demo/sample-return-policy.md)
as a text source in **Knowledge → Add source**. Wait until its status is **Ready**, then use
**Test retrieval** with “How many days do I have to return an item?” The test should retrieve the
return window from that source. This sample is illustrative; replace it with your own approved
support content before serving customers.

## Product tour

These short screen tours were captured in a local browser using the seeded Northwind demo
workspace.

### Admin workspace

![Admin screen tour showing the workspace overview, bot setup, knowledge sources, conversation inbox, and usage reports](docs/assets/admin-tour.gif)

### Website widget

Add the generated script tag to your site, then customers can ask questions without leaving
the page. When the bot cannot find a reliable answer, it explains that and offers a human
instead of guessing.

![The website widget opens on a storefront, receives a return-policy question, and offers a human when it cannot answer](docs/assets/widget-tour.gif)

### Human handoff

When the bot cannot confidently help, or a visitor asks for a person, AiLoom moves the
conversation into the team's inbox. The agent takes over and replies in the same widget thread.

![End-to-end handoff: a visitor asks for a person, the conversation appears in the support inbox, an agent takes over and replies, and the reply appears in the website widget](docs/assets/handoff-tour.gif)

## What you can do

- **Build knowledge-grounded bots.** Add text, files, or crawled pages. Test retrieval and
  inspect the chunks and scores before you publish.
- **Let people take over.** Route conversations that need attention to a shared inbox. Agents
  can assign, prioritize, reply, add private notes, and use reviewed AI suggestions.
- **Understand each answer.** Open a trace to review the retrieved context, model request,
  token usage, cost, latency, and outcome.
- **Improve the knowledge base.** Usage, unanswered-question, and negative-feedback reports
  reveal where answers need attention.
- **Choose how AI runs.** Connect OpenAI, Anthropic, Gemini, Groq, Mistral, Ollama, or another
  OpenAI-compatible provider. AiLoom also includes a local embedding model.
- **Keep the stack small.** The Compose deployment uses Caddy, the API and background worker,
  and PostgreSQL with pgvector. It does not require a separate Redis or vector database.

## A support workflow, step by step

The screenshots and recordings use synthetic demo data. Each step shows what an operator or
visitor sees; the diagrams below explain what happens behind the interface.

### 1. Add and prepare a knowledge source

Open **Knowledge**, choose **Add source**, then paste text or upload a supported document. You
can also add a page or sitemap URL. Give the source a clear title, save it, and wait for the
status to become **Ready**. AiLoom extracts the text, splits it into searchable passages, and
creates local embeddings before the source can be retrieved.

![Label 1 — Knowledge sources: the Northwind help center source is Ready, with controls to test retrieval or add another source](docs/assets/screenshot-knowledge.png)

_Label 1. Knowledge sources. Add a help article, FAQ, policy, troubleshooting guide, or internal
runbook. Keep sensitive or restricted material out unless your deployment and access policy are
designed for it._

### 2. Check the source before publishing

Use **Test retrieval** with a question a customer would ask. Review the matching passages and
scores; if the right answer is missing, revise the source or retrieval settings. After a test
conversation, open its answer trace to see which passages were used, the model, usage, cost, and
latency. This makes it easier to spot stale or incomplete knowledge before customers rely on it.

![Label 2 — Answer trace: cited source, retrieved passages and scores, and model usage details](docs/assets/screenshot-replay.png)

_Label 2. Answer trace. The recorded trace makes the answer's source and retrieval result
inspectable._

### 3. Put the widget on your site

In the bot's **Install** tab, allow the website origin and copy the script snippet into the host
page. Ask the sample question in the widget; a supported answer includes source citations. When
the bot cannot find a reliable answer, it follows the configured fallback policy instead of
making one up.

![Label 3 — Website widget: a visitor asks about returns and the bot offers a human when it cannot support an answer](docs/assets/widget-tour.gif)

_Label 3. Widget fallback. This recording demonstrates the no-answer branch; use the seeded
question above to try a supported answer and its citation in the local demo._

### 4. Hand off to a person and reply in the same thread

A visitor can click **Talk to a human**, accept a handoff offer, or reach the bot's configured
automatic handoff policy. The conversation appears in the inbox as **Needs human**. An agent
takes over and replies; the update reaches the visitor in the same widget conversation.

![Label 4 — Human handoff: visitor request, inbox takeover, agent reply, and reply shown in the widget](docs/assets/handoff-tour.gif)

_Label 4. End-to-end handoff. The recording shows the visitor and agent sides of the same
conversation._

## How RAG works in AiLoom

Retrieval-augmented generation (RAG) lets the bot answer from your own support content. AiLoom
does not train or fine-tune the model on your documents. It finds relevant passages for each
question and includes those passages as context in that answer's model request.

### Prepare the knowledge base once

Add text, upload a file, or crawl a page or sitemap. The API saves the source and queues work
in **pg-boss**, which stores its jobs in PostgreSQL. The background worker extracts readable
text, normalizes it, skips unchanged content, splits it into structure-aware chunks, and
creates an embedding for each chunk. Chunking follows headings, paragraphs, and sentences;
chunks target about 400 tokens, with a 700-token maximum and 60-token overlap. AiLoom stores
the chunks, source references, and vectors in PostgreSQL with **pgvector**. Source status
updates appear in the admin app as ingestion finishes.

### Retrieve context for each question

The API embeds the visitor's question with the bot's configured embedding model and searches
only that bot's current knowledge, workspace, and embedding model. It retrieves up to eight
nearby chunks, then adds up to five chunks that meet the bot's relevance threshold to the
prompt, alongside the bot instructions and recent conversation history. The selected chat
model streams an answer to the widget with source citations. AiLoom stores a trace with the
retrieved sources, scores, model, token usage, cost, and latency so the team can inspect why
the bot answered as it did.

```mermaid
flowchart LR
  subgraph Ingestion[Knowledge ingestion]
    Source[Text, file, page, or sitemap] --> APIIn[API records source]
    APIIn --> Queue[pg-boss job in PostgreSQL]
    Queue --> Worker[Background worker]
    Worker --> Extract[Extract, normalize, hash, and chunk]
    Extract --> Embed[Create chunk embeddings]
    Embed --> Store[(PostgreSQL + pgvector)]
  end

  subgraph Answer[On each visitor question]
    Question[Visitor question] --> Guard[Authenticate, validate, check handoff intent]
    Guard -->|Intent match: offer a person, no retrieval or model call| IntentOffer[Handoff offer]
    Guard --> QueryEmbed[Embed the question]
    QueryEmbed --> Search[Search this bot's vectors]
    Store --> Search
    Search --> Score{Any chunks above threshold?}
    Score -->|No| Escalate[Fallback or handoff policy]
    Score -->|Yes| Select[Keep up to five relevant chunks]
    Select --> Prompt[Add chunks, instructions, and conversation context]
    Prompt --> Model[Configured chat model]
    Model --> AnswerOut[Stream answer and citations]
    AnswerOut --> Trace[Save sources, scores, usage, cost, and latency]
  end
```

The detailed [ingestion pipeline](docs/assets/ingestion-pipeline.svg) and
[chat pipeline](docs/assets/chat-pipeline.svg) show the implementation steps. Operators can
use **Test retrieval** to inspect matching chunks and scores before publishing a bot.

## How human handoff works

Handoff can start when a visitor clicks **Talk to a human**, accepts an offer, or the bot's
configured no-answer behavior automatically routes a conversation to an agent. A short,
multi-word request such as “talk to a human” only offers the choice; it never silently takes
the conversation away. If the visitor declines, AiLoom retries the same message through the
normal answer flow. For missing or weak knowledge, the bot can show a fallback, offer a
handoff, or hand off automatically. Provider errors and a reached spend cap show a handoff
offer.

Once the visitor confirms, AiLoom can collect an optional email, marks the conversation
**Needs human**, and stops bot replies in that thread. The team sees it in the shared inbox
and can receive an email and an opt-in browser notification. An agent takes over, replies in
the inbox, and the message appears in the visitor's widget in real time. The agent can later
hand the conversation back to AI or close it.

```mermaid
flowchart TD
  Visitor[Visitor in website widget] --> Signal{What needs attention?}
  Signal -->|Clicks Talk to a human| Handoff[Handoff accepted]
  Signal -->|Short handoff phrase| Offer[Offer Yes or No]
  Signal -->|No or weak knowledge| Policy[Bot fallback policy]
  Signal -->|Provider error or spend cap| Offer
  Policy -->|Show fallback| Fallback[Conversation stays with AI]
  Policy -->|Offer handoff| Offer
  Policy -->|Automatic handoff| Handoff
  Offer -->|No, keep chatting| Retry[Run the message through normal answering]
  Offer -->|Yes, connect me| Handoff
  Handoff --> Email[Optional visitor email]
  Email --> NeedsHuman[Status: Needs human]
  NeedsHuman --> Notify[Notify the support team]
  NeedsHuman --> Inbox[Shared inbox and live update]
  Inbox --> Takeover[Agent takes over]
  Takeover --> Reply[Agent reply]
  Reply --> Widget[Reply streams to the same widget thread]
  Takeover -->|Hand back| AI[Conversation returns to AI]
  Takeover -->|Close| Closed[Conversation closed]
```

## How the system is orchestrated

```mermaid
flowchart LR
  Visitor[Customer website and Preact widget] -->|HTTPS, messages, SSE| Caddy[Caddy reverse proxy and TLS]
  Agent[Admin app and inbox] -->|HTTPS, actions, SSE| Caddy
  Caddy -->|Static admin app| AdminSPA[React admin SPA]
  Caddy -->|API and widget routes| API[NestJS API on Fastify]
  AdminSPA --> API

  API -->|TypeORM queries and transactions| DB[(PostgreSQL 18)]
  DB --- Vector[pgvector knowledge search]
  DB --- Jobs[pg-boss durable job queue]
  Jobs --> Worker[Background worker]
  Worker -->|ingest, embed, email, cleanup| DB

  API --> AISDK[Vercel AI SDK]
  Worker --> AISDK
  AISDK --> SafeFetch[safeFetch outbound request guard]
  SafeFetch --> Models[Configured model and embedding providers]
  Worker -->|URL ingestion| SafeFetch
  Worker --> Mail[SMTP or Resend email]

  DB -->|LISTEN / NOTIFY after commit| API
  API -->|Server-sent events| Visitor
  API -->|Server-sent events| Agent
```

The tools each have a focused role:

- **Caddy** is the public HTTPS entry point and routes the admin app, API, and widget.
- **NestJS with Fastify** handles authentication, workspace boundaries, chat and handoff
  decisions, and API requests.
- **PostgreSQL 18** stores application data, conversation state, traces, and knowledge. Its
  **pgvector** extension stores and searches embeddings; **pg-boss** uses the same database
  for background jobs, so a separate Redis or vector database is not required.
- **The worker** handles slower work outside the visitor request: crawling and ingesting
  knowledge, embedding chunks, sending email, and scheduled cleanup.
- **The Vercel AI SDK** connects the API and worker to the selected chat and embedding
  providers. The built-in local embedding model and optional Ollama are also supported.
- **PostgreSQL LISTEN/NOTIFY and server-sent events (SSE)** keep open inboxes and widget
  conversations up to date without a separate message broker.
- **safeFetch** guards outbound requests to model providers and crawled websites.

The [architecture guide](docs/architecture.md) has the module map, request lifecycle,
database details, and security boundaries.

## Engineering highlights

- **Tenant-scoped RAG retrieval:** searches are constrained to the bot, workspace, and embedding
  model; traces retain retrieved sources and scores. See
  [retrieval.repository.ts](apps/api/src/modules/retrieval/retrieval.repository.ts) and
  [traces.repository.ts](apps/api/src/modules/traces/traces.repository.ts).
- **Durable knowledge ingestion:** pg-boss stores ingestion jobs in PostgreSQL, while the worker
  extracts, chunks, and embeds sources. See
  [knowledge.jobs.ts](apps/api/src/modules/knowledge/knowledge.jobs.ts).
- **Live agent handoff:** PostgreSQL notifications feed server-sent events for inbox and widget
  updates. See [handoff-notifier.listener.ts](apps/api/src/modules/conversations/handoff-notifier.listener.ts)
  and the [handoff end-to-end test](e2e/tests/handoff.spec.ts).
- **Guarded outbound requests:** provider and URL fetches go through outbound request checks.
  See [safe-fetch.ts](apps/api/src/common/safe-fetch/safe-fetch.ts).
- **Encrypted provider credentials:** stored secrets are protected with AES-GCM.
  See [secret-box.ts](apps/api/src/common/crypto/secret-box.ts).

## How CRM connections work

AiLoom's native CRM connectors currently send **identified contact updates** to the selected CRM.
They do not import CRM records, create tickets or cases, or send conversation transcripts.
Providers that use OAuth go through a server-side authorization-code redirect; an instance
operator registers the provider app and configures its client credentials. Tokens are encrypted
at rest and refreshed before expiry when the provider supplies a refresh token.

```mermaid
flowchart LR
  Admin[Workspace admin] -->|Start OAuth| CRMLogin[CRM consent screen]
  CRMLogin -->|Return code + one-use state| API[AiLoom API callback]
  API -->|Exchange code, store encrypted tokens| DB[(PostgreSQL)]
  Host[Host app verifies visitor] -->|AiloomChat.identify| WidgetAPI[Widget API]
  WidgetAPI -->|Contact + outbox in one transaction| DB
  DB -->|Leased outbox job| Worker[pg-boss worker]
  Worker --> Adapter[Workspace-scoped CRM adapter]
  Adapter -->|safeFetch| CRM[(CRM contact/person)]
  CRM -->|HTTP result + external ID| History[Delivery history and contact link]
```

#### Optional conversation context in HubSpot, Pipedrive, and Intercom

HubSpot, Pipedrive, and Intercom support syncing an AI-generated summary and conservative
classifications after a conversation is closed. This is **off by default**. To enable it, create
custom contact/person fields in your CRM, then enter their internal field keys in the integration
form before connecting. Map only the fields you want to receive; the mapped values are sent on a
contact update. HubSpot uses property internal names, Pipedrive uses custom field API keys, and
Intercom uses custom attribute names.

Available context fields are:

- **Summary:** a short account-relevant recap of the closed support conversation.
- **Conversation quality:** `good`, `mixed`, `poor`, or `unknown`, based on explicit customer
  feedback when available and clear resolution evidence otherwise.
- **Lead temperature:** `hot`, `mild`, `cold`, or `unknown`. This estimates purchase intent, not
  customer satisfaction. `Mild` means active evaluation without a near-term commitment. Support-only
  conversations are `unknown` unless purchase intent is clear.
- **Buyer type:** `consumer`, `small_business`, `mid_market`, `enterprise`, or `unknown`; the model
  uses `unknown` when the conversation does not provide strong evidence.
- **Evidence (optional):** a brief explanation for the classifications.

When an agent closes a conversation, AiLoom queues an enrichment job. It uses the bot's configured
chat model and credential, reads up to the latest 32 completed visitor, AI, and agent messages, and
stores the generation trace and usage. The normal bot spend cap applies. A context-only CRM update
then writes the mapped custom fields; it is not sent to customer webhooks. This is an AI estimate,
so treat it as a triage aid and review it before making consequential sales decisions. AiLoom does
not send the transcript itself to the CRM.

```mermaid
sequenceDiagram
  participant Agent
  participant API as AiLoom API
  participant Queue as PostgreSQL job queue
  participant Model as Configured chat model
  participant CRM as HubSpot / Pipedrive / Intercom
  Agent->>API: Close conversation
  API->>Queue: Enqueue only if CRM fields are mapped
  Queue->>API: Load recent completed messages
  API->>Model: Request summary and evidence-based labels
  Model-->>API: Context fields or unknown classifications
  API->>Queue: Record CRM-only contact update
  Queue->>CRM: Write mapped custom fields
```

Other CRM connectors continue to send their supported identity fields only. Handoff summaries
shown to agents inside AiLoom are separate from this CRM enrichment workflow.

The live CRM checks below verified contact identity delivery. Context enrichment has offline
payload coverage, but has not yet been verified against live custom fields in a CRM account.

**Test connection** checks provider access; it does not create a CRM record. Contact writes run
as background jobs and appear under **Recent CRM events**. For handoff and conversation events,
use signed outbound webhooks and translate them in your own CRM middleware.

### Live CRM verification

Three providers have completed live contact-delivery checks through AiLoom:

- **HubSpot:** a contact update passed through AiLoom's saved integration and background delivery
  worker using a private service token.
- **Pipedrive:** a manual API-token connection passed its health check. A synthetic contact was
  identified through the widget, written through AiLoom's outbox and worker, and confirmed in
  Pipedrive with an HTTP 200 delivery receipt and provider record ID. The test person was deleted
  and the temporary integration disconnected afterward.
- **Intercom:** a private workspace token passed its health check. A synthetic widget contact was
  delivered through the outbox and worker with an HTTP 200 receipt, read back from Intercom, then
  deleted; the temporary integration was disconnected.

These checks confirm the contact-delivery path for those credentials and test accounts. They do
not verify OAuth: OAuth redirects have not been tested against a live registered provider app.
The live checks used manual credentials; OAuth was not exercised. Other CRM connectors have
offline contract tests, but no live delivery evidence yet. See the
detailed [CRM setup, diagrams, and verification limits](docs/integrations/architecture.md),
[provider verification matrix](docs/integrations/crm-provider-matrix.md), and
[recorded test results](docs/integrations/crm-verification.md).

## Run AiLoom with Docker Compose

You need Docker Engine with Compose v2, Node.js 24, and pnpm 12. Node and pnpm install the
dependencies and generate instance secrets; Docker Compose runs the application.

```bash
git clone https://github.com/li4nee/ailoom.git
cd ailoom
cp .env.example .env
pnpm install --frozen-lockfile
pnpm secrets:generate
```

Paste the generated secret values into `.env`. For a local HTTP deployment, set these values
there as well:

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

Open [http://localhost:8080](http://localhost:8080) and create the first account. The first
signup becomes the instance administrator. Then create a workspace, add a bot and provider
credential, add a knowledge source, and test a question in the playground. Copy the snippet
from the bot's **Install** tab to add the widget to your site.

For production, configure a public HTTPS URL, email delivery, backups, and the desired signup
policy. Follow the full [self-hosting guide](https://li4nee.github.io/ailoom/self-hosting/)
and review [configuration](https://li4nee.github.io/ailoom/configuration/) before exposing
an instance to the internet.

## Develop locally

For local development, install dependencies and start the development database and mail
viewer:

```bash
pnpm install
cp .env.example .env
pnpm secrets:generate
docker compose -f deploy/docker-compose.dev.yml up -d
pnpm db:migrate
pnpm dev
```

In `.env`, set `PUBLIC_URL=http://localhost:3000` and
`DATABASE_URL=postgres://app:app@localhost:55432/app` for this development stack. Paste the
generated secrets into that file. The admin dev server uses port 5173 by default; `pnpm dev`
starts the API and admin app, and the worker runs separately as shown below.

The development database listens on port `55432`; Mailpit is included for viewing test
emails at [http://localhost:8025](http://localhost:8025). `pnpm dev` starts the API and admin
app. In a second terminal, start the background worker:

```bash
pnpm --filter @app/api dev:worker
```

Fetch the local embedding model before running integration tests that use it:

```bash
pnpm --filter @app/api fetch-model
```

Useful repository commands:

| Command          | Purpose                              |
| ---------------- | ------------------------------------ |
| `pnpm lint`      | Run lint checks across the workspace |
| `pnpm typecheck` | Type-check workspace packages        |
| `pnpm test`      | Run unit and integration test suites |
| `pnpm build`     | Build workspace packages and apps    |
| `pnpm e2e`       | Run browser end-to-end tests         |

See [Contributing](CONTRIBUTING.md) for commit sign-off, code review, and contribution
guidelines.

## Documentation

- [Getting started](https://li4nee.github.io/ailoom/getting-started/) and
  [self-hosting](https://li4nee.github.io/ailoom/self-hosting/)
- [Architecture](docs/architecture.md) and [technical specification](docs/spec.md)
- [Widget setup](https://li4nee.github.io/ailoom/widget/) and
  [model providers](https://li4nee.github.io/ailoom/providers/)
- [Integrations](https://li4nee.github.io/ailoom/integrations/),
  [backups](https://li4nee.github.io/ailoom/backups/), and
  [upgrades](https://li4nee.github.io/ailoom/upgrades/)
- [Data handling](https://li4nee.github.io/ailoom/data-handling/) explains what the self-hosted
  instance stores, sends to configured providers, and retains.
- [Security policy](SECURITY.md), [support](SUPPORT.md), and [governance](GOVERNANCE.md)

## Project status

AiLoom is in public beta and has not reached 1.0. APIs, configuration, and the database
schema may change between `0.x` releases. Read the [upgrade notes](https://li4nee.github.io/ailoom/upgrades/)
before upgrading. AiLoom is self-hosted, not a managed service: operators are responsible
for infrastructure, access control, backups, and their model providers' terms.

## License

Licensing depends on where the code runs:

- The API and admin app (`apps/api`, `apps/admin`) are **AGPL-3.0-only**.
- The widget and shared packages are **MIT**.
- Documentation is **CC-BY-4.0**.

Embedding the MIT-licensed widget in another product does not make that product AGPL. See
[LICENSING.md](LICENSING.md) for details.
