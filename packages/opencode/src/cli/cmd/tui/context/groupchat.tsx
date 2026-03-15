import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { CatalogAgent } from "@/catalog"
import type { TranscriptEntry, RoundResult } from "@/groupchat/types"
import type { TaskBudget } from "@/groupchat/budget"

interface GroupchatState {
  active: boolean
  participants: CatalogAgent[]
  observers: string[]
  transcript: TranscriptEntry[]
  contract: string | null
  budget: TaskBudget | null
  rounds: RoundResult[]
  semaphore: number
  participantColors: Record<string, string>
}

const AGENT_COLORS = [
  "#e06c75", "#98c379", "#e5c07b", "#61afef",
  "#c678dd", "#56b6c2", "#d19a66", "#be5046",
]

function assignColor(existing: Record<string, string>): string {
  const usedCount = Object.keys(existing).length
  return AGENT_COLORS[usedCount % AGENT_COLORS.length]
}

export const { use: useGroupchat, provider: GroupchatProvider } =
  createSimpleContext({
    name: "Groupchat",
    init: () => {
      const [store, setStore] = createStore<GroupchatState>({
        active: false,
        participants: [],
        observers: [],
        transcript: [],
        contract: null,
        budget: null,
        rounds: [],
        semaphore: 3,
        participantColors: {},
      })

      return {
        get active() { return store.active },
        get participants() { return store.participants },
        get observers() { return store.observers },
        get transcript() { return store.transcript },
        get rounds() { return store.rounds },
        get budget() { return store.budget },
        get semaphore() { return store.semaphore },
        get participantColors() { return store.participantColors },
        get contract() { return store.contract },

        start(participants: CatalogAgent[], observers: string[]) {
          const colors: Record<string, string> = {}
          for (const p of participants) {
            colors[p.id] = assignColor(colors)
          }
          for (const o of observers) {
            colors[o] = assignColor(colors)
          }
          setStore({
            active: true,
            participants,
            observers,
            transcript: [],
            rounds: [],
            participantColors: colors,
          })
        },

        addParticipant(agent: CatalogAgent) {
          setStore(produce((s) => {
            s.participants.push(agent)
            s.participantColors[agent.id] = assignColor(s.participantColors)
          }))
        },

        addTranscript(entry: TranscriptEntry) {
          setStore(produce((s) => {
            s.transcript.push(entry)
          }))
        },

        addRound(result: RoundResult) {
          setStore(produce((s) => {
            s.rounds.push(result)
          }))
        },

        end() {
          setStore({
            active: false,
            participants: [],
            observers: [],
            transcript: [],
            contract: null,
            budget: null,
            rounds: [],
            participantColors: {},
          })
        },
      }
    },
  })
