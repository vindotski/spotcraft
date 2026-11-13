// Spotcraft has one version for everything (ADR 0019); the dashboard's package carries it.
// A named import keeps the rest of package.json out of the bundle.
import { version } from '../../package.json'

export const VERSION: string = version
/** The release notes of the running version. */
export const RELEASE_URL = `https://github.com/vindotski/spotcraft/releases/tag/v${version}`
