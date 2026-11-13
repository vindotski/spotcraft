/** The page's path as visitors see it: pages are built as `x.html` but served at `/x`. */
export const pagePath = (url: URL) => url.pathname.replace(/\.html$/, '').replace(/\/index$/, '/')
