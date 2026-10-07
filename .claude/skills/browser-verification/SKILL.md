---
name: browser-verification
description: Verify app changes in a browser with Playwright CLI. Use after changes to user interfaces, styles, navigation, or browser behavior, and when the user requests browser verification.
---

# Browser verification

1. Read the project's package.json and project instructions.
2. Identify the changed behavior and its expected result.
3. Use an existing development server, or start one with the project's
   development command. Use the URL printed by the server.
4. Use `playwright-cli --help` to check available commands.
5. Open the app with Playwright CLI.
6. Use page snapshots to find controls. Exercise the changed behavior
   and check the observed result against the expected result.
7. For layout changes, check desktop and mobile viewport sizes.
8. Take screenshots and inspect them for visual defects.
   For canvas or WebGL content, inspect screenshots as well as
   the page snapshot.
9. Check browser console errors and failed network requests.
10. If verification fails, fix the cause and repeat the affected checks.
11. Close the browser when verification is complete. Stop any
    development server started for this task.

Report:
- The URL and viewport sizes used.
- The actions performed and their results.
- Screenshot paths.
- Any failures or checks that could not be completed.

Do not report success based only on a page loading or a screenshot
being saved. Verify the expected behavior and inspect visual evidence.
Your project uses Vite, so its development command is npm run dev. It also uses deck.gl, which makes screenshot inspection important: accessibility snapshots do not show the rendered canvas content.

## Reliable browser instrumentation

- Check command-specific help before using `run-code`. Run a small example
  before adding measurement code. In the CLI used for this project, `page`
  is available to the function; it is not supplied as a `{ page }` argument:

  ```sh
  playwright-cli run-code 'async () => {
    return await page.evaluate(() => ({ title: document.title }));
  }'
  ```

- `page.evaluate()` runs its function inside the browser page. Return the
  measurement result explicitly. Compare object references inside the page
  and return numbers or booleans; serialized results do not preserve object
  identity. A stable typed-array reference is not a physical memory-address
  measurement.
- Use the exact module URL loaded by the page when instrumenting a library.
  For Vite dependencies, inspect `performance.getEntriesByType("resource")`
  and retain the URL's query string. Do not guess generated dependency names.
  Use the same module instance as the app so prototype instrumentation applies.
- First check that the app loads without instrumentation. Then check that
  instrumentation does not introduce console errors or change app behavior.
  A partial React DevTools hook can break Vite React Refresh. For example,
  omitting the hook's `renderers` map caused Refresh to fail and produced a
  React-plugin preamble error. Prefer supported profiling tools where possible.
- Temporary method wrappers must call the original method with the same
  arguments and `this`. Restore them after measurement, or discard the page
  and browser context. A reload alone does not remove `addInitScript()` code.
- After fixing an instrumentation failure, use a clean session for final
  checks. Request logs can retain failures from earlier attempts. Record setup
  failures separately from app failures; do not hide unresolved app errors.

## Canvas interaction checks

- A Deck property update does not mean the corresponding frame is already
  rendered. After zoom, rotation, or resize, wait for the expected renderer
  state and a rendered frame before calculating screen coordinates.
- Use the current viewport to project satellite positions. For a picking
  check, confirm that the target is pickable before moving the mouse to it.
  Then verify the actual hover text and click result. An empty result from
  stale coordinates is not evidence that picking is broken.
- Prefer checks of expected state over fixed delays alone.

## Performance measurements

- Collect matching before-and-after measurements with the same browser,
  viewport, data count, instrumentation, warm-up, and sample duration.
  If a baseline metric was not collected, report that limit explicitly.
- Keep React commits, component render duration, Deck updates, and GPU uploads
  as separate metrics. Counting `onCommitFiberRoot` calls is a React commit
  count, not a full React Profiler recording, and does not measure render time.
- For the satellite hot path, check that revisions produce Deck updates and
  GPU uploads without React commits. Check typed-array identity and binary
  attribute descriptor identity inside the page. Fresh descriptors can be
  necessary to upload changed shared memory.
- A `bufferSubData` wrapper counts calls; it does not measure GPU execution
  time or identify every upload as a satellite upload unless filtered.
- Record whether the browser uses hardware acceleration or software rendering.
  Short `requestAnimationFrame` samples under SwiftShader do not establish
  hardware-GPU performance or rule out small regressions. Report median and
  tail frame intervals, sample duration, and rendering backend. Do not claim
  unchanged performance from an unchanged median alone.
