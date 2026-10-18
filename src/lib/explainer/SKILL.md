---
name: visual-explainer
description: Build a navigable, animated 3D explainer (single HTML file, three.js) that teaches the concepts behind a PR, branch, design or system, scene by scene. Use when the user wants to "really understand" a change, asks to visualize or animate how something works, wants something "in 3D" they can orbit and inspect, or asks for a visual walkthrough of what a PR does compared to main. For a quick diagram or call tree, use show-me instead.
---

# Visual explainer

Output: one self-contained HTML file in `.context/`, built from `template.html` next to this file. A sequence of 3D scenes, one concept per scene, that the user steps through and orbits.

## What the user wants (learned the hard way)

- **Concepts, not details.** Teach the 6-10 ideas someone needs to reason about the change. No call traces, field-by-field walkthroughs, code dumps, log panels or tables of internals.
- **Almost no text.** Each scene gets a title and one sentence (aim under 30 words). The legend has at most 5 colour keys. Labels in the scene are short nouns.
- **Show by motion, in 3D.** Things fly, collapse, light up, get copied, drop into place. Panels of HTML boxes changing values were rejected as "a bunch of boxes".
- **One persistent metaphor.** Pick a single 3D shape for the core data structure and reuse it in every scene, so each scene only changes one thing. Keep colour meanings the same throughout.

## Steps

1. **Understand first.** Diff against the base branch, read the core new files and any removed ones, and check tests for intended behaviour. Write down the before/after contrast and the concept list. Don't start the HTML until you can state each concept in one sentence.
2. **Plan the scenes.** Open with the "before" (main), then morph it into the "after". Then one scene per mechanism, the common operations (read, write, nested edit, add, delete, undo, bulk replace…), and the surprising consequences or tradeoffs. 8-12 scenes.
3. **Concrete sample data.** Use about 8 items with real domain names ("Kitchen", "Office"), not `foo`/`item1`. Shrink constants for visibility (for example a group of 4 instead of 32) when the concept survives.
4. **Build from the template.** Copy `template.html`, then replace the domain section and `SCENES`. Each scene is `{ t, p, cam: [position, target], setup(), play(ctx, w) }`:
   - `setup()` builds that scene's starting state from scratch, so every scene replays on its own and you can jump to it directly.
   - `play()` wraps every await in `w(...)` so leaving the scene aborts the animation cleanly.
   - Helpers: `move(obj, to, ms, lift)`, `scaleTo`, `fade`, `flash`, `camTo`, `label`, `drop`, `sleep`, `tween`.
5. **Verify every scene.** Use the repo's installed `@playwright/test` with headless chromium. Call `window.__go(i)`, wait for the animation, take a screenshot and collect `pageerror`s. Look at each screenshot and fix the camera framing, labels overlapping the caption, objects cut off at the edges and views from behind. Clean up any temp script.
6. **Report.** Give the path, how to navigate, 1-2 screenshots, and anything simplified or not re-measured.

## Accuracy

Simplify, but never show something false. If the visual uses a scaled-down constant or a scripted story instead of the real code, say so in the final message. Numbers shown on screen need a known source; mention it.

## Gotchas

- CSS2D labels don't inherit their parent's `visible` and aren't removed with their parent. Use `drop()`/`clearWorld()` (they remove the DOM elements) and `showLabels(obj, bool)`.
- Turning on `material.transparent` after creation needs `material.needsUpdate = true`. `fade()` already does this.
- A label added to an object that is still scaled to 0.01 shows at full size. Hide it until the pop-in ends.
- Pick camera angles so tables read left to right with headers at the back. Views from the opposite side mirror the columns.
- three.js loads from unpkg via the importmap, so the file needs internet once.
