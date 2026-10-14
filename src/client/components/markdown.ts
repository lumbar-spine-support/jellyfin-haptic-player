import MarkdownIt, { type Env } from 'markdown-it';

export namespace Markdown {
    const md = new MarkdownIt({
        html: false,
        linkify: true,
        typographer: false,
    });

    interface RenderEnv extends Env {
        headingLimit?: number;
    }

    // Shifts every heading down so the top level (h1) becomes h<headingLimit>, keeping the relative
    // structure until it hits h6: with 2, `#` → h2 and `##` → h3; with 6, all headings are h6.
    md.core.ruler.push('heading_limit', (state) => {
        const shift = ((state.env as RenderEnv).headingLimit ?? 1) - 1;
        if (shift <= 0) return;
        for (const token of state.tokens) {
            if (token.type !== 'heading_open' && token.type !== 'heading_close') continue;
            token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + shift)}`;
        }
    });

    /**
     * Renders untrusted Markdown (raw HTML is escaped).
     * @param headingLimit the level `#` headings get (1–6); deeper headings shift along, capped at h6.
     */
    export function render(markdown: string, headingLimit = 1): string {
        const env: RenderEnv = { headingLimit };
        return md.render(markdown, env);
    }

    export interface DocLinks {
        pageHref(page: string, hash: string): string;
        assetHref(relativePath: string): string;
    }

    const DOC_LINK = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/;
    const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
    const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/)/i;

    /** Matches GitHub's heading anchors so `page.md#section` links work in both places. */
    export function slugify(text: string): string {
        return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    }

    interface DocEnv extends Env {
        links: DocLinks;
        slugs: Map<string, number>;
    }

    // Docs ship with the image and are trusted, so raw HTML passes through (unlike `render`).
    const docs = new MarkdownIt({ html: true, linkify: true, typographer: false });

    docs.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
        const used = (env as DocEnv).slugs;
        const base = slugify(tokens[idx + 1]?.content ?? '');
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        tokens[idx].attrSet('id', count ? `${base}-${count}` : base);
        return self.renderToken(tokens, idx, options);
    };

    docs.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const href = String(token.attrGet('href') ?? '');
        const { links } = env as DocEnv;
        const docMatch = DOC_LINK.exec(href);
        if (docMatch) {
            token.attrSet('href', links.pageHref(docMatch[1], docMatch[2] ?? ''));
            token.attrSet('data-doc-link', '');
        } else if (EXTERNAL.test(href)) {
            token.attrSet('target', '_blank');
            token.attrSet('rel', 'noopener noreferrer');
        }
        return self.renderToken(tokens, idx, options);
    };

    const defaultImage = docs.renderer.rules.image!;
    docs.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const src = String(token.attrGet('src') ?? '');
        const { links } = env as DocEnv;
        if (src && !ABSOLUTE.test(src)) token.attrSet('src', links.assetHref(src.replace(/^\.\//, '')));
        return defaultImage(tokens, idx, options, env, self);
    };

    /** Renders a docs page, pointing relative page and image links at the in-app routes. */
    export function renderDoc(markdown: string, links: DocLinks): string {
        const env: DocEnv = { links, slugs: new Map() };
        return docs.render(markdown, env);
    }
}
