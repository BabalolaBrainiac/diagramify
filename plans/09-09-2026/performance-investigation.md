# Performance and visual investigation

Work on the existing branch. Preserve existing edits. Do not change Git state.

1. Save the current renderer as the measurement baseline.
2. Measure five graph sizes in Chrome, in both themes.
3. Sample complete SVG paths against actual node boxes.
4. Measure contrast, keyboard access, narrow views, exports, and live editing.
5. Fix confirmed defects with bounded changes and regression tests.
6. Run all six requested checks after each change batch.
7. Report measurements, changes, and unresolved limits.

Risk: medium. Changes affect viewer behavior and session reads.
Keep graph validation, snapshot isolation, revision checks, and history limits intact.
Keep baseline files and a separate patch for manual rollback and review.
