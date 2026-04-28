# Metrovan AI CSS Structure

`App.css` is only a compatibility entry. Keep real page styles in this folder.

## Import Order

The order in `index.css` is part of the UI contract. Do not reorder imports unless you are intentionally changing the cascade and have visually checked `/home`, `/plans`, `/studio`, and `/admin`.

## Files

- `00-foundation.css`: fonts, tokens, base elements, shared primitives.
- `10-studio-workspace.css`: studio shell, projects, upload, processing, results, editor.
- `20-landing-core.css`: landing page structure and primary hero sections.
- `30-studio-polish.css`: studio visual refinements and state-specific overrides.
- `40-homepage-polish.css`: homepage visual refinements.
- `50-plans.css`: plans/pricing page only.
- `60-showcase-render.css`: homepage sci-fi/showcase render section.
- `70-polish-layer.css`: final compatibility polish preserved from the previous UI pass.
- `80-mobile.css`: mobile-only responsive overrides.

## Rules

- Do not add new CSS directly to `App.css`.
- Put route-specific styles in the matching route file.
- Put shared tokens and base selectors in `00-foundation.css`.
- Put mobile-only overrides in `80-mobile.css`.
- Avoid new `!important` rules; if one is needed, document why near the rule.
- Prefer adding a scoped class over changing broad selectors such as `button`, `section`, or `.card`.
