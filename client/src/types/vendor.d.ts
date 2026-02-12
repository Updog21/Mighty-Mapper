declare module 'react-syntax-highlighter' {
  import type { ComponentType } from 'react';
  export const Prism: ComponentType<any>;
  export const Light: ComponentType<any>;
  export default ComponentType;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  const styles: Record<string, any>;
  export const oneDark: Record<string, any>;
  export const oneLight: Record<string, any>;
  export const vscDarkPlus: Record<string, any>;
  export const materialDark: Record<string, any>;
  export const atomDark: Record<string, any>;
  export const dracula: Record<string, any>;
  export default styles;
}
