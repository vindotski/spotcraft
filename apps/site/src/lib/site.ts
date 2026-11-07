import rootPackage from '../../../../package.json'

export const VERSION: string = rootPackage.version
export const GITHUB = 'https://github.com/vindotski/spotcraft'
/** Repository files at the version these docs were built from. */
export const GITHUB_AT_VERSION = `${GITHUB}/blob/v${VERSION}`
