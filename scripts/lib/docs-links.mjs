import { JSDOM } from 'jsdom';
import { posix } from 'node:path';

export const urlOfBuiltFile = (file) =>
  `/${file.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`;

export function checkBuiltLinks(htmlPages, base, artifactExists) {
  const broken = [];
  const checked = new Set();
  const pageFacts = new Map(
    [...htmlPages].map(([file, html]) => {
      const dom = new JSDOM(html);
      const { document } = dom.window;
      const facts = {
        ids: new Set(
          [...document.querySelectorAll('[id]')].map((element) => element.id),
        ),
        links: [...document.querySelectorAll('a[href]')].map((element) =>
          element.getAttribute('href'),
        ),
        counterpart: document
          .querySelector('a.docs-locale-link')
          ?.getAttribute('href'),
      };
      dom.window.close();
      return [file, facts];
    }),
  );
  const fileOfUrl = (path) => {
    if (!path.startsWith(base)) return null;
    const withoutBase = decodeURIComponent(path.slice(base.length));
    if (posix.normalize(withoutBase).startsWith('../')) return null;
    if (withoutBase === '' || withoutBase.endsWith('/'))
      return `${withoutBase}index.html`;
    return artifactExists(withoutBase) ? withoutBase : `${withoutBase}.html`;
  };
  for (const [file, facts] of pageFacts) {
    if (file === '404.html') continue;
    const pageUrl = `https://docs.invalid${base.replace(/\/$/, '')}${urlOfBuiltFile(file)}`;
    const links = facts.links.filter(
      (href) => href && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href),
    );
    if (!links.some((href) => !href.startsWith('#')))
      broken.push(`${file}: no internal navigation found`);
    for (const href of links) {
      const url = new URL(href, pageUrl);
      const target = fileOfUrl(url.pathname);
      if (target === null) {
        broken.push(`${file} links at ${href} outside base ${base}`);
        continue;
      }
      checked.add(target);
      if (!htmlPages.has(target) && !artifactExists(target)) {
        broken.push(`${file} links at ${href} -> missing ${target}`);
        continue;
      }
      const fragment = decodeURIComponent(url.hash.slice(1)).split(
        ':~:text=',
      )[0];
      if (
        fragment &&
        htmlPages.has(target) &&
        !pageFacts.get(target).ids.has(fragment)
      )
        broken.push(
          `${file} links at ${href} -> missing anchor ${target}#${fragment}`,
        );
    }
    if (!facts.counterpart)
      broken.push(`${file}: locale switcher link missing from built page`);
    else {
      const target = fileOfUrl(new URL(facts.counterpart, pageUrl).pathname);
      if (!htmlPages.has(target))
        broken.push(`${file} locale switch targets missing ${target}`);
    }
  }
  return { broken, checked };
}
