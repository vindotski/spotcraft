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

# The deploy hook (ADR 0029): an app's CI calls <dashboard>/hooks/deploy/<name> with no sign-in,
# so that path bypasses Access. A path's application is more specific than the dashboard's, so it wins
# there. The dashboard checks each request's hook token itself.
resource "cloudflare_zero_trust_access_policy" "deploy_hook" {
  count = local.access ? 1 : 0

  account_id = var.account_id
  name       = "spotcraft-deploy-hook"
  decision   = "bypass"
  include    = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "deploy_hook" {
  count = local.access ? 1 : 0

  account_id           = var.account_id
  name                 = "Spotcraft deploy hook"
  type                 = "self_hosted"
  domain               = "${var.dashboard_domain}/hooks/deploy"
  app_launcher_visible = false
  policies = [{
    id         = cloudflare_zero_trust_access_policy.deploy_hook[0].id
    precedence = 1
  }]
}

# --- Backups -----------------------------------------------------------------------------------
# The agent's nightly backups (ADR 0030) go to this bucket; R2 deletes them after
# backup_retention_days. The agent's access key is made by hand (README): an R2 token scoped to
# this bucket, with Object Read & Write.
resource "cloudflare_r2_bucket" "backups" {
  count = var.backup_bucket != "" ? 1 : 0

  account_id = var.account_id
  name       = var.backup_bucket
}

resource "cloudflare_r2_bucket_lifecycle" "backups" {
  count = var.backup_bucket != "" ? 1 : 0

  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.backups[0].name
  rules = [{
    id         = "expire-backups"
    enabled    = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = {
        type    = "Age"
        max_age = var.backup_retention_days * 86400
      }
    }
  }]
}

# Backups can't be deleted or overwritten for a day less than they're kept, not even with the
# agent's key: a compromised server or a leaked key can't wipe them, or swap in a crafted dump.
resource "cloudflare_r2_bucket_lock" "backups" {
  count = var.backup_bucket != "" ? 1 : 0

  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.backups[0].name
  rules = [{
    id      = "keep-backups"
    enabled = true
    condition = {
      type            = "Age"
      max_age_seconds = max(var.backup_retention_days - 1, 1) * 86400
    }
  }]
}
