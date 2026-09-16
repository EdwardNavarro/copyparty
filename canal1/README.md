# Canal One theme for copyparty

A light-first professional application shell for copyparty. It redesigns the toolbar, navigation, file table, thumbnail grid, panels, player, Markdown and auxiliary pages with a consistent graphite and teal visual system.

## Theme slots

| Index | Variant | HTML classes |
| ---: | --- | --- |
| 10 | Dark | `fz f z` |
| 11 | Light, recommended | `fy f y` |

The selector labels both variants as `custom`. This is intentional: changing the label requires modifying copyparty's JavaScript or adding a fragile runtime patch.

## Files

| File | Purpose |
| --- | --- |
| `graphite-teal.css` | Editable source stylesheet |
| `theme-head.html` | Generated inline artifact consumed by copyparty |
| `build-theme.mjs` | Regenerates `theme-head.html` from the CSS source |
| `copyparty-theme.conf` | Configuration example |

## Docker installation

1. Bind-mount the directory privately inside the container:

```yaml
volumes:
  - ./canal1:/canal1:ro,z
```

2. Merge the options from `copyparty-theme.conf` into the existing `[global]` section. Do not add a second `[global]` section.
3. Restart copyparty.
4. Open the browser with `?theme=11` once if that browser already has another theme stored.

The relevant configuration is:

```ini
[global]
  themes: 12
  theme: 11
  tcolor: e9efed
  html-head: @/canal1/theme-head.html
```

Do not declare `/canal1` as a copyparty volume. Copyparty reads the file directly from the container filesystem, so neither the directory nor a CSS endpoint is exposed in the UI.

## Development

Edit `graphite-teal.css`, then regenerate the inline artifact from the repository root:

```sh
node canal1/build-theme.mjs
```

Hard-refresh the browser after rebuilding. A copyparty restart is not normally required when only the contents of `theme-head.html` change.

## Coverage

The stylesheet covers:

- Professional command bar with monochrome SVG icons
- Structured file table and responsive thumbnail cards
- Sidebar navigation and framed breadcrumbs
- Search, configuration and upload workspaces
- Audio player dock and image viewer controls
- Inputs, buttons, tooltips, notifications and modal dialogs
- Login/control pages, shares, recent uploads and status messages
- Markdown viewer, split editor and EasyMDE editor
- Light and dark variants
- Mobile layouts and reduced-motion preferences

Copyparty's basic browser (`?b=u`) and WOPI page do not load `html-head`, so an external theme cannot style them without changing core templates.

## Notes

- `theme: 11` makes the light variant the server default.
- Client-side selection is stored in `localStorage.cpp_thm`; the server default does not overwrite an existing choice.
- The Markdown editors maintain their own light/dark preference. Their colors still follow this package whenever the stylesheet is loaded.
- Keep `html-head` as the only stylesheet hook for this package. Do not also configure `css-browser`.
- The theme uses only system fonts and does not make requests to third-party font services.
- The SVG icon masks are embedded in the CSS and fall back to the original emojis in browsers without mask support.

## Update or remove

To remove the theme, delete the `html-head` option and restore `themes` and `theme` to the desired values.
