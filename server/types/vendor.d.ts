declare module 'ajv/dist/2020' {
  import Ajv from 'ajv';
  export default Ajv;
}

declare module 'ajv-formats' {
  import type Ajv from 'ajv';
  export default function addFormats(ajv: Ajv): Ajv;
}
