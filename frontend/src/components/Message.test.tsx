import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './Message';

describe('answer Markdown', () => {
  it('renders mixed CommonMark and GFM structures', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'A **bold [link](https://example.com)** and `code`.\n\n- parent\n  - child\n\n| A | B |\n| - | - |\n| 1 | 2 |'} />,
    );
    expect(html).toContain('<strong>bold <a');
    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code>code</code>');
  });

  it('drops raw HTML, unsafe links, and remote Markdown images', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'<script>alert(1)</script>\n\n[bad](javascript:alert(1)) ![tracker](https://example.com/pixel.gif)'} />,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('[Image: tracker]');
  });

  it('keeps incomplete streaming Markdown renderable', () => {
    expect(() => renderToStaticMarkup(<MarkdownContent content={'**Still arriving'} />)).not.toThrow();
  });

  it('uses the copyable, highlighted code block for fenced code, including a one-line fence', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={'```ts\nconst answer = 42;\n```'} />);
    // Highlighting wraps tokens in spans; the visible text is unchanged.
    expect(html.replace(/<[^>]+>/g, '')).toContain('const answer = 42;');
    expect(html).toContain('class="token');
    expect(html).toContain('Copy');
    expect(html).toContain('ts');
  });

  it('escapes HTML inside code blocks, which are highlighted into markup', () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    for (const content of ['```html\n' + attack + '\n```', '```\n' + attack + '\n```', '```unknown-lang\n' + attack + '\n```']) {
      const html = renderToStaticMarkup(<MarkdownContent content={content} />);
      expect(html).not.toMatch(/<img|<script/i);
      expect(html).toContain('&lt;');
    }
  });
});
