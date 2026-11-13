resource "hcloud_ssh_key" "deploy" {
  name       = "spotcraft-deploy"
  public_key = trimspace(var.deploy_ssh_public_key)
  labels     = local.labels
}

resource "hcloud_network" "main" {
  name     = "spotcraft"
  ip_range = "10.0.0.0/16"
  labels   = local.labels
}

resource "hcloud_network_subnet" "main" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.0.0/24"
}

# Public traffic: SSH, ping and, unless Cloudflare Tunnels deliver it (edge = "cloudflare"),
# HTTP and HTTPS (incl. HTTP/3). The private network is not filtered by Hetzner firewalls;
# ufw on each server covers that side.
resource "hcloud_firewall" "main" {
  name   = "spotcraft"
  labels = local.labels

  rule {
    description = "SSH"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.ssh_source_ips
  }

  dynamic "rule" {
    for_each = var.edge == "direct" ? local.web_rules : {}
    content {
      description = rule.key
      direction   = "in"
      protocol    = rule.value.protocol
      port        = rule.value.port
      source_ips  = ["0.0.0.0/0", "::/0"]
    }
  }

  rule {
    description = "Ping"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "main" {
  for_each = local.servers

  name               = "spotcraft-${each.key}"
  server_type        = each.value
  image              = "debian-13"
  location           = var.location
  ssh_keys           = [hcloud_ssh_key.deploy.id]
  firewall_ids       = [hcloud_firewall.main.id]
  delete_protection  = var.protect_servers
  rebuild_protection = var.protect_servers
  backups            = each.key == "apps" && var.apps_server_backups
  labels             = merge(local.labels, { role = each.key })

  user_data = templatefile("${path.module}/../cloud-init.yaml", {
    role           = each.key
    deploy_ssh_key = trimspace(var.deploy_ssh_public_key)
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  network {
    network_id = hcloud_network.main.id
    ip         = local.private_ips[each.key]
  }

  depends_on = [hcloud_network_subnet.main]

  lifecycle {
    # cloud-init only runs on first boot; editing it later must not replace a server.
    ignore_changes = [user_data, ssh_keys, image]
  }
}
