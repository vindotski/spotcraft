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

  labels = {
    project    = "spotcraft"
    managed_by = "opentofu"
  }
}
