resource "hcloud_ssh_key" "deploy" {
  name       = "spotcraft-deploy"
  public_key = trimspace(var.deploy_ssh_public_key)
  labels     = local.labels
}

# Public traffic: SSH, ping and, unless a Cloudflare Tunnel delivers it (edge = "cloudflare"),
# HTTP and HTTPS (incl. HTTP/3).
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
    deploy_ssh_key = trimspace(var.deploy_ssh_public_key)
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  lifecycle {
    # cloud-init only runs on first boot; editing it later must not replace a server.
    ignore_changes = [user_data, ssh_keys, image]
  }
}
