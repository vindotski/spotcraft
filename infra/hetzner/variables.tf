variable "apps_server_type" {
  description = "Apps server size. cax21 (4 Ampere vCPU, 8 GB) fits about ten small-to-mid SSR apps."
  type        = string
  default     = "cax21"
}

variable "apps_server_backups" {
  description = "Hetzner's daily backups of the apps server (7 kept, +20% of its price). It holds the app list (/opt/spotcraft/apps)."
  type        = bool
  default     = false
}

variable "deploy_ssh_public_key" {
  description = "Public key of the deploy user on both servers (one line, e.g. \"ssh-ed25519 AAAA... spotcraft-deploy\")."
  type        = string

  validation {
    condition     = can(regex("^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+( .*)?$", trimspace(var.deploy_ssh_public_key)))
    error_message = "Must be one OpenSSH public key line."
  }
}

variable "hcloud_token" {
  description = "Hetzner Cloud API token with read and write access. Leave unset to use the HCLOUD_TOKEN environment variable."
  type        = string
  default     = null
  sensitive   = true
}

variable "location" {
  description = "Hetzner location for both servers. ARM (cax) servers are in fsn1, nbg1 and hel1."
  type        = string
  default     = "fsn1"

  validation {
    condition     = contains(["fsn1", "nbg1", "hel1"], var.location)
    error_message = "Use fsn1, nbg1 or hel1 (the locations with ARM servers, in network zone eu-central)."
  }
}

variable "ops_server_type" {
  description = "Ops server size (dashboard and monitoring). cax11 is 2 Ampere vCPU, 4 GB."
  type        = string
  default     = "cax11"
}

variable "protect_servers" {
  description = "Turn on Hetzner's delete and rebuild protection, so a stray destroy can't remove the servers."
  type        = bool
  default     = true
}

variable "ssh_source_ips" {
  description = "Addresses allowed to reach SSH. Defaults to anywhere (GitHub Actions deploys over SSH); logins are key-only."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
