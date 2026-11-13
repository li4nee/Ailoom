// SPDX-License-Identifier: AGPL-3.0-only
// Turndown ships no types of its own; this covers the surface the extractors use.
declare module 'turndown' {
  namespace TurndownService {
    interface Options {
      headingStyle?: 'setext' | 'atx';
      hr?: string;
      bulletListMarker?: '-' | '+' | '*';
      codeBlockStyle?: 'indented' | 'fenced';
      fence?: string;
      emDelimiter?: string;
      strongDelimiter?: string;
      linkStyle?: 'inlined' | 'referenced';
      linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
      preformattedCode?: boolean;
    }

    /** A node of the DOM implementation turndown parses with (domino). */
    interface Node {
      nodeName: string;
      getAttribute(name: string): string | null;
    }

    interface Rule {
      filter: string | string[] | ((node: Node) => boolean);
      replacement: (content: string, node: Node) => string;
    }

    type Plugin = (service: TurndownService) => void;
  }

  class TurndownService {
    constructor(options?: TurndownService.Options);
    use(plugins: TurndownService.Plugin | TurndownService.Plugin[]): this;
    addRule(key: string, rule: TurndownService.Rule): this;
    remove(filter: string | string[]): this;
    turndown(html: string | TurndownService.Node): string;
  }

  export default TurndownService;
}
