// SPDX-License-Identifier: MIT
import { Fragment, type ComponentChildren } from 'preact';

import type { MdNode } from '@app/shared';
import { parseMarkdownSubset } from '@app/shared';

export interface MarkdownProps {
  source: string;
  /** Server-side link policy re-applied by the widget, usually `isLinkAllowedFor(...)`. */
  isLinkAllowed?: (href: string) => boolean;
}

function renderNodes(nodes: MdNode[]): ComponentChildren[] {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node)}</Fragment>);
}

function renderNode(node: MdNode): ComponentChildren {
  switch (node.type) {
    case 'paragraph':
      return <p>{renderNodes(node.children)}</p>;
    case 'strong':
      return <strong>{renderNodes(node.children)}</strong>;
    case 'emphasis':
      return <em>{renderNodes(node.children)}</em>;
    case 'inlineCode':
      return <code>{node.text}</code>;
    case 'codeBlock':
      return (
        <pre>
          <code>{node.text}</code>
        </pre>
      );
    case 'list': {
      const items = node.items.map((item, index) => <li key={index}>{renderNodes(item)}</li>);
      return node.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'link':
      return (
        <a href={node.href} target="_blank" rel="noopener noreferrer nofollow">
          {renderNodes(node.children)}
        </a>
      );
    case 'lineBreak':
      return <br />;
    case 'text':
      return node.text;
  }
}

/**
 * A safe Markdown renderer (spec §16.2): the shared parser only ever produces the node types
 * above, and this file maps each one to a Preact element. There is no HTML string path, no
 * `innerHTML`, no `eval`, so an answer cannot inject markup or script.
 */
export function Markdown({ source, isLinkAllowed }: MarkdownProps) {
  const nodes = parseMarkdownSubset(source, isLinkAllowed === undefined ? {} : { isLinkAllowed });
  return <div class="ailoom-markdown">{renderNodes(nodes)}</div>;
}
