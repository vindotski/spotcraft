locals {
  # 10.0.0.1 is Hetzner's gateway; the servers take the next two addresses.
  private_ips = {
    apps = "10.0.0.2"
    ops  = "10.0.0.3"
  }

  servers = {
    apps = var.apps_server_type
    ops  = var.ops_server_type
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
