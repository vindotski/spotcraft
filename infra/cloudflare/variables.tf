variable "access_emails" {
  description = "Who may sign in through Cloudflare Access (one-time code by email): the dashboard, and apps marked as protected. Empty turns Access off."
  type        = list(string)
  default     = []
}

variable "access_session_duration" {
  description = "How long an Access sign-in lasts, e.g. 24h or 168h."
  type        = string
  default     = "24h"
}

variable "account_id" {
  description = "Cloudflare account id (the dashboard's URL and each zone's overview page show it)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "A 32-character hexadecimal account id."
  }
}

variable "apps_domain" {
  description = "Zone apex every app gets a subdomain of (<name>.<apps_domain>); the same value as APPS_DOMAIN. Its zone must already be in the account."
  type        = string
}

variable "block_ai_bots" {
  description = "Cloudflare's \"Block AI bots\" on every managed zone."
  type        = bool
  default     = false
}

variable "bot_fight_mode" {
  description = "Bot Fight Mode on every managed zone. It also challenges scripts such as uptime probes and the deploy's check, so it is off by default."
  type        = bool
  default     = false
}

variable "cloudflare_api_token" {
  description = "API token for this module (scopes in the README). Leave unset to use the CLOUDFLARE_API_TOKEN environment variable."
  type        = string
  default     = null
  sensitive   = true
}

variable "custom_hostnames" {
  description = "Cloudflare for SaaS on the apps zone, so domains outside this account can CNAME to an app. Enable Custom Hostnames on the zone first (README)."
  type        = bool
  default     = false
}

variable "dashboard_domain" {
  description = "The dashboard's host, e.g. dash.example.com; the same value as DASHBOARD_DOMAIN."
  type        = string
}

variable "dashboard_zone" {
  description = "Zone the dashboard's host is in. Defaults to apps_domain."
  type        = string
  default     = null
}

variable "extra_zones" {
  description = "Other zones in the account (e.g. apps' custom domains) that get the same TLS settings and bot switches."
  type        = list(string)
  default     = []
}

variable "login_rate_limit" {
  description = "Requests to /login per visitor and data center within 10 seconds before Cloudflare blocks them for 10 seconds (the free plan's fixed window). 0 turns the rule off."
  type        = number
  default     = 10
}

variable "route_dns" {
  description = "Point the apps wildcard, the fallback origin and the dashboard at the tunnel. Set false while moving an existing instance, until cloudflared runs on the server."
  type        = bool
  default     = true
}
