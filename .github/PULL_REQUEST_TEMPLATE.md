# Pull Request Template

Thank you for contributing to AiLoom! Before submitting, please review the
[Definition of Done](#definition-of-done) checklist below.

## Description

Briefly describe what this PR changes and why.

## Definition of Done

- [ ] CI green (lint, types, tests, isolation suite, build, size, audit, licenses, REUSE, migration check)
- [ ] Tests added/updated at the right layer
- [ ] New routes covered by the isolation suite (automatic; fails if not)
- [ ] User-facing change → docs updated in `apps/docs`
- [ ] Config change → `.env.example` and config reference updated
- [ ] Architectural change → ADR added or updated
- [ ] No secrets, PII, or message content in logs
- [ ] Commits follow Conventional Commits and are DCO-signed (`git commit -s`)

## Checklist

- [ ] I have read the [contributing guidelines](CONTRIBUTING.md)
- [ ] I have signed off my commits (`git commit -s`)
- [ ] My commits follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] I have added or updated tests for my changes
- [ ] I have updated documentation where applicable

## Additional context

Add any other context or screenshots about the PR here.
