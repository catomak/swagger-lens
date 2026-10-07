# Icon concepts

These editable concepts share the green circle and Swagger-style braces. The current extension icon remains unchanged.

| Concept | SVG source | PNG preview |
| --- | --- | --- |
| Green and black `{ツ}` | `green-black.svg` | `green-black.png` |
| Green and white `{ツ}` | `green-white.svg` | `green-white.png` |
| Diff arrows | `diff-arrows.svg` | — |
| Rotated diff arrows with directional pupils | `diff-eyes.svg` | — |

The green-and-black PNG is selected as the extension icon and copied to `../icon.png`. Concept files remain in the project and are excluded from the VSIX.

The two `{ツ}` PNG concepts were made with the built-in image generation tool. Their SVGs are clean geometric redraws with flat fills, rounded strokes, matching geometry, and no font dependencies; they are not pixel-identical traces of the PNGs. The smile and braces remain editable paths.

The diff concepts replace the smile with opposing arrow paths and ring nodes. `diff-eyes.svg` rotates that mark 90 degrees clockwise and adds pupils facing toward the arrows.

SVG palette: green `#73E63A`, black `#111516`, white `#FFFFFF`. The source canvas is 256 × 256; the circle has a radius of 110.

The final generation prompts for the two `{ツ}` color concepts are recorded in `prompts.md`.
