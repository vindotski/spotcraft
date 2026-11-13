locals {
  # One server (ADR 0026). Keyed "apps", as when there were two, so the existing server keeps
  # its address in the state and is never replaced.
  servers = {
    apps = var.apps_server_type
  }

  # Caddy's public ports; closed when Cloudflare Tunnels deliver the traffic.
  web_rules = {
    HTTP     = { protocol = "tcp", port = "80" }
    HTTPS    = { protocol = "tcp", port = "443" }
    "HTTP/3" = { protocol = "udp", port = "443" }
  }

  labels = {
    project    = "spotcraft"
    managed_by = "opentofu"
  }
}
