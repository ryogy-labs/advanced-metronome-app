declare module '@capacitor/core' {
  export function registerPlugin<T = Record<string, unknown>>(name: string): T;
}
