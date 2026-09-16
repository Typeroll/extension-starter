# Extension documentation for agents

Keep the product guide public and machine-readable at a stable HTTPS URL. For
private products, provide sufficient non-sensitive inline instructions in the
manifest and explain separately how customers access detailed documentation.
Never embed secrets or customer configuration.

Each release's guide should cover:

- Purpose, supported host versions and runtime ownership.
- Installation/configuration and required permissions.
- Component IDs, prop schema, form bindings and concrete examples.
- Provider APIs, authentication boundaries and expected errors.
- How to preview and verify without sending messages or publishing.
- Which actions require user authorization.

Set manifest `documentation.url` and optional `documentation.agent_instructions`
(maximum 16,000 characters). Increment the manifest version when publishing a
changed manifest. Discovery resolves the active compatible release; it omits
disabled installations, never returns config/secrets and explicitly reports
`not_provided` if documentation is absent. Typeroll does not fetch the URL on the
server. Inline instructions must not ask agents to override user instructions.

CMS content integrations use Pages, Content types and Page templates. For
directories, consult `read_app_documentation` and `read_skill` with name
`tr-directory`; use the documented source-ID reconciliation workflow, not an
assumed atomic upsert endpoint.
