output "tunnel_token" {
  description = "Token for cloudflared on the server: the CLOUDFLARE_TUNNEL_TOKEN secret."
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.main["apps"].token
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

output "dashboard_settings" {
  description = "Values the dashboard needs so a Cloudflare Access sign-in skips its password (ADR 0023); empty without Access."
  value = {
    CF_ACCESS_AUD = local.access ? cloudflare_zero_trust_access_application.dashboard[0].aud : ""
  }
}

output "next_steps" {
  description = "What to do after an apply."
  value       = <<-EOT
    1. tofu output -raw tunnel_token  → secret CLOUDFLARE_TUNNEL_TOKEN
    2. Copy agent_settings and dashboard_settings into variables of the same names on the
       production environment, plus CF_ACCESS_TEAM_DOMAIN (<team>.cloudflareaccess.com, from
       Zero Trust settings), and the agent's own token (README) into the secret
       CLOUDFLARE_API_TOKEN.
    3. Deploy with EDGE=cloudflare, then close ports 80 and 443 (infra/hetzner: edge = "cloudflare").
  EOT
}
