# Security policy

Clibridge launches local coding CLIs and records execution evidence. Treat
issues involving command execution, project-boundary bypasses, approval gates,
secret redaction, authentication, or published packages as security-sensitive.

## Reporting a vulnerability

Do not open a public issue with exploit details, credentials, or proof payloads.
Use GitHub's private vulnerability-reporting flow for this repository:

<https://github.com/mateusoliveirab/clibridge/security/advisories/new>

If that flow is unavailable, contact the maintainer through the address listed
on their GitHub profile and include only the minimum information needed to
establish a private channel.

## Report contents

Include the affected version or commit, a minimal reproduction, impact, any
suggested mitigation, and whether disclosure must be coordinated. Do not send
access tokens, private prompts, or customer data.

## Supported versions

Security fixes are made on the current `main` branch and released in the next
available version. Older releases may receive a backport when impact and
maintainer capacity justify it.
