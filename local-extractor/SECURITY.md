# Security Policy

## Supported Versions

This project is under active development. Use the latest commit on the default branch for security fixes.

## Reporting a Vulnerability

If you discover a security issue, do not open a public issue with exploit details.

Report privately to the maintainer with:
- affected file(s)
- reproduction steps
- impact summary
- suggested mitigation (if available)

A fix and coordinated disclosure timeline can then be agreed.

## Hardening Notes

- Run sidecar processes with least privilege.
- Prefer local IPC (STDIO) over exposing local HTTP ports.
- Keep dependencies updated (`npm audit`, regular version upgrades).
- Do not embed sensitive keys in desktop binaries.
