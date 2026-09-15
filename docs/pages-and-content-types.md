# Pages and Content types

This guide targets Core 0.2.0 and MCP 0.45.0. Existing installations must complete
the [schema migration](https://typeroll.com/docs/guides/unified-pages-upgrade/)
before running that release. The Extension runtime protocol remains separate
from the CMS content schema.

Every article, checklist, product, directory entry and ordinary page is a Page.
A Content type supplies custom fields, a URL pattern and an optional default
Page template. A Page owns its title, slug, path, blocks, SEO, status and history.
Custom values live in `fields`; do not duplicate built-in metadata in the schema.

```json
{
  "title": "Example guide",
  "slug": "example-guide",
  "content_type": "articles",
  "fields": { "excerpt": "A short introduction." },
  "status": "draft",
  "content_mode": "blocks",
  "blocks": [
    { "id": "intro", "type": "core/prose", "data": { "html": "<p>Guide content.</p>" } }
  ]
}
```

After defining the `articles` Content type, send this through `create_page` or
`POST /api/v1/sites/{siteId}/pages`. The returned Page ID is the identity for
reads, updates, references, previews and deletion. List articles through
`list_pages content_type="articles"`; use the Page editor for all records.

- Templates use `template_content_slot` for Page body blocks and `{{page.title}}`
  for metadata. A repeater uses `{{item.title}}` for its current listed Page.
- Relations use `page_ref` or `page_ref_list`, optionally scoped by
  `ref_content_type`. A type with an empty route pattern can store reusable data
  without a public detail URL.
- Pass the same site `version` throughout Page, type and template operations.
  Content changes use working copies; save before publishing.
- A Page's explicit `path` takes precedence over the type route pattern.
  `change_page_content_type` preserves identity/body/path and requires complete
  target fields. Previous values remain in revision history.
- Fields marked `rendered: false` never belong in public Extension props or
  static assets. Provider secrets stay on the server.

## Extension boundary

The browser Extension runtime is not a general CMS client. Use its documented
Forms, navigation and provider capabilities. If the integration needs CMS edits,
perform them from an authorized server-side integration or the user's MCP agent,
with site permissions and field authority enforced by Typeroll. Never put a CMS
API key in the frontend bundle or a block field.

Recipient-specific records remain provider data. Do not create a Page for every
recipient screen or copy recipient URL tokens into Page fields. The example
calculator's leads continue to use Forms, not Pages as an ad hoc submission store.

## Media

Keep the stable media URL returned by Typeroll in content. Private originals may
use an authenticated API address; preview grants temporary access and publishing
resolves public media URLs. Test the compiled site without a CMS session.
Do not expose the originals bucket or persist temporary signed URLs in Git.

See the [current model and API guide](https://typeroll.com/docs/tools/content-types/)
and [Pages tools](https://typeroll.com/docs/tools/pages/).


Content types also own `sort_field`/`sort_dir` and optional `allowed_templates`.
Types define content; templates define presentation. Multiple compatible Page
templates can be allowed, with `template` selecting the default. Null/absent
`allowed_templates` is unrestricted, `[]` allows none, and a configured default
must be in an explicit allowed list. Page overrides must be allowed; null/empty
`Page.template` restores inheritance. Page template changes use Save/Discard.

Listings inherit type sorting unless explicitly overridden. `Page.sort_order`
is the manual numeric order; null clears it. Missing sort values come last and
IDs break ties. Explicit ID lists keep their order. Typed `list_pages` queries
inherit type sorting and accept `sort_by`/`sort_order`; unfiltered API lists
default to stable IDs. See the public Content types guide for editor steps.
