# Gotchas

> Append-only failure log. Each entry is one specific mistake the loop
> made and how it got resolved (or "still open"). The next iteration
> reads this file before planning so it doesn't repeat the same error.
>
> **Rules:**
> - Append; never delete or rewrite an old entry.
> - One short paragraph per entry. No essays.
> - Be specific: "Foo's API uses `bar=` not `--bar`", not "Foo is tricky".
> - If you didn't actually hit the bug yourself, don't add it.

---

<!--
## gotcha: <short title>  (iter N)

**Symptom:** what went wrong (exact error message if helpful)
**Cause:** what was actually broken
**Fix:** what worked (or "still open — see ticket X")
-->
