# Two servers on one private network. Placeholder skeleton: no firewall rules,
# backups or outputs yet.

resource "hcloud_ssh_key" "deploy" {
  name       = "spotcraft"
  public_key = var.ssh_public_key
}

resource "hcloud_network" "private" {
  name     = "spotcraft"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "private" {
  network_id   = hcloud_network.private.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.0.0/24"
}

resource "hcloud_server" "apps" {
  name        = "spotcraft-apps"
  server_type = var.apps_server_type
  image       = "debian-13"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]
  user_data   = file("${path.module}/../apps-server/cloud-init.yaml")

  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.2"
  }

  depends_on = [hcloud_network_subnet.private]
}

resource "hcloud_server" "ops" {
  name        = "spotcraft-ops"
  server_type = var.ops_server_type
  image       = "debian-13"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]
  user_data   = file("${path.module}/../ops-server/cloud-init.yaml")

  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.3"
  }

  depends_on = [hcloud_network_subnet.private]
}
