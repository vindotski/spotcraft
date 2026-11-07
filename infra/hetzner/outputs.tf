output "apps_server" {
  description = "Apps server addresses: public IPv4/IPv6 for DNS and SSH, private IP for the ops server."
  value = {
    ipv4       = hcloud_server.main["apps"].ipv4_address
    ipv6       = hcloud_server.main["apps"].ipv6_address
    private_ip = local.private_ips.apps
  }
}

output "ops_server" {
  description = "Ops server addresses: point the dashboard domain at the public IPv4/IPv6."
  value = {
    ipv4       = hcloud_server.main["ops"].ipv4_address
    ipv6       = hcloud_server.main["ops"].ipv6_address
    private_ip = local.private_ips.ops
  }
}

output "next_steps" {
  description = "What to do once both servers exist."
  value       = <<-EOT
    1. Wait ~3 minutes for first boot, then check:  ssh deploy@${hcloud_server.main["apps"].ipv4_address} cat /var/log/spotcraft-ready
    2. Pin the host keys:  ssh-keyscan -t ed25519 ${hcloud_server.main["apps"].ipv4_address} ${hcloud_server.main["ops"].ipv4_address}
    3. DNS: point the dashboard domain at ${hcloud_server.main["ops"].ipv4_address} (and ${hcloud_server.main["ops"].ipv6_address}).
  EOT
}
