# Curated README media

These are deliberately published showcase assets requested for the README, not raw QA screenshots or private agent traces. The application is in [examples/fieldwork](../../examples/fieldwork/); [build notes](../../examples/fieldwork/BUILD-NOTES.md) record actual MCP calls, source citations, corrections, checks and limits.

- `fieldwork-hero.png`: composed real desktop-light and mobile-dark browser captures, with actual generated color-role swatches. The framing is editorial; application pixels are unretouched.
- `fieldwork-demo.gif`: seven edited frames, three seconds each, from exercised browser states plus one documented review-summary card. The GIF loops; it is behind an expandable section in the README.
- `fieldwork-demo.mp4`: the same silent walkthrough, without looping. Download it to pause/scrub instead of using the animation.

This is **not a real-time recording of an agent building the application**. Tool executions preceded capture. The correction card summarizes verified historical findings; it is not a fabricated terminal session. Fictional expedition data is labeled in the application. No measured agent uplift or Google endorsement is claimed.

## Text transcript

1. **The brief:** an expedition planner with forest, lime and warm-paper branding. The agent implemented the working interface.
2. **Ground the interaction:** retrieved official chips-accessibility guidance informed selection and keyboard semantics. The real Mountains filter reduces three cards to one.
3. **Apply the tokens:** the seed `#245641` generated HCT light/dark roles. The agent layered its own brand treatment over them. The theme toggle shows the actual dark interface.
4. **Make it work:** a real click opens Bracken Ridge's details. Dialog behavior includes focus handling, saving and Escape dismissal.
5. **Keep the state:** a second route is saved and the extra-layer checkbox advances packing progress to three of five. State remains in this browser only.
6. **Review and correct:** the actual MCP source review identified six informational literal-color findings. The agent moved reusable colors into semantic properties—for example, `background: #fffef0` became `background: var(--map-control-surface)`. This preserved appearance; a rerun returned zero static findings. It was a maintainability correction, not an accessibility certification. The separately discovered modal keyboard fix is documented in the build notes.
7. **Check in the browser:** the application-specific suite passed 119 assertions. Browser and generated-plan tests still leave manual accessibility/usability review outstanding.

## Reproduce

From the repository root, with the existing dev dependencies and an installed Chrome plus `ffmpeg`:

```sh
node examples/fieldwork/check.mjs
node docs/media/capture-fieldwork.mjs
```

Set `CHROME=/path/to/chrome` if necessary. No packages or browsers are installed implicitly. The capture script starts and stops its own loopback server, exercises actual filters/theme/dialog/save/packing states with assertions, and writes the three curated assets here. Intermediate captures, HTML compositions and the capture report remain under ignored `artifacts/readme-media/`. The historical review card is an authored summary anchored to the build notes; rerunning capture does not silently rerun MCP calls or claim a new historical finding.

The hero is a product example, not a visual-regression baseline or evidence that this MCP always improves a design. The source example, scripts, SVG illustrations and editorial media are original project work under the repository's MIT license. Referenced Google documentation retains its own terms and is not bundled.
