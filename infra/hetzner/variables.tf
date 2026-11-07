variable "hcloud_token" {
  description = "Hetzner Cloud API token (GitHub secret HCLOUD_TOKEN in CI)."
  type        = string
  sensitive   = true
}

variable "location" {
  description = "Hetzner location for both servers."
  type        = string
  default     = "fsn1"
}

variable "apps_server_type" {
  description = "Apps server size; ~8 GB RAM fits about 10 small/mid SSR apps."
  type        = string
  default     = "cx33"
}

variable "ops_server_type" {
  description = "Ops server size (dashboard + monitoring)."
  type        = string
  default     = "cx23"
}

variable "ssh_public_key" {
  description = "Public key allowed to SSH into both servers."
  type        = string
}
