import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: '.',
  docs: { files: ['*.md'] },
  meta: { files: ['meta.json'] },
});

export default defineConfig();
