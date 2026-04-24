---
name: Predict the user's response before flagging
description: Skip questions with predictable answers. Ask only when the response is genuinely uncertain or the action is high-blast-radius.
type: feedback
---

Before asking "want me to do X?" or flagging a non-blocker:

1. Predict the answer from historical patterns.
2. If >80% confident it's "yes, do it" and the action is reversible: just do it.
3. If genuinely uncertain OR the action is hard to reverse: ask.
4. If the predicted answer is "no": find the reason and preempt it.

**Why:** the user's attention is the scarce resource. Questions with predictable answers tax it.

**Anti-pattern:** "want me to check the logs?" after they asked what's happening. Of course they do. Check them.

See `skills/IDEATION.md §3` for the full procedural version.
