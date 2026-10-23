# Icon concepts

These editable concepts share the green circle and Swagger-style braces. The green-and-black smile is the selected extension icon.

| Concept | SVG source | PNG preview |
| --- | --- | --- |
| Green and black `{ツ}` | `green-black.svg` | `green-black.png` |
| Green and white `{ツ}` | `green-white.svg` | `green-white.png` |
| Diff arrows | `diff-arrows.svg` | — |
| Rotated diff arrows with directional pupils | `diff-eyes.svg` | — |

The green-and-black PNG is selected as the extension icon and copied to `../icon.png`. Concept files remain in the project and are excluded from the VSIX.

The selected green-and-black PNG is rendered from its SVG source. It has a transparent background outside the green circle, an 8-unit black circular outline, 8-unit braces and eyes, and a 9-unit smile on the 256-unit canvas. The smile and braces remain editable paths.

The green-and-white PNG was generated during earlier exploration; its SVG is an editable geometric redraw.

The diff concepts replace the smile with opposing arrow paths and ring nodes. `diff-eyes.svg` rotates that mark 90 degrees clockwise and adds pupils facing toward the arrows.

SVG palette: green `#73E63A`, black `#111516`, white `#FFFFFF`. The source canvas is 256 × 256; the circle has a radius of 110.

The final generation prompts for the two `{ツ}` color concepts are recorded in `prompts.md`.
