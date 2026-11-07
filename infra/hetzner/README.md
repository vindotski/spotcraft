# Hetzner (optional)

OpenTofu module that creates the apps server, the ops server and the private network
between them (10.0.0.2 and 10.0.0.3). Other providers: create two Debian/Ubuntu VPSes
yourself, apply the cloud-init files from `../apps-server` and `../ops-server`, and link
them privately (e.g. WireGuard).

| Variable           | Default | Meaning                             |
| ------------------ | ------- | ----------------------------------- |
| `hcloud_token`     | —       | Hetzner Cloud API token (sensitive) |
| `ssh_public_key`   | —       | key allowed on both servers         |
| `location`         | `fsn1`  | Hetzner location                    |
| `apps_server_type` | `cx33`  | apps server size (8 GB RAM)         |
| `ops_server_type`  | `cx23`  | ops server size (4 GB RAM)          |

```sh
tofu -chdir=infra/hetzner init
tofu -chdir=infra/hetzner plan
```

Current state: placeholder skeleton; no state backend, firewall or outputs yet.
