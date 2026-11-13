# Zones are looked up, never created or deleted here: records made by hand (mail, other sites)
# stay untouched, and a destroy can't take a domain offline.
data "cloudflare_zone" "main" {
  for_each = local.zones

  filter = {
    name    = each.key
    account = { id = var.account_id }
  }
}

resource "cloudflare_zone_setting" "main" {
  for_each = local.zone_setting_pairs

  zone_id    = data.cloudflare_zone.main[each.value.zone].id
  setting_id = each.value.setting
  value      = local.zone_settings[each.value.setting]
}

resource "cloudflare_bot_management" "main" {
  for_each = local.zones

  zone_id            = data.cloudflare_zone.main[each.key].id
  fight_mode         = var.bot_fight_mode
  ai_bots_protection = var.block_ai_bots ? "block" : "disabled"
}

# --- Tunnels ---------------------------------------------------------------------------------
# Remotely managed: the ingress lives here, and the server only needs the tunnel's token.
resource "cloudflare_zero_trust_tunnel_cloudflared" "main" {
  for_each = local.tunnels

  account_id = var.account_id
  name       = each.value
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "main" {
  for_each = local.tunnels

  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.main[each.key].id
  config = {
    ingress = [{ service = "http://caddy:80" }]
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "main" {
  for_each = local.tunnels

  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.main[each.key].id
}

# --- DNS -------------------------------------------------------------------------------------
# One wildcard serves every app's default host; the agent adds records for custom domains.
resource "cloudflare_dns_record" "apps_wildcard" {
  count = var.route_dns ? 1 : 0

  zone_id = data.cloudflare_zone.main[var.apps_domain].id
  name    = "*.${var.apps_domain}"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.main["apps"].id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "spotcraft: every app's default host"
}

resource "cloudflare_dns_record" "dashboard" {
  count = var.route_dns ? 1 : 0

  zone_id = data.cloudflare_zone.main[local.dashboard_zone].id
  name    = var.dashboard_domain
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.main["apps"].id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "spotcraft: dashboard"
}

# --- Custom hostnames (Cloudflare for SaaS) --------------------------------------------------
# Domains outside the account CNAME to <name>.<apps_domain>; Cloudflare sends them here.
resource "cloudflare_dns_record" "fallback" {
  count = var.route_dns && var.custom_hostnames ? 1 : 0

  zone_id = data.cloudflare_zone.main[var.apps_domain].id
  name    = "fallback.${var.apps_domain}"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.main["apps"].id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "spotcraft: fallback origin for custom hostnames"
}

resource "cloudflare_custom_hostname_fallback_origin" "main" {
  count = var.route_dns && var.custom_hostnames ? 1 : 0

  zone_id = data.cloudflare_zone.main[var.apps_domain].id
  origin  = cloudflare_dns_record.fallback[0].name
}

# --- Rate limit on the dashboard's login ----------------------------------------------------
# The free plan allows one rule, matched on the path only, with a fixed 10-second window. It
# applies to /login on every host in the dashboard's zone; the dashboard's own lockout stays.
resource "cloudflare_ruleset" "login_rate_limit" {
  count = var.login_rate_limit > 0 ? 1 : 0

  zone_id = data.cloudflare_zone.main[local.dashboard_zone].id
  name    = "spotcraft"
  kind    = "zone"
  phase   = "http_ratelimit"
  rules = [{
    ref         = "spotcraft_login"
    description = "Slow down password guessing on /login"
    expression  = "(http.request.uri.path eq \"/login\")"
    action      = "block"
    ratelimit = {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = var.login_rate_limit
      mitigation_timeout  = 10
    }
  }]
}

# --- Access ----------------------------------------------------------------------------------
# One reusable policy: the owners, by one-time code sent to their email. The agent attaches it
# to apps marked as protected.
resource "cloudflare_zero_trust_access_policy" "owners" {
  count = local.access ? 1 : 0

  account_id       = var.account_id
  name             = "spotcraft-owners"
  decision         = "allow"
  session_duration = var.access_session_duration
  include          = [for email in var.access_emails : { email = { email = email } }]
}

resource "cloudflare_zero_trust_access_application" "dashboard" {
  count = local.access ? 1 : 0

  account_id                = var.account_id
  name                      = "Spotcraft dashboard"
  type                      = "self_hosted"
  domain                    = var.dashboard_domain
  session_duration          = var.access_session_duration
  app_launcher_visible      = false
  auto_redirect_to_identity = true
  policies = [{
    id         = cloudflare_zero_trust_access_policy.owners[0].id
    precedence = 1
  }]
}
