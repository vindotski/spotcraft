---

title: Hetzner ARM servers, deploy user only, one first-boot template
number: 10
status: accepted
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: []
notes: "Refines ADR 0004 for the Hetzner module."
---

# Hetzner ARM servers, deploy user only, one first-boot template

## Context

ADR 0004 makes a generic Debian/Ubuntu VPS the baseline and Hetzner an optional OpenTofu
module. This records what the module and the first boot actually set up.

## Decision

- Ampere ARM servers: `cax21` for apps (8 GB), `cax11` for ops (4 GB), Debian 13, in an
  `eu-central` location. All Spotcraft images are multi-arch (ADR 0009).
- One cloud-init template for both servers, with a `role` value; it's usable by hand on other
  providers.
- Logins: only the `deploy` user, by key. Root login and passwords are off. The deploy user is
  in the `docker` group, which is root-equivalent, so the key is guarded like a root key.
- Docker comes from Docker's signed apt repository rather than a piped install script.
- Two firewalls: Hetzner's cloud firewall allows only SSH, HTTP(S) and ping from outside; ufw
  on each server adds the same rules and allows the private network. Services that must not be
  public bind to the private IP, because Docker-published ports bypass ufw.
- Delete and rebuild protection on by default. `user_data`, `image` and `ssh_keys` changes are
  ignored after creation, so editing the template never replaces a running server.
- OpenTofu state stays local and git-ignored for the MVP.

## Consequences

- A lost state file means re-importing the servers; a remote state backend is post-MVP.
- SSH stays reachable from anywhere by default because GitHub Actions deploys over SSH;
  `ssh_source_ips` narrows it for setups that don't.
