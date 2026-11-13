locals {
  dashboard_zone = coalesce(var.dashboard_zone, var.apps_domain)

  # Every zone this module looks up; the settings below apply to all of them.
  zones = toset(concat([var.apps_domain, local.dashboard_zone], var.extra_zones))

  # TLS from visitors to Cloudflare, and from Cloudflare to any origin that isn't a tunnel.
  # Rocket Loader rewrites scripts and breaks SvelteKit's hydration.
  zone_settings = {
    ssl              = "strict"
    always_use_https = "on"
    min_tls_version  = "1.2"
    http3            = "on"
    rocket_loader    = "off"
  }

  zone_setting_pairs = {
    for pair in setproduct(local.zones, keys(local.zone_settings)) :
    "${pair[0]}/${pair[1]}" => { zone = pair[0], setting = pair[1] }
  }

  # Each server's cloudflared sends every request to its own Caddy, which routes by host.
  tunnels = {
    apps = "spotcraft-apps"
    ops  = "spotcraft-ops"
  }

  access = length(var.access_emails) > 0
}
