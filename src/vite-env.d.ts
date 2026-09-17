/** Vite's `?raw` imports (e.g. the export stylesheet asset). */
declare module "*?raw" {
  const content: string;
  export default content;
}
