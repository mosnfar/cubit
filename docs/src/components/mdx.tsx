import defaultComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

// Markdown stays readable on GitHub while links resolve to pages on the site.
function documentationHref(href: string | undefined) {
  if (!href) return href;
  const local = href.match(/^(?:\.\/)?([\w-]+)\.md(#.*)?$/);
  if (local) return `${local[1] === 'index' ? '/' : `/${local[1]}/`}${local[2] ?? ''}`;
  if (href.startsWith('../')) {
    return `https://github.com/mosnfar/cubit/blob/main/${href.slice(3)}`;
  }
  return href;
}

export const mdxComponents: MDXComponents = {
  ...defaultComponents,
  a: ({ href, ...props }) => {
    const Link = defaultComponents.a!;
    return <Link href={documentationHref(href)} {...props} />;
  },
};
