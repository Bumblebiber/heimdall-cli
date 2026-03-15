import type { TranscriptEntry } from "./types"

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min === 0) return `${sec}s`
  return `${min}m ${sec}s`
}

export function formatTranscript(
  entries: TranscriptEntry[],
  participants: string[],
  observers: string[],
  durationMs: number,
): string {
  const firstUserMsg = entries.find(e => e.agent === "")?.content ?? "discussion"
  const topic = firstUserMsg.slice(0, 80)
  const l2 = `Group chat: ${topic}`.slice(0, 120)

  const rounds = entries.filter(e => e.agent === "").length
  const l3Parts = [`\tParticipants: ${participants.join(", ")}`]
  if (observers.length > 0) {
    l3Parts.push(`\tObservers: ${observers.join(", ")}`)
  }
  l3Parts.push(`\tRounds: ${rounds}, Duration: ${formatDuration(durationMs)}`)

  const l5Lines = entries.map(e => {
    const speaker = e.agent || "User"
    return `\t\t${speaker}: ${e.content}`
  })

  return [l2, ...l3Parts, ...l5Lines].join("\n")
}
