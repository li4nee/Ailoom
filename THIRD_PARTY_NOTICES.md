// SPDX-License-Identifier: AGPL-3.0-only

# Third-party notices

Bundled third-party material that is not distributed as an npm dependency.

## `apps/api/src/modules/auth/domain/common-passwords.txt`

- Source: SecLists, file `Passwords/Common-Credentials/Pwdb_top-10000.txt`
  (the former `10-million-password-list-top-10000.txt`), repository
  <https://github.com/danielmiessler/SecLists>.
- License: MIT © Daniel Miessler. The full MIT license text is in `LICENSES/MIT.txt`.
- Used for: the common-password rejection list of the signup and password-change
  policies. Bundled verbatim (top 10,000 entries).

## `apps/admin/public/sounds/needs-human.mp3`

- Source: generated for this project with FFmpeg from a 660 Hz sine tone.
- License: CC0 1.0 (dedicated to the public domain).
- Used for: the optional desktop notification when a conversation needs a person.
