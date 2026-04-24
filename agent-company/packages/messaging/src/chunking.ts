/**
 * Smart chunking. Splits a long message into platform-safe pieces, preferring
 * break points that don't corrupt formatting:
 *   1. Don't split inside a fenced code block — the closing ``` must stay with
 *      its opening.
 *   2. Prefer splitting on \n\n (paragraph boundary), then \n, then ' '.
 *   3. Hard-truncate only as a last resort.
 *
 * Usage:
 *   for (const piece of chunk(text, 2000)) { adapter.send(piece) }
 */

export function chunk(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const pieces: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    const windowEnd = maxLen

    // 1. If we're about to split INSIDE a code fence, back off to a point
    //    before the last ``` in the window, then let the next piece start
    //    with the remaining code fence.
    const codeAwareEnd = avoidCodeFenceSplit(remaining, windowEnd)
    const ceiling = Math.min(codeAwareEnd, windowEnd)

    // 2. Find the cleanest break point within [0, ceiling].
    const paragraphBreak = remaining.lastIndexOf('\n\n', ceiling)
    const lineBreak = remaining.lastIndexOf('\n', ceiling)
    const spaceBreak = remaining.lastIndexOf(' ', ceiling)

    // Require the break point to be at least halfway — otherwise we produce
    // tiny pieces and the user sees messy fragmentation.
    const halfway = Math.floor(maxLen / 2)
    let splitAt = -1
    if (paragraphBreak > halfway) splitAt = paragraphBreak + 2
    else if (lineBreak > halfway) splitAt = lineBreak + 1
    else if (spaceBreak > halfway) splitAt = spaceBreak + 1
    else splitAt = ceiling  // no clean break — hard-cut

    pieces.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }

  if (remaining.length > 0) pieces.push(remaining)
  return pieces
}

/**
 * If splitting at `windowEnd` would land inside an unclosed code fence, return
 * the position of the last ``` before windowEnd so we split BEFORE the fence
 * opens (the whole fenced block moves to the next chunk). If no fence is
 * active, return windowEnd unchanged.
 */
function avoidCodeFenceSplit(text: string, windowEnd: number): number {
  const before = text.slice(0, windowEnd)
  // Count unescaped ``` runs. Odd count = we're inside a fence.
  const fenceCount = (before.match(/```/g) ?? []).length
  if (fenceCount % 2 === 0) return windowEnd  // even = closed

  // We'd split inside a fence. Find the LAST opening ``` and back up to JUST
  // before it.
  const lastFence = before.lastIndexOf('```')
  if (lastFence === -1) return windowEnd  // shouldn't happen given fenceCount > 0
  return Math.max(0, lastFence)
}
