export interface MentionResult {
  mentioned: string[]
  cleaned: string
}

export function parseMentions(
  text: string,
  participants: string[],
): MentionResult {
  const participantSet = new Set(participants.map(p => p.toUpperCase()))
  const mentioned = new Set<string>()
  const mentionRegex = /@(\w+)/g
  let cleaned = text
  const toRemove: string[] = []

  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[1]
    const nameUpper = name.toUpperCase()

    if (nameUpper === "ALL") {
      for (const p of participants) mentioned.add(p)
      toRemove.push(match[0])
    } else if (participantSet.has(nameUpper)) {
      const original = participants.find(p => p.toUpperCase() === nameUpper)!
      mentioned.add(original)
      toRemove.push(match[0])
    }
  }

  for (const mention of toRemove) {
    cleaned = cleaned.replace(mention, "")
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim()

  return { mentioned: [...mentioned], cleaned }
}
