# Governance

## Model

ailoom uses a BDFL-style maintainer model for now. The project has one maintainer, Nishant Pokharel ([@li4nee](https://github.com/li4nee)), who has final say on direction, scope, and releases. This will change when there are more maintainers.

## How decisions are made

- **Architecture:** architectural decisions are recorded as ADRs (MADR format) in `docs/adr/`. An ADR is proposed in a pull request and accepted by the maintainer. An accepted ADR is never edited, except for its status; a later ADR supersedes it instead.
- **Features:** a feature proposal starts as a GitHub Discussion. Accepted proposals become issues with the `accepted` label. The `good first issue` and `help wanted` labels are kept curated.
- **Code changes:** pull requests are squash-merged to `main` after CI passes and the maintainer approves. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Licensing:** contributions are made under the license of the path they touch, with a DCO sign-off. There is no CLA. See [LICENSING.md](LICENSING.md).

## Becoming a maintainer

Maintainers are invited based on sustained, high-quality contributions: merged pull requests across more than one area, thoughtful reviews of other people's work, and good judgment in design discussions. The maintainer extends the invitation. Maintainers get write access and review rights. Changing the license or this governance model stays with the copyright holder.

## Conduct

All participants follow the [Code of Conduct](CODE_OF_CONDUCT.md).
