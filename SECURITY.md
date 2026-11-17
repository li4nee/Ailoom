# Security policy

## Supported versions

AiLoom is a public beta and remains pre-1.0. Security fixes are released for the **latest minor
version** only. Please upgrade to the latest release before reporting, if you can.

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately in either way:

- GitHub private vulnerability reporting: use the "Report a vulnerability" button on the [Security tab](https://github.com/li4nee/ailoom/security/advisories/new).
- Email: nishantpokharel9@gmail.com

Please include what you found, how to reproduce it, the version or commit, and the impact you see.

## What to expect

- Acknowledgement within **3 business days**.
- An assessment and a plan for the fix, shared with you as the work progresses.
- A fix released as soon as it is ready. Security fixes do not wait for a milestone.
- Credit in the advisory and release notes, if you want it.

## Disclosure

We follow a **90-day** coordinated disclosure window. We aim to publish a fix and an advisory well within that time. If a fix is not ready after 90 days, you may disclose the issue publicly. Please contact us first if you need a different timeline.

## Scope

In scope: the code in this repository, including the API server, admin app, chat widget, shared packages, Docker images, and the default deployment configuration.

Out of scope: vulnerabilities in third-party services you connect to ailoom (model providers, email services), issues that need an already-compromised host or admin account, and reports from automated scanners without a demonstrated impact.
