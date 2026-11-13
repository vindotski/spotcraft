output "apps_tunnel_token" {
  description = "Token for cloudflared on the apps server: the CLOUDFLARE_TUNNEL_TOKEN_APPS secret."
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.main["apps"].token
  sensitive   = true
}

output "ops_tunnel_token" {
  description = "Token for cloudflared on the ops server: the CLOUDFLARE_TUNNEL_TOKEN_OPS secret."
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.main["ops"].token
  sensitive   = true
}

output "agent_settings" {
  description = "Values the agent needs to manage custom domains and protected apps."
  value = {
    CLOUDFLARE_ACCOUNT_ID       = var.account_id
    CLOUDFLARE_APPS_ZONE_ID     = data.cloudflare_zone.main[var.apps_domain].id
    CLOUDFLARE_TUNNEL_ID        = cloudflare_zero_trust_tunnel_cloudflared.main["apps"].id
    CLOUDFLARE_ACCESS_POLICY_ID = local.access ? cloudflare_zero_trust_access_policy.owners[0].id : ""
  }
}

output "next_steps" {
  description = "What to do after an apply."
  value       = <<-EOT
    1. tofu output -raw apps_tunnel_token  → secret CLOUDFLARE_TUNNEL_TOKEN_APPS
       tofu output -raw ops_tunnel_token   → secret CLOUDFLARE_TUNNEL_TOKEN_OPS
    2. Copy agent_settings into variables of the same names on the production environment,
       and the agent's own token (README) into the secret CLOUDFLARE_API_TOKEN.
    3. Deploy with EDGE=cloudflare, then close ports 80 and 443 (infra/hetzner: edge = "cloudflare").
  EOT
}
