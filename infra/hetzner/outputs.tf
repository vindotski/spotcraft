output "server" {
  description = "The server's public IPv4 and IPv6: SERVER_HOST for the deploy, and SSH."
  value = {
    ipv4 = hcloud_server.main["apps"].ipv4_address
    ipv6 = hcloud_server.main["apps"].ipv6_address
  }
}

output "next_steps" {
  description = "What to do once the server exists."
  value       = <<-EOT
    1. Wait ~3 minutes for first boot, then check:  ssh deploy@${hcloud_server.main["apps"].ipv4_address} cat /var/log/spotcraft-ready
    2. Pin the host key:  ssh-keyscan -t ed25519 ${hcloud_server.main["apps"].ipv4_address}
    3. DNS: point the dashboard domain at ${hcloud_server.main["apps"].ipv4_address} (and ${hcloud_server.main["apps"].ipv6_address}),
       or let infra/cloudflare route it through the tunnel.
  EOT
}
