interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_ADMIN_ACCOUNT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module 'world-atlas/countries-110m.json' {
  const value: unknown;
  export default value;
}
