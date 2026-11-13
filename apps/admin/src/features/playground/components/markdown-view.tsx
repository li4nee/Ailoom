// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment, type ReactNode } from 'react';

import type { MdNode } from '@app/shared';

/**
 * Renders the shared Markdown AST with React elements only. There is deliberately no
 * `dangerouslySetInnerHTML` path: the parser never produces HTML nodes, so an answer cannot
 * inject markup.
 */
export function MarkdownView({ nodes }: { nodes: MdNode[] }) {
  return <div className="space-y-2 text-sm leading-6">{renderNodes(nodes)}</div>;
}

function renderNodes(nodes: MdNode[]): ReactNode[] {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node)}</Fragment>);
}

function renderNode(node: MdNode): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p className="whitespace-pre-wrap">{renderNodes(node.children)}</p>;
    case 'strong':
      return <strong>{renderNodes(node.children)}</strong>;
    case 'emphasis':
      return <em>{renderNodes(node.children)}</em>;
    case 'inlineCode':
      return <code className="rounded bg-muted px-1 py-0.5 text-xs">{node.text}</code>;
    case 'codeBlock':
      return (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
          <code>{node.text}</code>
        </pre>
      );
    case 'list': {
      const items = node.items.map((item, index) => <li key={index}>{renderNodes(item)}</li>);
      return node.ordered ? (
        <ol className="list-decimal space-y-1 pl-5">{items}</ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5">{items}</ul>
      );
    }
    case 'link':
      return (
        <a
          href={node.href}
          className="underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {renderNodes(node.children)}
        </a>
      );
    case 'lineBreak':
      return <br />;
    case 'text':
      return node.text;
  }
}
