// SPDX-License-Identifier: AGPL-3.0-only
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const outputDir = resolve('dist');
const basePath = '/Ailoom';
const localUrlAttribute = /\b(href|src|action|poster)=(['"])(\/[^'"]*)\2/gi;

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listHtmlFiles(path);
      return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
    }),
  );
  return nested.flat();
}

function addBasePath(value) {
  if (value === basePath || value.startsWith(`${basePath}/`)) return value;
  return `${basePath}${value === '/' ? '/' : value}`;
}

function destinationFor(urlPath) {
  if (urlPath !== basePath && !urlPath.startsWith(`${basePath}/`)) {
    throw new Error(`Internal URL is missing the Pages base path: ${urlPath}`);
  }
  let pagePath = urlPath.slice(basePath.length);
  if (!pagePath || pagePath === '/') pagePath = '/index.html';
  else if (!extname(pagePath)) pagePath = `${pagePath.replace(/\/$/, '')}/index.html`;
  return resolve(outputDir, `.${pagePath}`);
}

const files = await listHtmlFiles(outputDir);
const brokenLinks = [];
const destinations = [];

for (const file of files) {
  const original = await readFile(file, 'utf8');
  const html = original.replace(localUrlAttribute, (_match, attribute, quote, value) => {
    const prefixed = addBasePath(value);
    const destination = destinationFor(new URL(prefixed, 'https://pages.invalid').pathname);
    if (!destination.startsWith(`${outputDir}/`) && destination !== join(outputDir, 'index.html')) {
      throw new Error(`Resolved URL escapes the docs output directory: ${prefixed}`);
    }
    destinations.push(
      access(destination).catch(() =>
        brokenLinks.push(`${relative(outputDir, file)}: ${prefixed}`),
      ),
    );
    return `${attribute}=${quote}${prefixed}${quote}`;
  });
  if (html !== original) await writeFile(file, html);
}

await Promise.all(destinations);
if (brokenLinks.length > 0) {
  throw new Error(
    `Broken local links in the docs build:\n${brokenLinks.map((link) => `- ${link}`).join('\n')}`,
  );
}

// eslint-disable-next-line no-console
console.log(`GitHub Pages paths fixed and checked in ${files.length} HTML pages.`);
