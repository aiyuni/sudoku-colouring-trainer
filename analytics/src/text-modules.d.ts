// Files bundled as plain strings by the [[rules]] in wrangler.toml.
declare module '*.admin.js' {
  const content: string
  export default content
}
declare module '*.admin.css' {
  const content: string
  export default content
}
